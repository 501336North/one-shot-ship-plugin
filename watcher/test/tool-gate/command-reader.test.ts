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

const isUnreadable = (cmd: string): boolean => 'unreadable' in readCommand(cmd, CWD, HOME);
const gitOf = (cmd: string): CommandPart['git'][] => partsOf(cmd).flatMap((p) => (p.git ? [p.git] : []));
/** Wraps a script in `bash -c '…'`, quoting it the way a person would. */
const bashC = (script: string): string => `bash -c '${script.replace(/'/g, `'\\''`)}'`;

describe('readCommand: scripts run by a nested shell or eval (ADR-009)', () => {
  it.each([
    "bash -c 'git push --force'",
    "sh -c 'git push --force'",
    "zsh -c 'git push --force'",
    "dash -c 'git push --force'",
    "ksh -c 'git push --force'",
    "/bin/bash -c 'git push --force'",
    "bash -lc 'git push --force'",
    "bash -e -c 'git push --force'",
    "bash --norc -c 'git push --force'",
    "bash -o pipefail -c 'git push --force'",
  ])('should read %s as a git push part', (cmd) => {
    expect(gitOf(cmd)).toEqual([{ subcommand: 'push', args: ['--force'], dir: '/work/repo' }]);
  });

  it('should read a shell script nested inside another shell script', () => {
    expect(gitOf(`bash -c "sh -c 'git push'"`)).toEqual([{ subcommand: 'push', args: [], dir: '/work/repo' }]);
  });

  it('should keep the outer shell part and add the script\'s parts after it', () => {
    expect(programsOf("bash -c 'cd a && git push' && ls")).toEqual(['bash', 'cd', 'git', 'ls']);
  });

  it('should start the script in the outer part\'s directory and keep a cd inside it to the script', () => {
    expect(cwdsOf("cd sub && bash -c 'cd inner && git push' && git status")).toEqual([
      '/work/repo', '/work/repo/sub', '/work/repo/sub', '/work/repo/sub/inner', '/work/repo/sub',
    ]);
  });

  it('should not read a script run by a shell given only a file, or a -c that is only an argument', () => {
    expect(programsOf('bash scripts/build.sh')).toEqual(['bash']);
    expect(gitOf("echo bash -c 'git push'")).toEqual([]);
  });

  it.each([
    "bash -c 'echo $(whoami)'",
    "bash -c 'echo `whoami`'",
    'bash -c "$X"',
    "bash -c '$X'",
    "bash -c 'git push ${REMOTE}'",
    "bash -c 'git push $_r'",
    'bash -c "$(curl x)"',
  ])('should stay unreadable when the script is not literal: %s', (cmd) => {
    expect(isUnreadable(cmd)).toBe(true);
  });

  it('should read five nested scripts and stay unreadable at six', () => {
    let five = 'git push -f';
    for (let i = 0; i < 5; i++) five = bashC(five);
    expect(gitOf(five)).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    expect(isUnreadable(bashC(five))).toBe(true);
  });

  it('should read eval of literal words as the command they spell', () => {
    expect(gitOf("eval 'git push -f'")).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    expect(gitOf('eval git push -f')).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    expect(gitOf("X=1 eval 'cd sub &&' git push")).toEqual([{ subcommand: 'push', args: [], dir: '/work/repo/sub' }]);
  });

  it('should stay unreadable for eval of a variable', () => {
    expect(isUnreadable('eval "$X"')).toBe(true);
  });

  it('should hide the script\'s results when the shell\'s output is piped or followed by || true', () => {
    const piped = partsOf("bash -c 'npm test' | tail").find((p) => p.program === 'npm');
    expect(piped?.pipedOut).toBe(true);
    const orTrue = partsOf("bash -c 'npm test' || true").find((p) => p.program === 'npm');
    expect(orTrue?.orTrue).toBe(true);
  });
});

describe('readCommand: the real program behind a wrapper (ADR-009)', () => {
  it.each([
    'env git push -f',
    'env -i FOO=1 git push -f',
    'env -u HOME git push -f',
    '/usr/bin/env FOO=bar git push -f',
    'env -- git push -f',
    'env -S "git push -f"',
    'sudo git push -f',
    'sudo -u root -g wheel git push -f',
    'sudo -E -H git push -f',
    'sudo -C 5 git push -f',
    'sudo --user=root FOO=1 git push -f',
    'command git push -f',
    'command -p git push -f',
    'nice git push -f',
    'nice -n 5 git push -f',
    'nice -n5 git push -f',
    'nohup git push -f',
    'time git push -f',
    'time -p git push -f',
    'xargs git push -f',
    'xargs -n1 git push -f',
    'xargs -n 1 -P 4 git push -f',
    'exec git push -f',
    'exec -a name git push -f',
    'doas git push -f',
    'doas -u root git push -f',
    'stdbuf -oL git push -f',
    'stdbuf -o L -e 0 git push -f',
    'timeout 10 git push -f',
    'timeout -s KILL 10s git push -f',
    'timeout --signal=TERM 5 git push -f',
    'sudo env FOO=1 nice -n 5 timeout 3 git push -f',
  ])('should find git push behind %s', (cmd) => {
    const [part] = partsOf(cmd);
    expect(part.program).toBe('git');
    expect(part.words).toEqual(['git', 'push', '-f']);
    expect(part.git).toEqual({ subcommand: 'push', args: ['-f'], dir: '/work/repo' });
  });

  it('should run the program in the directory sudo -D or env -C names', () => {
    expect(partsOf('sudo -D /srv/app git push')[0].git?.dir).toBe('/srv/app');
    expect(partsOf('sudo -D /srv/app git push')[0].cwd).toBe('/srv/app');
    expect(partsOf('cd sub && sudo -D x git push')[1].git?.dir).toBe('/work/repo/sub/x');
    expect(partsOf('env -C sub git push')[0].git?.dir).toBe('/work/repo/sub');
  });

  it('should read files written and hosts reached by the wrapped program', () => {
    expect(writesOf('sudo rm -rf /etc/x')).toEqual(['/etc/x']);
    expect(writesOf('nohup cp a b')).toEqual(['/work/repo/b']);
    expect(hostsOf('sudo -u ops curl https://api.example.com/x')).toEqual(['api.example.com']);
  });

  it('should read a nested shell behind a wrapper', () => {
    expect(gitOf("sudo bash -c 'git push -f'")).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
  });

  it('should keep a wrapper that runs no program as it is', () => {
    expect(partsOf('env')[0].words).toEqual(['env']);
    expect(partsOf('env FOO=1')[0].program).toBe('env');
  });

  it('should stay unreadable when env -S splits a string that cannot be read', () => {
    expect(isUnreadable("env -S 'git push \"main'")).toBe(true);
  });
});

describe('readCommand: redirects that write a file', () => {
  it('should list the file of >& written with a space, and not an output number', () => {
    expect(writesOf('echo x >& out.txt')).toEqual(['/work/repo/out.txt']);
    expect(writesOf('echo x &> out.txt')).toEqual(['/work/repo/out.txt']);
    expect(writesOf('echo x >| out.txt')).toEqual(['/work/repo/out.txt']);
    expect(writesOf('echo x >& 2')).toEqual([]);
  });

  it('should list the file of a read-write <> redirect, with or without an output number', () => {
    expect(writesOf('cat <> data.txt')).toEqual(['/work/repo/data.txt']);
    expect(writesOf('echo x 1<> data.txt')).toEqual(['/work/repo/data.txt']);
    expect(writesOf('exec 3<>sock')).toEqual(['/work/repo/sock']);
  });
});

describe('readCommand: output of a ( … ) group hidden by a pipe or by || true', () => {
  it('should flag the parts inside ( … ) as piped when the group\'s output goes into |', () => {
    expect(partsOf('(npm test) | tail').map((p) => p.pipedOut)).toEqual([true, false]);
    expect(partsOf('(cd sub && npm test) | tail').map((p) => p.pipedOut)).toEqual([true, true, false]);
    expect(partsOf('((npm test)) |& tail').map((p) => p.pipedOut)).toEqual([true, false]);
  });

  it('should flag the parts inside ( … ) when the group is followed by || true', () => {
    expect(partsOf('(npm test) || true').map((p) => p.orTrue)).toEqual([true, false]);
  });

  it('should not flag the parts of a group followed by && or by || another command', () => {
    expect(partsOf('(npm test) && ls').map((p) => p.pipedOut || p.orTrue)).toEqual([false, false]);
    expect(partsOf('(npm test) || echo x').map((p) => p.orTrue)).toEqual([false, false]);
  });

  it('should keep the pipes inside a group as they are', () => {
    expect(partsOf('(a | b) && c').map((p) => p.pipedOut)).toEqual([true, false, false]);
  });
});

describe('readCommand: a cd that runs apart from the rest of the command', () => {
  it('should not move later parts after a cd whose output is piped', () => {
    expect(cwdsOf('cd x | cat; git push')).toEqual(['/work/repo', '/work/repo', '/work/repo']);
  });

  it('should not move later parts after a cd that reads from a pipe', () => {
    expect(cwdsOf('cat y | cd x; git push')).toEqual(['/work/repo', '/work/repo', '/work/repo']);
  });

  it('should not move later parts after a cd run in the background', () => {
    expect(cwdsOf('cd x & git push')).toEqual(['/work/repo', '/work/repo']);
  });
});
