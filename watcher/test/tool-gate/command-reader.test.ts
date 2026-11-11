/**
 * @behavior The tool gate turns an agent's shell command into one set of facts per part:
 *   which program runs, in which directory (after `cd`, `( … )` and `git -C`), which files it
 *   writes or removes, which hosts it talks to, and whether its result is hidden by a pipe or
 *   by `|| true`. The rules check these facts instead of re-reading the raw text.
 * @business-rule `cd sub && git push` and `git -C sub push` are pushes from `sub` (AC-001.3);
 *   a test run piped away or followed by `|| true` does not count as a result (AC-005.3);
 *   `curl https://api.example.com/x` talks to `api.example.com` (AC-007.1). A command hidden in
 *   `$( … )`, backticks or `<( … )` is still a part, so `x=$(git push --force)` is a push. A command
 *   the tokenizer cannot read stays unreadable.
 */

import { describe, it, expect } from 'vitest';
import { readCommand, type CommandPart } from '../../src/tool-gate/command-reader.js';
import { UNKNOWN } from '../../src/tool-gate/tokenize.js';

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

  it('should read the parts before an unterminated quote and mark the command unreadable', () => {
    const result = readCommand('git push origin main; echo "x', CWD, HOME);
    expect(result).toMatchObject({ unreadable: true, limit: false });
    expect(result.parts.map((p) => p.words)).toEqual([['git', 'push', 'origin', 'main'], ['echo']]);
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

  it('should list the file cp writes inside a destination written with a trailing slash (R2c)', () => {
    expect(writesOf('cp a sub/b dest/')).toEqual(['/work/repo/dest/a', '/work/repo/dest/b']);
    expect(writesOf('cp ~/.oss/hooks/oss-statusline.sh "$HOME/.oss/"')).toEqual(['/home/dev/.oss/oss-statusline.sh']);
  });

  it.each(['cp -r src/ dest/', 'cp -r . dest/', 'cp "$X" dest/', 'cp * dest/', 'cp -T a dest/', 'cp -r .. dest/'])(
    'should list the destination itself for %s, whose copy may land anywhere inside it (R2c)',
    (cmd) => {
      expect(writesOf(cmd)).toEqual(['/work/repo/dest']);
    },
  );

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

  it('should read a bare dotted hostname followed by a path, as HTTPie takes it', () => {
    expect(hostsOf('http POST API.example.com/x')).toEqual(['api.example.com']);
  });

  it('should not read a host from a commit message that only mentions one', () => {
    expect(hostsOf('git commit -m "fix api.example.com timeout"')).toEqual([]);
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

describe('readCommand: commands inside shell keywords (if, loops, case, braces, functions)', () => {
  it('should read the condition and the body of an if as parts', () => {
    expect(programsOf('if x; then git push -f; fi')).toEqual(['x', 'git']);
    expect(gitOf('if x; then git push -f; fi')).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
  });

  it('should read every branch of an if with elif and else', () => {
    expect(programsOf('if a; then b; elif git push -f; then c; else git push; fi')).toEqual(['a', 'b', 'git', 'c', 'git']);
  });

  it('should read the condition and the body of while and until loops', () => {
    expect(programsOf('while x; do git push -f; done')).toEqual(['x', 'git']);
    expect(programsOf('until x; do git push -f; done')).toEqual(['x', 'git']);
  });

  it('should read the body of a for loop and not its header', () => {
    expect(programsOf('for i in a b; do git push; done')).toEqual(['git']);
    expect(programsOf('for i in a b\ndo git push -f\ndone')).toEqual(['git']);
  });

  it('should read the commands of a case and not its patterns', () => {
    expect(programsOf('case $x in a) git push -f;; b|c) ls;; esac')).toEqual(['git', 'ls']);
    expect(programsOf('case $x in (a) git push -f;; esac')).toEqual(['git']);
    expect(programsOf('case $x in a) ls;; *) git push -f; esac; pwd')).toEqual(['ls', 'git', 'pwd']);
  });

  it('should read the commands inside { … }, after ! and after time', () => {
    expect(programsOf('{ git push -f; }')).toEqual(['git']);
    expect(programsOf('! git push -f')).toEqual(['git']);
    expect(programsOf('time git push')).toEqual(['git']);
  });

  it('should read the body of a function definition as parts', () => {
    expect(programsOf('function f { git push; }')).toEqual(['git']);
    expect(programsOf('f() { git push; }')).toEqual(['git']);
    expect(programsOf('function f() { git push; }')).toEqual(['git']);
  });

  it('should read keywords nested inside each other', () => {
    expect(programsOf('if x; then while y; do { ! git push -f; }; done; fi')).toEqual(['x', 'y', 'git']);
  });

  it('should treat a keyword as a plain word when it is not where a command starts', () => {
    expect(partsOf('echo then')[0].words).toEqual(['echo', 'then']);
    expect(partsOf('echo if fi done { } !')[0].words).toEqual(['echo', 'if', 'fi', 'done', '{', '}', '!']);
  });
});

describe('readCommand: output of a { … } group hidden by a pipe or by || true', () => {
  it('should flag the parts inside { … } as piped when the group\'s output goes into |', () => {
    expect(partsOf('{ npm test; } | tail').map((p) => p.pipedOut)).toEqual([true, false]);
  });

  it('should flag the parts inside { … } when the group is followed by || true', () => {
    expect(partsOf('{ cd sub && npm test; } || true').map((p) => p.orTrue)).toEqual([true, true, false]);
  });

  it('should carry a cd inside { … } to later parts, but not a cd inside ( … )', () => {
    expect(cwdsOf('{ cd sub; } && git push')).toEqual(['/work/repo', '/work/repo/sub']);
    expect(cwdsOf('(cd sub) && git push')).toEqual(['/work/repo', '/work/repo']);
  });
});

describe('readCommand: positional and special parameters in a nested script', () => {
  it.each([
    "bash -c '\"$@\"' _ git push -f",
    "sh -c '$1' sh x",
    "bash -c 'git push $*'",
    "bash -c 'echo $#'",
    "bash -c 'echo $?'",
    "bash -c 'echo $!'",
    "bash -c 'echo $$'",
    "bash -c 'echo $-'",
    'eval "$@"',
  ])('should stay unreadable when the script uses a positional or special parameter: %s', (cmd) => {
    expect(isUnreadable(cmd)).toBe(true);
  });

  it('should keep a program that is a variable as an unknown word (documented limit)', () => {
    const [part] = partsOf('$G push -f');
    expect(part.words).toEqual([UNKNOWN, 'push', '-f']);
    expect(part.git).toBeNull();
  });
});

describe('readCommand: grouped options where one takes a value', () => {
  it.each([
    'sudo -Eu root git push',
    'sudo -uroot git push',
    'sudo -HEu root git push',
    'env -iu HOME git push',
  ])('should find git behind %s', (cmd) => {
    const [part] = partsOf(cmd);
    expect(part.program).toBe('git');
    expect(part.words).toEqual(['git', 'push']);
  });

  it('should run the program in the directory a grouped sudo -D names', () => {
    expect(partsOf('sudo -ED /srv/app git push')[0].git?.dir).toBe('/srv/app');
  });

  it.each([
    "bash -eo pipefail -c 'git push -f'",
    "bash -oc pipefail 'git push -f'",
    "bash -eO extglob -c 'git push -f'",
  ])('should read %s as a git push part', (cmd) => {
    expect(gitOf(cmd)).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
  });
});

describe('readCommand: other ways to change directory', () => {
  it.each(['command cd sub', 'builtin cd sub', 'time cd sub', 'pushd sub'])(
    'should move later parts after %s',
    (cd) => {
      expect(cwdsOf(`${cd} && git push`)).toEqual(['/work/repo', '/work/repo/sub']);
    },
  );

  it('should go back to the directory before the matching pushd on popd', () => {
    expect(cwdsOf('pushd sub && popd && git push')).toEqual(['/work/repo', '/work/repo/sub', '/work/repo']);
    expect(partsOf('cd a && pushd b && pushd c; popd; git push').at(-1)?.cwd).toBe('/work/repo/a/b');
  });

  it('should stay in the same directory on a popd with no matching pushd', () => {
    expect(cwdsOf('cd a; popd; git push')).toEqual(['/work/repo', '/work/repo/a', '/work/repo/a']);
  });

  it('should find the program behind builtin', () => {
    expect(gitOf('builtin git push -f')).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
  });
});

describe('readCommand: write targets keep .. for the disk to resolve', () => {
  it('should keep a .. that follows a folder name in a redirect target', () => {
    expect(writesOf('echo x > link/../tool-gates.json')).toEqual(['/work/repo/link/../tool-gates.json']);
  });

  it('should keep a .. read against the part\'s directory', () => {
    expect(writesOf('cd sub && rm ../x')).toEqual(['/work/repo/sub/../x']);
  });

  it('should drop a .. at the top of the file system, as the disk does', () => {
    expect(writesOf('rm /../etc/x')).toEqual(['/etc/x']);
  });
});

describe('readCommand: more programs that write files', () => {
  it.each([
    ['tee f', ['f']],
    ['tee -a f1 f2', ['f1', 'f2']],
    ['sudo tee f', ['f']],
    ['/usr/bin/tee f', ['f']],
  ])('should list every file tee writes: %s', (cmd, files) => {
    expect(writesOf(cmd)).toEqual(files.map((f) => `/work/repo/${f}`));
  });

  it.each([
    ["sed -i 's/a/b/' f", ['f']],
    ["sed -i.bak 's/a/b/' f", ['f']],
    ["sed --in-place=.bak 's/a/b/' f", ['f']],
    ["sed -E -i 's/a/b/' f1 f2", ['f1', 'f2']],
    ["sed -i -e 's/a/b/' f1 f2", ['f1', 'f2']],
    ['sed -i -f edits.sed f', ['f']],
    ["sed -i '' 's/a/b/' f", ['f']],
  ])('should list the files sed edits in place: %s', (cmd, files) => {
    expect(writesOf(cmd)).toEqual(files.map((f) => `/work/repo/${f}`));
  });

  it('should list nothing for sed that only prints', () => {
    expect(writesOf("sed 's/a/b/' f")).toEqual([]);
  });

  it.each([
    ["perl -i -pe 's/a/b/' f", ['f']],
    ["perl -pi -e 's/a/b/' f", ['f']],
    ["perl -i.bak -p -e 's/a/b/' f1 f2", ['f1', 'f2']],
  ])('should list the files perl edits in place: %s', (cmd, files) => {
    expect(writesOf(cmd)).toEqual(files.map((f) => `/work/repo/${f}`));
  });

  it('should list nothing for perl that only prints', () => {
    expect(writesOf("perl -pe 's/a/b/' f")).toEqual([]);
  });

  it('should list the output file of dd', () => {
    expect(writesOf('dd if=x of=f bs=1')).toEqual(['/work/repo/f']);
  });

  it.each([
    ['truncate -s 0 f', ['f']],
    ['truncate --size=0 f g', ['f', 'g']],
  ])('should list the files truncate cuts, not the size: %s', (cmd, files) => {
    expect(writesOf(cmd)).toEqual(files.map((f) => `/work/repo/${f}`));
  });

  it('should list every file touch creates', () => {
    expect(writesOf('touch f g')).toEqual(['/work/repo/f', '/work/repo/g']);
  });

  it.each([
    ['ln -s target linkname', 'linkname'],
    ['ln -sf target dir/', 'dir'],
    ['ln -s -t dir a b', 'dir'],
  ])('should list the link ln makes, not its target: %s', (cmd, file) => {
    expect(writesOf(cmd)).toEqual([`/work/repo/${file}`]);
  });

  it.each([
    ['install -m 644 src dest', 'dest'],
    ['install -t dir a b', 'dir'],
  ])('should list the destination of install: %s', (cmd, file) => {
    expect(writesOf(cmd)).toEqual([`/work/repo/${file}`]);
  });

  it.each([
    ['chmod 600 f', ['f']],
    ['chmod -R 755 a b', ['a', 'b']],
    ['chown u:g f', ['f']],
  ])('should list the files chmod and chown change, not the mode or owner: %s', (cmd, files) => {
    expect(writesOf(cmd)).toEqual(files.map((f) => `/work/repo/${f}`));
  });

  it.each([
    ['git checkout -- f', ['f']],
    ['git checkout HEAD -- f g', ['f', 'g']],
    ['git restore f', ['f']],
    ['git restore --source=HEAD f', ['f']],
    ['git restore -s HEAD f', ['f']],
    ['git -C sub restore f', ['sub/f']],
  ])('should list the files git puts back: %s', (cmd, files) => {
    expect(writesOf(cmd)).toEqual(files.map((f) => `/work/repo/${f}`));
  });

  it('should list nothing for git checkout of a branch', () => {
    expect(writesOf('git checkout main')).toEqual([]);
  });
});

describe('readCommand: commands run by a substitution', () => {
  it('should read the command inside $( … ) as its own part, before the command that uses it', () => {
    const parts = partsOf('git push --force origin "$(git branch --show-current)"');
    expect(parts.map((p) => p.git)).toEqual([
      { subcommand: 'branch', args: ['--show-current'], dir: '/work/repo' },
      { subcommand: 'push', args: ['--force', 'origin', UNKNOWN], dir: '/work/repo' },
    ]);
  });

  it('should read a push hidden in a variable assignment', () => {
    expect(gitOf('x=$(git push --force)')).toEqual([{ subcommand: 'push', args: ['--force'], dir: '/work/repo' }]);
  });

  it('should read a removal hidden in backticks, with the file it removes', () => {
    expect(writesOf('`rm -rf .oss/tool-gates`')).toEqual(['/work/repo/.oss/tool-gates']);
  });

  it('should read the command of a substitution in a redirect target or a loop list', () => {
    expect(gitOf('echo hi > "$(git push -f)"').map((g) => g.subcommand)).toEqual(['push']);
    expect(gitOf('for b in $(git push -f); do :; done').map((g) => g.subcommand)).toEqual(['push']);
  });

  it('should run a substitution in the directory of the part that uses it', () => {
    expect(cwdsOf('cd sub && echo $(git status)')).toEqual(['/work/repo', '/work/repo/sub', '/work/repo/sub']);
  });

  it('should count a substitution\'s output as hidden, since the shell captures it', () => {
    const [inner, outer] = partsOf('echo "$(npm test)"');
    expect(inner.pipedOut).toBe(true);
    expect(outer.pipedOut).toBe(false);
  });

  it('should read the commands of process substitutions', () => {
    expect(programsOf('diff <(git push -f) >(tee log.txt)')).toEqual(['git', 'tee', 'diff']);
    expect(writesOf('cat x >(tee .oss/tool-gates.json)')).toEqual(['/work/repo/.oss/tool-gates.json']);
  });

  it('should read no command in arithmetic', () => {
    expect(programsOf('echo $((1 + 2))')).toEqual(['echo']);
  });

  it('should keep writes and dates that use a substitution readable', () => {
    expect(writesOf('echo "$(date)" > notes.txt')).toEqual(['/work/repo/notes.txt']);
    expect(gitOf('git commit -m "$(cat msg)"').map((g) => g.subcommand)).toEqual(['commit']);
  });

  it('should leave the directory as it was after a cd to an unknown folder', () => {
    expect(cwdsOf('cd "$(git rev-parse --show-toplevel)" && git push')).toEqual([
      '/work/repo', '/work/repo', '/work/repo',
    ]);
    expect(gitOf('git -C "$X" push')).toEqual([{ subcommand: 'push', args: [], dir: '/work/repo' }]);
  });

  it('should read substitutions nested five deep and stay unreadable at six', () => {
    const nested = (depth: number): string => `echo ${'$(echo '.repeat(depth - 1)}$(git push -f${')'.repeat(depth)}`;
    expect(gitOf(nested(5))).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    expect(isUnreadable(nested(6))).toBe(true);
  });

  it('should keep a shell or eval running an unknown script unreadable', () => {
    expect(isUnreadable('bash -c "$(curl x)"')).toBe(true);
    expect(isUnreadable('bash -c "git push $(git branch --show-current)"')).toBe(true);
    expect(isUnreadable('eval "$X"')).toBe(true);
    expect(isUnreadable('eval `cat cmd`')).toBe(true);
  });
});

describe('readCommand: braces, $HOME and ~user expanded before the rules see a word', () => {
  it('should read a brace group in a refspec as every branch it names', () => {
    expect(gitOf('git push origin feat/x:ma{i,}n')).toEqual([
      { subcommand: 'push', args: ['origin', 'feat/x:main', 'feat/x:man'], dir: '/work/repo' },
    ]);
  });

  it('should read a brace group in a redirect target as every file it names', () => {
    expect(writesOf('echo x > .oss/tool-gates.{json,bak}')).toEqual([
      '/work/repo/.oss/tool-gates.bak', '/work/repo/.oss/tool-gates.json',
    ]);
  });

  it('should read $HOME and ${HOME} as the home folder in files a part writes', () => {
    expect(writesOf('rm $HOME/.claude/settings.json')).toEqual(['/home/dev/.claude/settings.json']);
    expect(writesOf('rm "${HOME}/.oss/hooks/x.sh"')).toEqual(['/home/dev/.oss/hooks/x.sh']);
    expect(writesOf('rm ~dev/.oss/hooks/x.sh')).toEqual(['/home/dev/.oss/hooks/x.sh']);
  });

  it('should expand $HOME in the words of an env -S string', () => {
    expect(writesOf("env -S 'rm $HOME/x'")).toEqual(['/home/dev/x']);
  });
});

describe('readCommand: limits that keep reading fast', () => {
  it('should return within 1 s for 100k nested { a; groups', () => {
    const started = Date.now();
    readCommand(`${'{ a; '.repeat(100_000)}${'}; '.repeat(100_000)}`, CWD, HOME);
    readCommand('{ a; '.repeat(100_000), CWD, HOME);
    readCommand(`${'( a; '.repeat(100_000)}${') '.repeat(100_000)}`, CWD, HOME);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('should read groups nested 64 deep and mark deeper nesting unreadable', () => {
    const nested = (depth: number): string => `${'{ '.repeat(depth)}git push -f;${' }'.repeat(depth)}`;
    expect(gitOf(nested(64))).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    expect(isUnreadable(nested(65))).toBe(true);
  });

  it('should return within 1 s for 40k wrappers', () => {
    const started = Date.now();
    readCommand(`${'env '.repeat(40_000)}git push -f`, CWD, HOME);
    readCommand(`${'nice -n 1 '.repeat(40_000)}git push -f`, CWD, HOME);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('should read a program behind 64 wrappers and mark more unreadable', () => {
    expect(gitOf(`${'env '.repeat(64)}git push -f`)).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    expect(isUnreadable(`${'env '.repeat(65)}git push -f`)).toBe(true);
  });
});

describe('readCommand: reading limits stop the read, other unreadable pieces are read past (ADR-010)', () => {
  const verdictOf = (cmd: string): string => {
    const result = readCommand(cmd, CWD, HOME);
    if (!('unreadable' in result)) return 'readable';
    return result.limit ? 'limit' : 'unreadable';
  };

  it('should keep the part of a shell whose script is not literal, mark it unreadable, and read the rest', () => {
    const result = readCommand("bash -c 'echo $0; git push --force'; git push origin main", CWD, HOME);
    expect(result).toMatchObject({ unreadable: true, limit: false });
    expect(result.parts.map((p) => p.program)).toEqual(['bash', 'git']);
  });

  it('should count nesting, groups and wrappers past their caps as reading limits', () => {
    let six = 'git push -f';
    for (let i = 0; i < 6; i++) six = bashC(six);
    expect(verdictOf(six)).toBe('limit');
    expect(verdictOf(`${'{ '.repeat(65)}git push -f;${' }'.repeat(65)}`)).toBe('limit');
    expect(verdictOf(`${'env '.repeat(65)}git push -f`)).toBe('limit');
  });

  it('should count the words of nested scripts toward the call\'s 2048 words', () => {
    const inner = `echo ${'w '.repeat(1500)}`;
    expect(verdictOf(`bash -c '${inner}'; echo ${'v '.repeat(1000)}`)).toBe('limit');
  });
});

describe('readCommand: shell wildcards in write targets and words', () => {
  it('should give the absolute pattern of each write target written with an unquoted wildcard', () => {
    expect(partsOf('rm -rf .oss/* dist/x; echo x > ~/.claude/settings.js?n').map((p) => p.writeGlobs)).toEqual([
      ['/work/repo/.oss/*'],
      ['/home/dev/.claude/settings.js?n'],
    ]);
  });

  it('should give no pattern for a quoted wildcard', () => {
    expect(partsOf("rm '.oss/*'")[0].writeGlobs).toEqual([]);
  });

  it('should escape wildcard characters of the folder the pattern is joined to', () => {
    expect(partsOf("cd 'a*b' && rm *")[1].writeGlobs).toEqual(['/work/repo/a\\*b/*']);
  });

  it('should give the pattern of every word written with an unquoted wildcard', () => {
    const [part] = partsOf("git add src/*.ts 'x*'");
    expect(part.globs.get('src/*.ts')).toBe('src/*.ts');
    expect(part.globs.has('x*')).toBe(false);
  });
});

describe('readCommand: other ways to push are read as git push', () => {
  it.each([
    ['git send-pack origin feat:main', ['origin', 'feat:main']],
    ['git http-push https://x/r.git feat:main', ['https://x/r.git', 'feat:main']],
    ['git-push -f origin feat', ['-f', 'origin', 'feat']],
    ['/usr/libexec/git-core/git-push origin feat:main', ['origin', 'feat:main']],
    ['git-send-pack --force origin feat', ['--force', 'origin', 'feat']],
    ['git-http-push https://x/r.git feat:main', ['https://x/r.git', 'feat:main']],
    ['"$(git --exec-path)/git-push" origin feat:main', ['origin', 'feat:main']],
  ])('should read %s as a push', (cmd, args) => {
    expect(gitOf(cmd).filter((g) => g.subcommand === 'push')).toEqual([{ subcommand: 'push', args, dir: '/work/repo' }]);
  });

  it('should read git subtree push as a push of its remote ref, without the subtree options', () => {
    expect(gitOf('git subtree push --prefix=dist -m note origin main')).toEqual([
      { subcommand: 'push', args: ['origin', 'main'], dir: '/work/repo' },
    ]);
    expect(gitOf('git subtree push -P dist origin gh-pages')).toEqual([
      { subcommand: 'push', args: ['origin', 'gh-pages'], dir: '/work/repo' },
    ]);
  });

  it('should leave other subtree commands alone', () => {
    expect(gitOf('git subtree split -P dist')).toEqual([{ subcommand: 'subtree', args: ['split', '-P', 'dist'], dir: '/work/repo' }]);
  });
});

describe('readCommand: git global options before the subcommand', () => {
  it.each([
    'git --attr-source HEAD push -f',
    'git --config-env user.name=X push -f',
    'git --shallow-file x push -f',
    'git --namespace x push -f',
    'git --exec-path x push -f',
    'git --super-prefix x push -f',
    'git --list-cmds x push -f',
    'git --attr-source=HEAD --no-pager -P push -f',
  ])('should skip the value of the global option in %s and find the push', (cmd) => {
    expect(gitOf(cmd)).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
  });

  it('should note a global option it does not know, and read on as if it took no value', () => {
    expect(gitOf('git --frobnicate x push')).toEqual([
      { subcommand: 'x', args: ['push'], dir: '/work/repo', unknownOption: '--frobnicate' },
    ]);
  });

  it('should note nothing for the options it knows', () => {
    expect(gitOf('git --no-pager log')).toEqual([{ subcommand: 'log', args: [], dir: '/work/repo' }]);
  });
});

describe('readCommand: program names on a case-insensitive file system (macOS, Windows)', () => {
  function caseless(cmd: string): CommandPart[] {
    const result = readCommand(cmd, CWD, HOME, true);
    if ('unreadable' in result) throw new Error(`expected a readable command: ${result.reason}`);
    return result.parts;
  }
  const pushesOf = (parts: CommandPart[]): string[][] => parts.flatMap((p) => (p.git?.subcommand === 'push' ? [p.git.args] : []));

  it.each(['GIT push -f', 'Git push -f', "Bash -c 'git push -f'", 'ENV git push -f', 'Sudo git push -f', 'COMMAND git push -f', 'NICE git push -f'])(
    'should find the push in %s, since the file system finds the program in any case',
    (cmd) => {
      expect(pushesOf(caseless(cmd))).toEqual([['-f']]);
    },
  );

  it('should give each part its program name in lower case, for matching program lists', () => {
    expect(caseless('RM -rf x; Python3 -c 1').map((p) => p.name)).toEqual(['rm', 'python3']);
    expect(caseless('RM x')[0].writeTargets).toEqual(['/work/repo/x']);
  });

  it('should keep names as written where letter case matters (Linux)', () => {
    expect(pushesOf(partsOf('GIT push -f'))).toEqual([]);
    expect(partsOf('RM x')[0].name).toBe('RM');
  });

  it('should keep shell builtins exact, since the shell finds them by exact name: CD does not move the shell', () => {
    expect(caseless('CD sub && ls').map((p) => p.cwd)).toEqual(['/work/repo', '/work/repo']);
    expect(pushesOf(caseless("EVAL 'git push -f'"))).toEqual([]);
  });
});

describe('readCommand: zsh precommand modifiers, =cmd and clobber redirects', () => {
  it.each(['noglob git push -f', 'nocorrect git push -f', '- git push -f', '=git push -f', 'sudo =git push -f', 'noglob =env git push -f'])(
    'should find the push in %s',
    (cmd) => {
      expect(gitOf(cmd)).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    },
  );

  it.each(['>!', '>>!', '>|', '>>|', '&>!', '&>|', '&>>!', '&>>|', '>&!', '>&|', '>>&!', '>>&|', '2>!'])(
    'should read %s as a write of the next word',
    (op) => {
      expect(writesOf(`cat /dev/null ${op} out.txt`)).toEqual(['/work/repo/out.txt']);
    },
  );
});

describe('readCommand: directories the reader cannot follow', () => {
  const lostOf = (cmd: string): (string | null)[] => partsOf(cmd).map((p) => p.lostDir?.why.replaceAll(UNKNOWN, '…') ?? null);

  it.each([
    ['cd - && x', 'cd -'],
    ['cd a b && x', 'cd a b'],
    ['pushd && x', 'pushd'],
    ['pushd +1 && x', 'pushd +1'],
    ['pushd -2 && x', 'pushd -2'],
    ['pushd sub && popd && x', 'popd'],
    ['D=x; cd "$D" && x', 'cd …'],
    ['pushd "$D" && x', 'pushd …'],
  ])('should mark the part after %s as running in a folder it cannot follow', (cmd, why) => {
    expect(lostOf(cmd).at(-1)).toBe(why);
  });

  it('should resolve cd -P and cd -L to their directory', () => {
    expect(cwdsOf('cd -P /tmp/x && a; cd -L ../y && b; cd -- z && c')).toEqual(['/work/repo', '/tmp/x', '/tmp/x', '/tmp/y', '/tmp/y', '/tmp/y/z']);
    expect(lostOf('cd -P /tmp/x && a')).toEqual([null, null]);
  });

  it('should know the directory again after a cd to an absolute path or home', () => {
    // each cd runs where the shell was before it
    expect(lostOf('cd - && a; cd /tmp && b; cd - && c; cd && d')).toEqual([null, 'cd -', 'cd -', null, null, 'cd -', 'cd -', null]);
  });

  it('should keep a ( … ) group from losing the directory of what follows it', () => {
    expect(lostOf('(cd -; a); b')).toEqual([null, 'cd -', null]);
  });

  it('should mark a git -C, env -C or sudo -D whose directory is only known when it runs', () => {
    expect(lostOf('git -C "$D" push; env -C "$D" git push; sudo -D "$D" git push').map((w) => w !== null)).toEqual([true, true, true]);
  });
});

describe('readCommand: settings whose value git runs as a command', () => {
  it.each([
    ["git -c diff.external='git push -f' diff", 'diff'],
    ["GIT_EXTERNAL_DIFF='git push -f' git diff", 'diff'],
    ["git -c alias.x='!git push -f' x", 'x'],
    ["PAGER='git push -f' git log", 'log'],
    ["GIT_SSH_COMMAND='git push -f' npm run deploy", null],
  ])('should read the value in %s as a command that runs', (cmd, sub) => {
    const parts = partsOf(cmd);
    expect(parts.map((p) => p.git?.subcommand ?? null)).toContain(sub);
    expect(gitOf(cmd).filter((g) => g.subcommand === 'push')).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
  });

  it('should give each part the values of the variables set for it', () => {
    expect(partsOf('A=1 B=x/y env C=z foo').map((p) => p.assignmentValues)).toEqual([['1', 'x/y', 'z']]);
  });
});

describe('readCommand: scripts fed on stdin', () => {
  it('should give a part the heredoc bodies and here-strings on its stdin', () => {
    expect(partsOf("python3 - <<'EOF'\nopen('x')\nEOF").map((p) => p.stdinScripts)).toEqual([["open('x')"]]);
    expect(partsOf('node <<< "require(1)"').map((p) => p.stdinScripts)).toEqual([['require(1)']]);
    // fed a file, the script is not read (fix round 4, K2: the call is unreadable)
    expect(readCommand('python3 < script.py', CWD, HOME).parts[0].stdinScripts).toEqual([]);
  });

  it.each(["bash <<'EOF'\ngit push -f\nEOF", 'sh <<< "git push -f"', "zsh -s <<'EOF'\ngit push -f\nEOF", "bash - <<'EOF'\ngit push -f\nEOF"])(
    'should read the stdin of a shell with no script as its commands: %s',
    (cmd) => {
      expect(gitOf(cmd)).toEqual([{ subcommand: 'push', args: ['-f'], dir: '/work/repo' }]);
    },
  );

  it('should not read the stdin of a shell that runs a script file: the body is its input', () => {
    expect(gitOf("bash x.sh <<'EOF'\ngit push -f\nEOF")).toEqual([]);
  });
});

describe('readCommand: archive and sync programs write into their destination folder', () => {
  it.each([
    ['rsync -a --delete /tmp/src/ ./', ['/work/repo']],
    ['rsync -a --delete /tmp/src/ ~/', ['/home/dev']],
    ['rsync -a -e ssh --exclude .git /tmp/src/ out/', ['/work/repo/out']],
    ['tar -xf x.tar', ['/work/repo']],
    ['tar xf x.tar', ['/work/repo']],
    ['tar --extract -f x.tar', ['/work/repo']],
    ['tar -xf x.tar -C ~', ['/home/dev']],
    ['tar -xf x.tar --directory=build', ['/work/repo/build']],
    ['unzip -o x.zip', ['/work/repo']],
    ['unzip -o x.zip -d out', ['/work/repo/out']],
  ])('should read %s as writing into %j', (cmd, targets) => {
    expect(writesOf(cmd)).toEqual(targets);
  });

  it.each(['tar -tf x.tar', 'tar -cf x.tar src', 'unzip -l x.zip', 'rsync /tmp/src/'])(
    'should read %s as writing nothing in place',
    (cmd) => {
      expect(writesOf(cmd)).toEqual([]);
    },
  );
});

describe('readCommand: a cd to the top of the repo (R2c)', () => {
  /** git's answer to `rev-parse --show-toplevel`: the repo holding the folder. */
  const toplevel = (dir: string): string | null => (dir === CWD || dir.startsWith(`${CWD}/`) ? CWD : null);
  const read = (cmd: string, cwd = `${CWD}/src`) => {
    const result = readCommand(cmd, cwd, HOME, false, toplevel);
    if ('unreadable' in result) throw new Error(result.reason);
    return result.parts.find((p) => p.git?.subcommand === 'commit' || p.git?.subcommand === 'push');
  };

  it.each([
    'cd "$(git rev-parse --show-toplevel)" && git commit -m x',
    'cd $(git rev-parse --show-toplevel) && git commit -m x',
    'cd "$(git rev-parse --show-toplevel)"; git push',
    'cd `git rev-parse --show-toplevel` && git push',
  ])('should read %s as running at the top of the repo', (cmd) => {
    const part = read(cmd);
    expect(part?.cwd).toBe(CWD);
    expect(part?.lostDir).toBeNull();
  });

  it.each([
    ['another command substituted', 'cd "$(git rev-parse --git-dir)" && git push'],
    ['more text around it', 'cd "$(git rev-parse --show-toplevel)/sub" && git push'],
    ['a folder outside any repo', 'cd /tmp && cd "$(git rev-parse --show-toplevel)" && git push'],
    ['a folder the gate already lost', 'cd "$D" && cd "$(git rev-parse --show-toplevel)" && git push'],
    // fix round 4, K2: git's variables change where (or whether) git finds a repo
    ['GIT_DIR exported earlier in the call', 'export GIT_DIR=/nowhere; cd "$(git rev-parse --show-toplevel)" && git push'],
    ['GIT_CEILING_DIRECTORIES set earlier in the call', 'GIT_CEILING_DIRECTORIES=/work; cd "$(git rev-parse --show-toplevel)" && git push'],
  ])('should still lose the folder for %s', (_what, cmd) => {
    expect(read(cmd)?.lostDir).not.toBeNull();
  });

  it('should lose the folder when no one tells the reader where the top of the repo is', () => {
    const result = readCommand('cd "$(git rev-parse --show-toplevel)" && git push', CWD, HOME);
    expect('unreadable' in result).toBe(false);
    expect(result.parts.find((p) => p.git?.subcommand === 'push')?.lostDir).not.toBeNull();
  });
});

describe('readCommand: variables that only label or trace a commit are not commands (R2c)', () => {
  it.each(['GIT_AUTHOR_DATE="$(date -R)" git commit -m x', 'GIT_COMMITTER_NAME="$NAME" git commit -m x', 'GIT_TRACE="$T" git push'])(
    'should read %s without marking it unreadable',
    (cmd) => {
      expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(false);
    },
  );

  it('should still mark a pager set from a variable on git as unreadable', () => {
    expect('unreadable' in readCommand('GIT_PAGER="$P" git log', CWD, HOME)).toBe(true);
  });
});

describe('readCommand: what cp writes, with its options anywhere (R2c)', () => {
  it.each([
    ['cp x .oss/tool-gates.json --suffix .bak', '/work/repo/.oss/tool-gates.json'],
    ['cp -S .bak x dest', '/work/repo/dest'],
    ['cp --target-directory=.oss/tool-gates x y', '/work/repo/.oss/tool-gates'],
    ['cp --target-directory .oss x', '/work/repo/.oss'],
    ['cp -t.oss x', '/work/repo/.oss'],
  ])('should read %s as writing %s', (cmd, written) => {
    expect(writesOf(cmd)).toEqual([written]);
  });
});

describe('readCommand: ditto writes its last operand (fix round 4, K2)', () => {
  it.each([
    ['ditto src build/out', `${CWD}/build/out`],
    ['ditto -c -k --keepParent src out.zip', `${CWD}/out.zip`],
    ['ditto --arch arm64 a b', `${CWD}/b`],
    ['ditto /tmp/x .', CWD],
  ])('should read %s as writing %s', (cmd, written) => {
    expect(writesOf(cmd)).toEqual([written]);
  });
});

describe('readCommand: backups made by cp, mv, ln and install (fix round 4, K2)', () => {
  const backupsOf = (cmd: string): string[] => partsOf(cmd).flatMap((p) => p.writeGlobs);

  it.each([
    ['cp -b x dest', `${CWD}/dest*`],
    ['cp --backup=numbered x dest', `${CWD}/dest*`],
    ['cp -S .bak x dest', `${CWD}/dest*`],
    ['cp --suffix=.bak x dest', `${CWD}/dest*`],
    ['cp -fb x dest', `${CWD}/dest*`],
    ['mv --backup x dest', `${CWD}/dest*`],
    ['ln -bs x dest', `${CWD}/dest*`],
    ['install -b -m 644 x dest', `${CWD}/dest*`],
    ['cp -b x d/', `${CWD}/d/x*`],
    ['cp -b -t d x', `${CWD}/d*`],
  ])('should read %s as also writing the backup %s', (cmd, backup) => {
    expect(backupsOf(cmd)).toContain(backup);
  });

  it.each(['cp x dest', 'mv a b', 'ln -s x dest', 'install -m 644 x dest'])('should read no backup for %s', (cmd) => {
    expect(backupsOf(cmd)).toEqual([]);
  });
});

describe('readCommand: globs that also match dot entries (fix round 4, K2)', () => {
  const dotsOfLast = (cmd: string): boolean => {
    const parts = partsOf(cmd);
    return parts[parts.length - 1].dotGlob;
  };

  it.each([
    'shopt -s dotglob; rm -rf *',
    'shopt -s nullglob dotglob && rm -rf *',
    'setopt globdots; rm -rf *',
    'setopt GLOB_DOTS; rm -rf *',
    'setopt glob_dots extendedglob; rm -rf *',
    'set -o globdots; rm -rf *',
    'unsetopt noglobdots; rm -rf *',
    'shopt -s "$X"; rm -rf *',
    'setopt $X; rm -rf *',
    'rm -rf *(D)',
    'GLOBIGNORE=x; rm -rf *',
    'set -4; rm -rf *',
    'shopt -s dotglob; ( rm -rf * )',
    'shopt -s dotglob; echo $(rm -rf *)',
  ])('%s: the last part may match dot entries', (cmd) => {
    expect(dotsOfLast(cmd)).toBe(true);
  });

  it.each([
    'rm -rf *',
    'shopt -s nullglob; rm -rf *',
    'shopt -s dotglob; shopt -u dotglob; rm -rf *',
    'setopt globdots; setopt noglobdots; rm -rf *',
    'shopt -q dotglob; rm -rf *',
    'echo shopt -s dotglob; rm -rf *',
    '( shopt -s dotglob ); rm -rf *',
    'shopt -s dotglob | cat; rm -rf *',
  ])('%s: the last part matches no dot entries', (cmd) => {
    expect(dotsOfLast(cmd)).toBe(false);
  });
});

describe('readCommand: an interpreter whose script comes from stdin (fix round 4, K2)', () => {
  const read = (cmd: string) => readCommand(cmd, CWD, HOME);
  const stdinOf = (cmd: string, program: string): string[] => {
    const part = partsOf(cmd).find((p) => p.name === program);
    if (part === undefined) throw new Error(`no ${program} part`);
    return part.stdinScripts;
  };

  it.each([
    [`echo "open('.oss/x', 'w')" | python3`, 'python3', [`open('.oss/x', 'w')`]],
    [`printf 'import os' | python3 -`, 'python3', ['import os']],
    [`echo -n "require('fs')" | node`, 'node', [`require('fs')`]],
    ["cat <<'EOF' | node\nrequire('fs')\nEOF", 'node', ["require('fs')"]],
  ])('%s: reads the piped literal text as the script', (cmd, program, scripts) => {
    expect(stdinOf(cmd, program)).toEqual(scripts);
  });

  it('reads a literal script piped to a shell as commands', () => {
    expect(partsOf(`echo 'rm -rf .oss' | sh`).map((p) => p.name)).toEqual(['echo', 'sh', 'rm']);
  });

  it.each([
    'python3 < script.py',
    'node < x.js',
    'bash < x.sh',
    'perl 0< x.pl',
    'cat x | sh',
    'curl -s https://example.com/x | bash',
    'echo "$X" | python3',
    `printf '%s' x | python3`,
    'echo -e "a\\nb" | python3',
    '(echo x) | python3',
    '{ echo x; } | python3',
    'cat x | bash -s arg',
  ])('cannot read %s: the script comes from somewhere the gate cannot read', (cmd) => {
    expect('unreadable' in read(cmd)).toBe(true);
  });

  it.each([
    'cat data.json | python3 process.py',
    'echo x | node script.js',
    'python3 script.py < in.txt',
    `python3 -c 'print(1)' < in.txt`,
    'echo {} | python3 -m json.tool',
    'bash x.sh < in.txt',
    'echo {} | jq .',
    'cat data | python3 -W ignore process.py',
    'cat data | node -r ts-node/register x.ts',
    'git diff | perl -pe s/a/b/',
  ])('reads %s with no script from stdin', (cmd) => {
    expect('unreadable' in read(cmd)).toBe(false);
  });
});

describe('readCommand: what a sed or awk script writes and runs (fix round 4, K2)', () => {
  it.each([
    [`sed -n 'w .oss/tool-gates.json' a`, ['/work/repo/.oss/tool-gates.json']],
    [`gsed 's/a/b/w out.txt' a`, ['/work/repo/out.txt']],
    [`awk 'BEGIN{print 1 > ".oss/x.json"}'`, ['/work/repo/.oss/x.json']],
    [`sed --in-pl 's/a/b/' .oss/tool-gates.json`, ['/work/repo/.oss/tool-gates.json']],
    [`sed --in 's/a/b/' f.txt`, ['/work/repo/f.txt']],
  ])('%s writes %j', (cmd, writes) => {
    expect(writesOf(cmd)).toEqual(writes);
  });

  it.each([
    [`sed '1e cp a .oss/x' f`, 'cp'],
    [`awk 'BEGIN{system("rm -f .oss/workflow-state.json")}'`, 'rm'],
    [`awk '{print | "sort -u"}' f`, 'sort'],
  ])('%s runs %s', (cmd, program) => {
    expect(programsOf(cmd)).toContain(program);
  });

  it.each([`sed 'e' f`, `sed 's/.*/x/e' f`, `awk '{system($0)}' f`, `awk '{print > $2}' f`])('cannot read %s', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(true);
  });

  it.each([`sed -n 1,5p .oss/tool-gates.json`, `awk '{print $1}' .oss/workflow-state.json`, `sed 's/a/b/g' f`])('%s writes nothing', (cmd) => {
    expect(writesOf(cmd)).toEqual([]);
  });
});

describe('readCommand: what a recursive delete or permission change covers (fix round 4, K3)', () => {
  it.each([
    ['rm -rf build', [`${CWD}/build`]],
    ['rm -r a b', [`${CWD}/a`, `${CWD}/b`]],
    ['rm -fR build/', [`${CWD}/build`]],
    ['rm --recursive -- -x', [`${CWD}/-x`]],
    ['chmod -R 000 build', [`${CWD}/build`]],
    ['chown -R x:y build', [`${CWD}/build`]],
    ['find build -delete', [`${CWD}/build`]],
    ['find -delete', [CWD]],
    ['find -L a b -name x -delete', [`${CWD}/a`, `${CWD}/b`]],
  ])('%s covers all of %j', (cmd, targets) => {
    expect(partsOf(cmd)[0].recursiveTargets).toEqual(targets);
  });

  it.each(['rm a', 'rm -f a', 'chmod 000 a', 'chmod -v 000 a', 'find build -name x', 'find build -print', 'ls -R build'])(
    '%s covers no whole folder',
    (cmd) => {
      expect(partsOf(cmd)[0].recursiveTargets).toEqual([]);
    },
  );

  it('reads a recursive wildcard as a pattern', () => {
    expect(partsOf('rm -rf bui*').map((p) => p.recursiveGlobs)).toEqual([[`${CWD}/bui*`]]);
    expect(partsOf('rm -rf build')[0].recursiveGlobs).toEqual([]);
  });

  it('reads a find that deletes from a wildcard start as a pattern', () => {
    expect(partsOf('find b* -delete')[0].recursiveGlobs).toEqual([`${CWD}/b*`]);
  });
});

describe('readCommand: python options that take no value (fix round 4, K4, item 30)', () => {
  it.each([
    'python3 -I "$S"',
    'python3 -I -c "$C"',
    'python3 -E -s -S -B -u -O "$S"',
    'python3 -IB "$S"',
    'python3 -W ignore "$S"',
    'python3 -X dev "$S"',
    'ruby -I lib "$S"',
  ])('cannot read %s: the script is only known when it runs', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(true);
  });

  it.each([
    'python3 -I script.py < in.txt',
    'cat data.json | python3 -I process.py',
    'cat data | python3 -E -s -u process.py',
    'cat data | python3 -W ignore -X dev process.py',
    'python3 -I script.py "$ARG"',
    'ruby -I lib x.rb < in.txt',
    'cat data | ruby -I lib x.rb',
  ])('reads %s with its script file as the script', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(false);
  });

  it.each(['cat x | python3 -I', 'echo "$X" | python3 -E -u'])('cannot read %s: the script comes from stdin', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(true);
  });
});

describe('readCommand: commands run under script, unbuffer, expect and other wrappers (fix round 4, K6, item 38)', () => {
  function gitParts(cmd: string): string[] {
    return readCommand(cmd, CWD, HOME).parts.flatMap((p) => (p.git === null ? [] : [`${p.git.subcommand} ${p.git.args.join(' ')}`.trim()]));
  }

  it.each([
    ['script -q /dev/null git push origin main', 'push origin main'],
    ['script -a -t 0 -F out.log git push origin main', 'push origin main'],
    ['unbuffer git push --force', 'push --force'],
    ['unbuffer -p git push origin main', 'push origin main'],
    ["script -c 'git push origin main' /dev/null", 'push origin main'],
    ["script -qc 'git push origin main' /dev/null", 'push origin main'],
    ["script --command='git push origin main'", 'push origin main'],
    ["script --command 'git status && git push origin main' out.log", 'push origin main'],
    ["expect -c 'spawn git push origin main; expect eof'", 'push origin main'],
    ["expect -c 'spawn -noecho git push origin main\nexpect eof'", 'push origin main'],
    ['faketime 2020-01-01 git push origin main', 'push origin main'],
    ['caffeinate -i -t 60 git push origin main', 'push origin main'],
    ['ionice -c 3 -n 7 git push origin main', 'push origin main'],
    ['chrt 10 git push origin main', 'push origin main'],
    ['flock -w 5 /tmp/l git push origin main', 'push origin main'],
  ])('%s runs git %s', (cmd, git) => {
    expect(gitParts(cmd)).toContain(git);
  });

  it.each(['script -q /dev/null git log', 'unbuffer git status', "expect -c 'spawn git log'", "script -c 'git log' /dev/null"])(
    '%s runs git with a terminal, so its pager runs',
    (cmd) => {
      expect(readCommand(cmd, CWD, HOME).parts.find((p) => p.git !== null)?.terminal).toBe(true);
    },
  );

  it.each(['git log', 'nice git log', 'env FOO=1 git log'])('%s runs git without a terminal', (cmd) => {
    expect(readCommand(cmd, CWD, HOME).parts.find((p) => p.git !== null)?.terminal).toBe(false);
  });

  it.each([
    "expect -c 'exec git push origin main'",
    "expect -c 'spawn git log; exec ./x'",
    "expect -c 'spawn [exec ./x]'",
    "expect -c 'expect \"y\" { exec ./x }'",
    'expect -c "spawn $CMD"',
  ])('cannot read %s: expect text other than spawn and simple waits', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(true);
  });

  it.each([
    "expect -c 'spawn npm test; expect eof'",
    "expect -c 'spawn npm test\nexpect \"done\"\nsend \"y\\r\"\ninteract'",
    'script -q /dev/null npm test',
    'unbuffer npm test',
  ])('reads %s', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(false);
  });
});

describe('readCommand: the files script and flock write, and -c after the file (fix round 4, K7, items 42 and 43)', () => {
  function writesOfCall(cmd: string): string[] {
    return readCommand(cmd, CWD, HOME).parts.flatMap((p) => p.writeTargets);
  }

  it.each([
    ['script -q out.log npm test', `${CWD}/out.log`],
    ['script -a -q -F out.log npm test', `${CWD}/out.log`],
    ["script -c 'npm test' out.log", `${CWD}/out.log`],
    ["script out.log -c 'npm test'", `${CWD}/out.log`],
    ["script -q -c 'npm test'", `${CWD}/typescript`],
    ['script -q', `${CWD}/typescript`],
    ['flock .oss/l npm test', `${CWD}/.oss/l`],
    ["flock -w 5 locks/l -c 'npm test'", `${CWD}/locks/l`],
    ['env -C sub script -q out.log npm test', `${CWD}/sub/out.log`],
  ])('%s writes %s', (cmd, target) => {
    expect(writesOfCall(cmd)).toContain(target);
  });

  it.each([
    ["script out.log -c 'git push origin main'", 'push'],
    ["script out.log -q --command 'git push origin main'", 'push'],
    ["script out.log --command='git push origin main'", 'push'],
    ["flock /tmp/l -c 'git push origin main'", 'push'],
    ["flock /tmp/l --command 'git push origin main'", 'push'],
  ])('%s runs git %s', (cmd, sub) => {
    expect(readCommand(cmd, CWD, HOME).parts.map((p) => p.git?.subcommand)).toContain(sub);
  });
});

describe('readCommand: expect script files (fix round 4, K7, item 44)', () => {
  const files = new Map([
    [`${CWD}/ok.exp`, 'spawn npm test\nexpect eof\n'],
    [`${CWD}/push.exp`, 'spawn git push origin main\nexpect eof\n'],
    [`${CWD}/exec.exp`, 'exec ./x\n'],
  ]);
  const readFile = (p: string): string | null => files.get(p) ?? null;
  const read = (cmd: string) => readCommand(cmd, CWD, HOME, false, undefined, readFile);

  it.each(['expect push.exp', 'expect -f push.exp', 'expect -- push.exp', 'expect -d -f push.exp arg'])('%s runs the git push it spawns', (cmd) => {
    expect(read(cmd).parts.map((p) => p.git?.subcommand)).toContain('push');
  });

  it.each(['expect exec.exp', 'expect missing.exp', 'expect -', 'cp push.exp ok.exp && expect ok.exp', 'expect "$S"'])('cannot read %s', (cmd) => {
    expect('unreadable' in read(cmd)).toBe(true);
  });

  it.each(['expect ok.exp', 'expect -f ok.exp', 'expect -- ok.exp arg'])('reads %s', (cmd) => {
    expect('unreadable' in read(cmd)).toBe(false);
  });

  it('cannot read an expect script file when it has no file reader', () => {
    expect('unreadable' in readCommand('expect ok.exp', CWD, HOME)).toBe(true);
  });
});

describe('readCommand: expect script files read many times in one call (fix round 4, K8, item 3)', () => {
  function counting(files: Map<string, string>) {
    const reads: string[] = [];
    const readFile = (p: string): string | null => {
      reads.push(p);
      return files.get(p) ?? null;
    };
    return { reads, read: (cmd: string) => readCommand(cmd, CWD, HOME, false, undefined, readFile) };
  }

  it('reads each script file from disk once per call, however often it runs', () => {
    const { reads, read } = counting(new Map([[`${CWD}/ok.exp`, 'spawn npm test\nexpect eof\n']]));
    read('expect ok.exp; expect ok.exp; expect -f ok.exp');
    expect(reads).toEqual([`${CWD}/ok.exp`]);
  });

  it('stops, as too complex, when the script files it reads add up to more than the call may scan', () => {
    const { read } = counting(new Map([[`${CWD}/w.exp`, '\n'.repeat(63 * 1024)]]));
    expect(read('expect w.exp; '.repeat(400))).toMatchObject({ unreadable: true, limit: true, reason: expect.stringMatching(/script files/) });
  });

  it('still reads one large script file', () => {
    const { read } = counting(new Map([[`${CWD}/w.exp`, `${'\n'.repeat(63 * 1024)}spawn npm test\n`]]));
    expect('unreadable' in read('expect w.exp')).toBe(false);
  });
});

describe('readCommand: script read the way macOS and util-linux read it (fix round 4, K8, item 8)', () => {
  const runs = (cmd: string) => readCommand(cmd, CWD, HOME).parts.map((p) => p.words.join(' '));

  it.each([
    ['script -F /dev/null git push origin main', 'git push origin main'],
    ["script -t -c 'git push origin main' log", 'git push origin main'],
    ['script -t 0 /dev/null git push origin main', 'git push origin main'],
    ["script -q -c 'git push origin main' /dev/null", 'git push origin main'],
  ])('%s runs %s in one of the readings', (cmd, command) => {
    expect(runs(cmd)).toContain(command);
  });

  it('writes the file either reading names (util-linux: the operand after -t)', () => {
    const part = readCommand("script -t -c 'npm test' log", CWD, HOME).parts[0];
    expect(part.writeTargets).toContain(`${CWD}/log`);
  });
});

describe('readCommand: expect reading its script from stdin, and Tcl words (fix round 4, K8, item 10)', () => {
  const files = new Map([[`${CWD}/ok.exp`, '# comment; exec ./x\nspawn npm test\nexpect "done"\n']]);
  const read = (cmd: string) => readCommand(cmd, CWD, HOME, false, undefined, (p) => files.get(p) ?? null);

  it.each([
    "echo 'spawn npm test' | expect",
    'expect < x.exp',
    "expect <<< 'spawn npm test'",
    'expect',
    'expect -i',
    "expect -c 'spawn npm test' < x.exp",
    `expect -c "send 'x;exec git push;'"`,
    `expect -c 'send x";exec git push;"'`,
    `expect -c 'send "x"y'`,
    `expect -c 'send "unterminated'`,
    `expect -c 'send \;exec'`,
  ])('cannot read %s', (cmd) => {
    expect('unreadable' in read(cmd)).toBe(true);
  });

  it.each([
    "expect -c 'spawn npm test; expect eof'",
    `expect -c "send \\"it's done\\"; expect eof"`,
    `expect -c 'spawn npm test; send "y\\r"'`,
    'expect ok.exp',
  ])('reads %s', (cmd) => {
    expect('unreadable' in read(cmd)).toBe(false);
  });

  it("reads a quoted spawn word whole, with its ' kept as text", () => {
    const parts = read(`expect -c "spawn git commit -m \\"it's\\""`).parts;
    expect(parts.map((p) => p.words)).toContainEqual(['git', 'commit', '-m', "it's"]);
  });
});

describe('readCommand: echo text with backslashes piped into a shell (fix round 4, K8, item 11)', () => {
  it.each(["echo 'git push origin HEAD:ma\\0151n' | sh", "echo 'a\\x69' | bash", "echo -n 'x\\ty' | python3"])('cannot read %s (zsh and macOS sh decode the escapes)', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(true);
  });

  it.each(["echo 'npm test' | sh", "echo 'a\\tb' | cat"])('reads %s', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(false);
  });
});

