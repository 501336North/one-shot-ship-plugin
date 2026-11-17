/**
 * @behavior The main agent's and builders' Bash calls run in zsh on macOS and bash elsewhere. A write
 *   target or `cd` target the gate can't read exactly is refused (or leaves the folder unknown):
 *   - a word with an unquoted `(` that starts no substitution (a zsh glob qualifier or modifier,
 *     `src(:s#…#…#)`), and any zsh parameter flags `${(…)…}`;
 *   - a `~` form other than `~`, `~/` and `~user` (`~+`, `~-`, `~1`, `~+1`, `~[…]`);
 *   - a shell option the gate doesn't model (`setopt cdablevars`, `set -o globsubst`, …): from there on
 *     the folder and every variable are unknown, except for a few known-safe options;
 *   - an unquoted variable whose followed value holds wildcard characters: it is a pattern, not a name.
 *   A HOME or PATH that an indirect name (`printf -v "$x"`, `declare -n`, `${(P)x}`) may set is
 *   assumed set before a `~/.oss/hooks/*` call.
 * @business-rule R-266 round 14: CR HIGH-1, CR HIGH-2 / SEC HIGH-1, SEC HIGH-2, SEC HIGH-3, CR LOW-1. Each refused case below wrote a protected file, or ran a hook with a HOME/PATH the
 *   gate didn't see, while the gate allowed it.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r14-forms-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r14-shell-forms',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux' },
  );
}

async function allowed(command: string, agent: string | null): Promise<void> {
  const result = await call(command, agent);
  expect(result.stderr, command).toBe('');
  expect(result.exitCode, command).toBe(0);
}

async function refused(command: string, agent: string | null): Promise<void> {
  const result = await call(command, agent);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
}

const HOOK = '~/.oss/hooks/oss-statusline-settings.sh';

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    'echo x > src(:s#src#.oss/tool-gates.json#)',
    'X=src; echo x > "$X"(:s#src#.oss/tool-gates.json#)',
    'X=src; echo x > ${X}(:s#src#.oss/tool-gates.json#)',
    'X=src; echo x > "${X}"(:s#src#.oss/tool-gates.json#)',
    'F=src; cd $F(:h) && echo x > .oss/tool-gates.json',
    ": src(e:'echo x > .oss/tool-gates.json':)",
    ": *(e:'echo x > .oss/tool-gates.json':)",
    'echo x > *(:s#x#.oss/tool-gates.json#)',
    "rm -rf !(e:'echo x > .oss/tool-gates.json':)",
    "X='$(echo x > .oss/tool-gates.json)'; : ${(e)X}",
  ])('CR HIGH-1: refuses a zsh qualifier, modifier or parameter flag: %s', (command) => refused(command, agent));

  it.each([
    'echo x > ~+/.oss/tool-gates.json',
    "cd ~ && echo '{}' > ~+/.claude/settings.json",
    'cd src && cd ~+/.. && echo x > .oss/tool-gates.json',
    'pushd .oss && echo x > ~+1/../.oss/tool-gates.json',
    'echo x > ~[.oss]/tool-gates.json',
    'echo x > ~-/.oss/tool-gates.json',
    'cd ~- && echo x > .oss/tool-gates.json',
  ])('CR HIGH-2: refuses a write through a ~ form other than ~ and ~user: %s', (command) => refused(command, agent));

  it.each([
    "setopt cdablevars; cd HOME && echo '{}' > .claude/settings.json",
    'setopt cdablevars; D=$PWD/.oss; cd D && echo x > tool-gates.json',
    'set -o cdablevars; D=$PWD/.oss; cd D && echo x > tool-gates.json',
    'setopt cdable_vars; D=$PWD/.oss; cd D && echo x > tool-gates.json',
    "setopt globsubst; D='.gi?/config'; echo x > $D",
    "emulate sh; D=$PWD/.oss; cd D && echo x > tool-gates.json",
    "options[cdablevars]=on; D=$PWD/.oss; cd D && echo x > tool-gates.json",
    "shopt -s cdable_vars; D=$PWD/.oss; cd D && echo x > tool-gates.json",
    // with extendedglob, `f#` is zero or more `f`: `.git/conff#ig` is `.git/config`
    'setopt extendedglob; echo x > .git/conff#ig',
    'options[extendedglob]=on; echo x > .git/con^x#ig',
  ])('SEC HIGH-2: refuses after a shell option the gate does not model: %s', (command) => refused(command, agent));

  it.each([
    "zsh -o cdablevars -c 'cd HOME && echo x > .claude/settings.json'",
    "zsh +o nocdablevars -c 'cd HOME && echo x > .claude/settings.json'",
    "zsh --cdablevars -c 'cd HOME && echo x > .claude/settings.json'",
    "zsh -ocdablevars -c 'cd HOME && echo x > .claude/settings.json'",
    "zsh -y -c 'cd HOME && echo x > .claude/settings.json'",
    "bash -O cdable_vars -c 'cd HOME && echo x > .claude/settings.json'",
    "bash -O extglob -o posix -c 'cd HOME && echo x > .claude/settings.json'",
    "bash -o posix -c 'cd HOME && echo x > .claude/settings.json'",
    "sh -o cdablevars -c 'cd HOME && echo x > .claude/settings.json'",
    "env FOO=1 zsh -o cdablevars -c 'cd HOME && echo x > .claude/settings.json'",
    "zsh -eo cdablevars -c 'cd HOME && echo x > .claude/settings.json'",
  ])('SEC HIGH-2: refuses a nested shell started with an option the gate does not model: %s', (command) => refused(command, agent));

  it.each([
    "bash -euo pipefail -c 'echo ok > src/out.txt'",
    "bash -O extglob -c 'cd src && echo ok > out.txt'",
    "zsh -f -c 'cd src && echo ok > out.txt'",
    "bash --norc --noprofile -c 'cd src && echo ok > out.txt'",
  ])('still allows a nested shell with safe options: %s', (command) => allowed(command, agent));

  it('SEC HIGH-2: refuses an absolute path that extendedglob makes a pattern', () =>
    refused(`setopt extendedglob; echo x > ${root}/other/.git/conff#ig`, agent));

  it.each([
    "D='.gi?/hooks'; cp /tmp/pre-commit $D",
    "D='.gi?/config'; echo x > $D",
    "D='.os[s]/tool-gates.json'; echo x > $D",
    // the same destination written out: cp and mv write into a protected folder named as their destination
    'cp /tmp/pre-commit .gi?/hooks',
    'cp /tmp/pre-commit .git/hooks',
    'mv /tmp/pre-commit .git/hooks',
    'D=.git/hooks; cp /tmp/pre-commit $D',
  ])('SEC HIGH-3: refuses an unquoted variable whose value is a pattern: %s', (command) => refused(command, agent));

  it.each([
    `declare -n H=HOME; H=/tmp/e; ${HOOK}`,
    `x=HOME; printf -v "$x" %s /tmp/e; ${HOOK}`,
    `x=HOME; declare "$x=/tmp/e"; ${HOOK}`,
    `x=PATH; : \${(P)x::=/tmp/e}; ${HOOK}`,
  ])('CR LOW-1: refuses a hook call after an indirect HOME/PATH setter: %s', (command) => refused(command, agent));

  it.each([
    'case "$1" in a|b) echo ok ;; (c) echo c ;; esac',
    'f() { echo hi; }; f',
    '(cd src && ls)',
    '[[ "$x" =~ ^(a|b)$ ]] && echo ok',
    'ls src/@(a|b).ts',
    'set -o pipefail; set -euo pipefail; echo ok > src/out.txt',
    'set -e; set -x; set +x; echo ok > src/out.txt',
    'setopt errexit nounset pipefail; echo ok > src/out.txt',
    'emulate zsh; echo ok > src/out.txt',
    'emulate -L zsh; echo ok > src/out.txt',
    'echo x > src/a#b.txt',
    'rm -rf src/!(keep)',
    "D=src/out.txt; echo x > $D",
    "D='.gi?/config'; echo x > \"$D\"",
    'echo x > ~/notes.txt',
    'cd ~ && ls',
    'x=HOME; echo "$x"',
    'cp /tmp/a.txt src',
    'mv /tmp/a.txt sr?',
    `export HOME_X=1; ${HOOK}`,
  ])('still allows: %s', (command) => allowed(command, agent));
});
