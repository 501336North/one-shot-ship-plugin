/**
 * @behavior The tool gate turns an agent's shell command into one set of facts per part:
 *   which program runs, in which directory (after `cd`, `( … )` and `git -C`), which files it
 *   writes or removes, which hosts it talks to, and whether its result is hidden by a pipe or
 *   by `|| true`. The rules check these facts instead of re-reading the raw text.
 * @business-rule `cd sub && git push` and `git -C sub push` are pushes from `sub` (AC-001.3);
 *   a test run piped away or followed by `|| true` does not count as a result (AC-005.3);
 *   `curl https://api.example.com/x` talks to `api.example.com` (AC-007.1). A command the
 *   tokenizer cannot read stays unreadable.
 */

import { describe, it, expect } from 'vitest';
import { readCommand, type CommandPart } from '../../src/tool-gate/command-reader.js';
import { tokenize } from '../../src/tool-gate/tokenize.js';

const CWD = '/work/repo';
const HOME = '/home/dev';

function partsOf(cmd: string): CommandPart[] {
  const result = readCommand(cmd, CWD, HOME);
  if ('unreadable' in result) throw new Error(`expected a readable command, got unreadable: ${result.reason}`);
  return result.parts;
}

const programsOf = (cmd: string): (string | null)[] => partsOf(cmd).map((p) => p.program);
const cwdsOf = (cmd: string): string[] => partsOf(cmd).map((p) => p.cwd);
const writesOf = (cmd: string): string[] => partsOf(cmd).flatMap((p) => p.writeTargets).sort();
const hostsOf = (cmd: string): string[] => partsOf(cmd).flatMap((p) => p.hosts);