describe('readCommand: cd through CDPATH (fix round 4, K8, item 13)', () => {
  const lastLost = (cmd: string, cdpath?: string) => readCommand(cmd, CWD, HOME, false, undefined, undefined, cdpath).parts.at(-1)!.lostDir;

  it.each(['CDPATH=.git cd hooks && echo x', 'export CDPATH=.git; cd hooks && echo x', 'CDPATH=.git; cd hooks; echo x', 'cdpath=(.git); cd hooks && echo x'])(
    '%s may be in .git/hooks: lost, with that folder as the pattern',
    (cmd) => {
      expect(lastLost(cmd)).toMatchObject({ pattern: `${CWD}/.git/hooks` });
    },
  );

  it('a cd through a CDPATH with several folders is lost, with no pattern', () => {
    expect(lastLost('CDPATH=a:b cd hooks && echo x')).toMatchObject({ pattern: null });
  });

  it('a cd through the CDPATH the gate runs with is lost', () => {
    expect(lastLost('cd hooks && echo x', '.git')).toMatchObject({ pattern: `${CWD}/.git/hooks` });
  });

  it.each(['CDPATH=.git cd ./hooks && echo x', 'CDPATH=.git cd ../x && echo x', 'CDPATH=.git cd /tmp && echo x', 'cd hooks && echo x', 'CDPATH= cd hooks && echo x'])(
    '%s is followed (CDPATH is not searched)',
    (cmd) => {
      expect(lastLost(cmd)).toBeNull();
    },
  );
});

describe('readCommand: dotglob turned on through a shell\'s own options (fix round 4, K8, item 14)', () => {
  const rmDots = (cmd: string) => readCommand(cmd, CWD, HOME).parts.find((p) => p.program === 'rm')?.dotGlob;

  it.each([
    "bash -O dotglob -c 'rm -rf *'",
    "bash -Odotglob -c 'rm -rf *'",
    "BASHOPTS=dotglob bash -c 'rm -rf *'",
    "BASHOPTS=extglob:dotglob bash -c 'rm -rf *'",
    "export BASHOPTS=dotglob; bash -c 'rm -rf *'",
    "zsh -o globdots -c 'rm -rf *'",
    "zsh -o GLOB_DOTS -c 'rm -rf *'",
    "zsh -oglobdots -c 'rm -rf *'",
    "zsh --globdots -c 'rm -rf *'",
    "zsh --glob-dots -c 'rm -rf *'",
    "zsh +o noglobdots -c 'rm -rf *'",
    "zsh -4 -c 'rm -rf *'",
    'setopt dotglob; rm -rf *',
    'set -o dotglob; rm -rf *',
    'builtin shopt -s dotglob; rm -rf *',
    'command setopt globdots; rm -rf *',
    "eval 'shopt -s dotglob'; rm -rf *",
    "eval 'setopt GLOB_DOTS'; rm -rf *",
    'eval "$X"; rm -rf *',
  ])('%s: the rm matches dot entries', (cmd) => {
    expect(rmDots(cmd)).toBe(true);
  });

  it.each(["bash -c 'rm -rf *'", "bash -O extglob -c 'rm -rf *'", "bash +O dotglob -c 'rm -rf *'", "zsh -o extendedglob -c 'rm -rf *'", "eval 'echo hi'; rm -rf *", 'rm -rf *'])(
    '%s: the rm does not',
    (cmd) => {
      expect(rmDots(cmd)).toBe(false);
    },
  );
});