describe('readCommand: splitting a command into parts', () => {
  it('should split a compound command into parts on && || ; ;; | |& & and newline', () => {
    expect(programsOf('a && b || c ; d | e |& f & g\nh ;; i')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  });

  it('should give every part its words, with the program first', () => {
    expect(partsOf('git push origin main; ls -la').map((p) => p.words)).toEqual([
      ['git', 'push', 'origin', 'main'],
      ['ls', '-la'],
    ]);
  });

  it('should keep a part that only redirects, with no program', () => {
    const [part] = partsOf('> out.txt');
    expect(part.program).toBeNull();
    expect(part.words).toEqual([]);
    expect(part.writeTargets).toEqual(['/work/repo/out.txt']);
  });

  it('should return the tokenizer\'s unreadable result unchanged', () => {
    const cmd = 'git push $(echo origin) main';
    expect(readCommand(cmd, CWD, HOME)).toEqual(tokenize(cmd));
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(true);
  });
});

describe('readCommand: the directory each part runs in', () => {
  it('should run every part in the given directory when there is no cd', () => {
    expect(cwdsOf('ls && git push')).toEqual(['/work/repo', '/work/repo']);
  });

  it('should apply cd <dir> to later parts in the same command', () => {
    expect(cwdsOf('cd sub && git push')).toEqual(['/work/repo', '/work/repo/sub']);
  });

  it('should keep the cd itself as a part', () => {
    expect(partsOf('cd sub && git push')[0].words).toEqual(['cd', 'sub']);
  });

  it('should chain cd relative to the directory before it, and accept absolute paths', () => {
    expect(cwdsOf('cd sub; cd ../other; ls; cd /tmp/x; ls')).toEqual([
      '/work/repo', '/work/repo/sub', '/work/repo/other', '/work/repo/other', '/tmp/x',
    ]);
  });

  it('should expand ~ and ~/ in cd to the home directory', () => {
    expect(cwdsOf('cd ~/proj && ls')[1]).toBe('/home/dev/proj');
    expect(cwdsOf('cd ~ && ls')[1]).toBe('/home/dev');
  });

  it('should go to the home directory on cd with no argument', () => {
    expect(cwdsOf('cd && ls')[1]).toBe('/home/dev');
  });

  it('should leave the directory unchanged on cd - or cd with more than one argument', () => {
    expect(cwdsOf('cd - && ls')[1]).toBe('/work/repo');
    expect(cwdsOf('cd a b && ls')[1]).toBe('/work/repo');
  });

  it('should limit a cd inside ( … ) to the parts before the matching )', () => {
    expect(cwdsOf('(cd sub && git push) && git push')).toEqual(['/work/repo', '/work/repo/sub', '/work/repo']);
  });

  it('should restore each level of nested ( … ) separately', () => {
    expect(cwdsOf('(cd a && (cd b && x) && y) && z')).toEqual([
      '/work/repo', '/work/repo/a', '/work/repo/a/b', '/work/repo/a', '/work/repo',
    ]);
  });
});

describe('readCommand: git facts', () => {
  it('should read git -C <dir> as that part\'s git directory', () => {
    expect(partsOf('git -C sub push')[0].git).toEqual({ subcommand: 'push', args: [], dir: '/work/repo/sub' });
  });

  it('should chain several -C options and resolve them after an earlier cd', () => {
    expect(partsOf('git -C a -C b push origin main')[0].git).toEqual({
      subcommand: 'push', args: ['origin', 'main'], dir: '/work/repo/a/b',
    });
    expect(partsOf('cd sub && git -C ../other status')[1].git?.dir).toBe('/work/repo/other');
    expect(partsOf('git -C ~/proj push')[0].git?.dir).toBe('/home/dev/proj');
  });

  it('should find the git subcommand after global options (-C, -c k=v, --no-pager and friends)', () => {
    expect(partsOf('git -c user.name=x --no-pager -P --bare --git-dir=.git --work-tree=. log --oneline')[0].git).toEqual({
      subcommand: 'log', args: ['--oneline'], dir: '/work/repo',
    });
  });

  it('should use the part\'s directory when there is no -C', () => {
    expect(partsOf('cd sub && git push --force')[1].git).toEqual({
      subcommand: 'push', args: ['--force'], dir: '/work/repo/sub',
    });
  });

  it('should recognise git called by its full path', () => {
    expect(partsOf('/usr/bin/git push')[0].git?.subcommand).toBe('push');
  });

  it('should have no git facts for other programs or for git with no subcommand', () => {
    expect(partsOf('ls push')[0].git).toBeNull();
    expect(partsOf('git --version')[0].git).toBeNull();
  });
});

describe('readCommand: leading variable assignments', () => {
  it('should strip leading VAR=value assignments before the program name', () => {
    const [part] = partsOf('FOO=1 BAR=2 git push');
    expect(part.program).toBe('git');
    expect(part.words).toEqual(['git', 'push']);
    expect(part.git?.subcommand).toBe('push');
  });

  it('should keep an assignment-looking word after the program', () => {
    expect(partsOf('make FOO=1')[0].words).toEqual(['make', 'FOO=1']);
  });

  it('should have no program when a part only assigns variables', () => {
    expect(partsOf('FOO=1')[0].program).toBeNull();
  });
});

describe('readCommand: files a part writes or removes', () => {
  it.each(['>', '>>', '>|', '1>', '2>', '2>>', '&>', '&>>'])('should list the target of the %s redirect', (opText) => {
    expect(writesOf(`echo hi ${opText} out.txt`)).toEqual(['/work/repo/out.txt']);
  });

  it('should not list a redirect that duplicates or closes another output', () => {
    expect(writesOf('make 2>&1 >&2 3>&-')).toEqual([]);
  });

  it('should list a file written with >&file', () => {
    expect(writesOf('make >&build.log')).toEqual(['/work/repo/build.log']);
  });

  it('should list the output file of a heredoc', () => {
    expect(writesOf('cat <<EOF > notes.txt\nhello\nEOF')).toEqual(['/work/repo/notes.txt']);
  });

  it('should not list redirects that only read', () => {
    expect(writesOf('sort < in.txt; cat <<< hi; cat <<-EOF\n\tx\n\tEOF')).toEqual([]);
  });

  it('should list every rm operand but not its flags', () => {
    expect(writesOf('rm -rf build dist')).toEqual(['/work/repo/build', '/work/repo/dist']);
  });

  it('should list an rm operand that starts with - after --', () => {
    expect(writesOf('rm -- -odd')).toEqual(['/work/repo/-odd']);
  });

  it('should list both the source and the destination of mv', () => {
    expect(writesOf('mv -f a b dir')).toEqual(['/work/repo/a', '/work/repo/b', '/work/repo/dir']);
  });

  it('should list only the destination of cp', () => {
    expect(writesOf('cp -r a b dest')).toEqual(['/work/repo/dest']);
  });

  it('should list the -t directory of cp as its destination', () => {
    expect(writesOf('cp -t dest a b')).toEqual(['/work/repo/dest']);
  });

  it('should resolve targets against the part\'s directory and expand ~', () => {
    expect(writesOf('cd sub && rm x')).toEqual(['/work/repo/sub/x']);
    expect(writesOf('rm ~/x ~')).toEqual(['/home/dev', '/home/dev/x']);
    expect(writesOf('echo > /etc/hosts')).toEqual(['/etc/hosts']);
  });

  it('should list both operand and redirect writes of one part', () => {
    expect(writesOf('cp a b > log.txt')).toEqual(['/work/repo/b', '/work/repo/log.txt']);
  });

  it('should list nothing for a program that does not write', () => {
    expect(writesOf('ls a b')).toEqual([]);
  });
});

describe('readCommand: hosts a part talks to', () => {
  it('should read the host of a URL, lowercased and without its port', () => {
    expect(hostsOf('curl https://api.example.com/x')).toEqual(['api.example.com']);
    expect(hostsOf('curl -s HTTPS://API.Example.com:8443/x?y=1')).toEqual(['api.example.com']);
    expect(hostsOf('psql postgres://admin:pw@db.example.com:5432/app')).toEqual(['db.example.com']);
  });

  it('should read a URL given as an --option=value', () => {
    expect(hostsOf('curl --url=https://x.example.com/a')).toEqual(['x.example.com']);
  });

  it('should read user@host and user@host:path arguments', () => {
    expect(hostsOf('ssh deploy@db.example.com')).toEqual(['db.example.com']);
    expect(hostsOf('rsync a user@h.example.com:/p')).toEqual(['h.example.com']);
  });

  it('should read a bare dotted hostname argument', () => {
    expect(hostsOf('ping Prod.Example.com')).toEqual(['prod.example.com']);
  });

  it('should not read a path, a flag, a plain word or a sentence as a host', () => {
    expect(hostsOf('cat ./notes/a.b src/x.ts -v.x')).toEqual([]);
    expect(hostsOf('echo hello')).toEqual([]);
    expect(hostsOf('git commit -m "met bob@x.example.com today"')).toEqual([]);
  });
});

describe('readCommand: output hidden by a pipe or by || true', () => {
  it('should flag a part as piped when its output goes into |', () => {
    expect(partsOf('npm test | tail').map((p) => p.pipedOut)).toEqual([true, false]);
  });

  it('should flag a part as piped when its output goes into |&', () => {
    expect(partsOf('a |& b').map((p) => p.pipedOut)).toEqual([true, false]);
  });

  it('should not flag a part followed by && as piped', () => {
    expect(partsOf('a && b').map((p) => p.pipedOut)).toEqual([false, false]);
  });

  it('should flag a part followed by || true or || :', () => {
    expect(partsOf('npm test || true').map((p) => p.orTrue)).toEqual([true, false]);
    expect(partsOf('npm test || :').map((p) => p.orTrue)).toEqual([true, false]);
  });

  it('should not flag a part followed by || another command, or by && true', () => {
    expect(partsOf('npm test || echo x')[0].orTrue).toBe(false);
    expect(partsOf('npm test || true x')[0].orTrue).toBe(false);
    expect(partsOf('npm test && true')[0].orTrue).toBe(false);
  });
});