describe('readCommand: Tcl backslash escapes in expect text (fix part K11, item 4)', () => {
  const spawned = (cmd: string): string[][] => {
    const facts = readCommand(cmd, CWD, HOME);
    if ('unreadable' in facts) throw new Error(`expected a readable command: ${facts.reason}`);
    return facts.parts.map((p) => p.words);
  };

  it.each([
    [`expect -c 'spawn git push origin "HEAD:ma\\151n"'`, 'HEAD:main'],
    [`expect -c 'spawn git push origin "HEAD:ma\\x69n"'`, 'HEAD:main'],
    [`expect -c 'spawn git push origin "HEAD:ma\\u0069n"'`, 'HEAD:main'],
    [`expect -c 'spawn git push origin "HEAD:m\\ain"'`, 'HEAD:m\u0007in'],
    [`expect -c 'spawn git push origin "HEAD:\\main"'`, 'HEAD:main'],
    [`expect -c 'spawn git push origin "HEAD:ma\\x69\\156"'`, 'HEAD:main'],
  ])('decodes the escapes of a quoted word as Tcl does: %s', (cmd, word) => {
    expect(spawned(cmd)).toContainEqual(['git', 'push', 'origin', word]);
  });

  it.each([
    `expect -c 'spawn git push origin "HEAD:ma\\x0069n"'`,
    `expect -c 'spawn git push origin "HEAD:ma\\U00000069n"'`,
    `expect -c 'spawn git push origin HEAD:ma\\151n'`,
  ])('cannot read %s (Tcl versions decode it differently, or a bare word)', (cmd) => {
    expect('unreadable' in readCommand(cmd, CWD, HOME)).toBe(true);
  });

  it('still reads send "y\\r" as one word', () => {
    expect('unreadable' in readCommand(`expect -c 'spawn npm test; expect "done"; send "y\\r"'`, CWD, HOME)).toBe(false);
  });
});

describe('readCommand: CDPATH set in every form (fix part K11, item 5)', () => {
  const lastLost = (cmd: string, cdpath?: string) => readCommand(cmd, CWD, HOME, false, undefined, undefined, cdpath).parts.at(-1)!.lostDir;

  it.each([
    'CDPATH+=.git; cd hooks && echo x',
    'CDPATH+=:.git; cd hooks && echo x',
    'export CDPATH+=.git; cd hooks && echo x',
    'cdpath+=(.git); cd hooks && echo x',
    'cdpath[1]=.git; cd hooks && echo x',
    'typeset -a cdpath=(.git); cd hooks && echo x',
    'declare -a CDPATH=(.git); cd hooks && echo x',
    'local CDPATH=.git; cd hooks && echo x',
  ])('%s sends the cd to the one folder CDPATH names', (cmd) => {
    expect(lastLost(cmd)).toMatchObject({ pattern: `${CWD}/.git/hooks` });
  });

  it.each(['CDPATH+=$X; cd hooks && echo x', 'CDPATH="$PWD/.git"; cd hooks && echo x', 'cdpath+=($X); cd hooks && echo x', 'CDPATH+=:.git; cd hooks && echo x'])(
    '%s counts as set: the cd is lost',
    (cmd) => {
      expect(lastLost(cmd, cmd.includes(':.git') ? 'a' : undefined)).not.toBeNull();
    },
  );

  it('appends to the CDPATH the gate runs with', () => {
    expect(lastLost('CDPATH+=:b; cd hooks && echo x', 'a')).toMatchObject({ pattern: null });
  });

  it.each(['a[1]=x; cd src && echo x', 'X+=1; cd src && echo x', 'CDPATH+=:/tmp; cd ./src && echo x'])('%s is followed', (cmd) => {
    expect(lastLost(cmd)).toBeNull();
  });

  it('reads X+=1 and a[1]=x as assignments, not as programs', () => {
    expect(programsOf('X+=1 npm test; a[1]=x')).toEqual(['npm', null]);
  });
});

describe('readCommand: dotglob turned on in every form (fix part K11, item 6)', () => {
  const rmDots = (cmd: string) => readCommand(cmd, CWD, HOME).parts.find((p) => p.program === 'rm')?.dotGlob;

  it.each([
    "bash -eO dotglob -c 'rm -rf *'",
    "bash -xO dotglob -c 'rm -rf *'",
    "bash --rcfile x -O dotglob -c 'rm -rf *'",
    "bash --init-file x -O dotglob -c 'rm -rf *'",
    "zsh -eo globdots -c 'rm -rf *'",
    "zsh -fo globdots -c 'rm -rf *'",
    "zsh -Go globdots -c 'rm -rf *'",
    "zsh -4c 'rm -rf *'",
    "zsh -eo extendedglob -o globdots -c 'rm -rf *'",
    'set -eo globdots; rm -rf *',
    'options[globdots]=on; rm -rf *',
    'options[GLOB_DOTS]=on; rm -rf *',
    'options[noglobdots]=off; rm -rf *',
    'options[$X]=on; rm -rf *',
    'emulate zsh -o globdots; rm -rf *',
    'emulate -o globdots zsh; rm -rf *',
    'emulate -L zsh -eo globdots; rm -rf *',
    "GLOBIGNORE=x bash -c 'rm -rf *'",
    "GLOBIGNORE=$X zsh -c 'rm -rf *'",
  ])('%s matches dot entries', (cmd) => {
    expect(rmDots(cmd)).toBe(true);
  });

  it.each([
    "bash -e -c 'rm -rf *'",
    "bash -eO extglob -c 'rm -rf *'",
    "zsh -eo extendedglob -c 'rm -rf *'",
    "bash --rcfile x -c 'rm -rf *'",
    'options[extendedglob]=on; rm -rf *',
    'options[globdots]=off; rm -rf *',
    'emulate zsh; rm -rf *',
    "GLOBIGNORE= bash -c 'rm -rf *'",
    'set -e; rm -rf *',
  ])('%s does not', (cmd) => {
    expect(rmDots(cmd)).toBe(false);
  });
});

describe('readCommand: thousands of CDPATH appends in one call (fix part K12, item 1)', () => {
  const lastLost = (cmd: string, cdpath?: string) => readCommand(cmd, CWD, HOME, false, undefined, undefined, cdpath).parts.at(-1)!.lostDir;
  const appends = `CDPATH=${':'.repeat(44_000)} ${'CDPATH+=: '.repeat(2_000)}`;

  it('reads the 64 KB repro within a fraction of a second', () => {
    const start = performance.now();
    readCommand(`${appends}; git push origin HEAD:main`, CWD, HOME);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it('still sends a later cd through the one folder an append names', () => {
    expect(lastLost(`${appends}; CDPATH+=.git; cd hooks && echo x`)).toMatchObject({ pattern: `${CWD}/.git/hooks` });
  });

  it.each([
    ['CDPATH=.:a:b:c; cd hooks && echo x', null],
    ['CDPATH=a; CDPATH+=b; cd hooks && echo x', `${CWD}/ab/hooks`],
    ['CDPATH=a:.; CDPATH+=git; cd hooks && echo x', null],
    ['CDPATH=:; CDPATH+=.git; cd hooks && echo x', `${CWD}/.git/hooks`],
  ])('%s keeps what cd searches (pattern %s)', (cmd, pattern) => {
    expect(lastLost(cmd)).toMatchObject({ pattern });
  });

  it('keeps the CDPATH the gate runs with, however many folders it names', () => {
    expect(lastLost('cd hooks && echo x', `${':'.repeat(10_000)}.git`)).toMatchObject({ pattern: `${CWD}/.git/hooks` });
    expect(lastLost('cd ./src && echo x', `${':'.repeat(10_000)}.git`)).toBeNull();
  });
});
