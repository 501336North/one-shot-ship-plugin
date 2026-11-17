/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) can't hide a write to
 *   a protected file, a forced push, or a hook call with a HOME/PATH they chose, behind:
 *   - a script `trap`, `emulate … -c`, `sched` or a zsh function definition runs, when that script reads a
 *     variable, a substitution or a name the shell keeps itself (`$PWD`, `$OLDPWD`, `$_`);
 *   - any other way to define a zsh function (`functions+=(…)`, `set -A functions`, `dis_functions` and
 *     `enable -f`);
 *   - extendedglob's `^` and `~`, which match more than the plain text says;
 *   - a glob qualifier subscript that names a variable (zsh evaluates it, running any `$(…)` in its value);
 *   - a literal folder followed by two unknown parts (`".oss/$X$Y"`);
 *   - arithmetic or option parsers that set a variable named by another (`(( (0), $x = 1 ))`, `getopts ab $x`).
 *   Ordinary commands stay allowed: cleanup traps, `repeat 3 echo hi`, an EXIT trap that runs `popd`,
 *   extendedglob patterns kept inside an ordinary folder, and numeric qualifier subscripts.
 * @business-rule R-266 round 16: SEC HIGH-1 / CR MEDIUM-2, CR HIGH-1, CR MEDIUM-1, CR LOW-1, PERF LOW-1,
 *   and the ADR-048 lists of other zsh function definers and arithmetic setters.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo.
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
const HOOK = '~/.oss/hooks/oss-statusline-settings.sh';

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r16-forms-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'run'), { recursive: true });
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
        session_id: 'r16-shell-forms',
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

async function refuse(command: string, agent: string | null): Promise<void> {
  const result = await call(command, agent);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
}

const EXTENDED_GLOB_ON = ['setopt extendedglob', 'set -o extendedglob', 'options[extendedglob]=on'];

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    "trap 'rm -rf $HOME/.oss/gate-state' EXIT",
    "emulate zsh -c 'rm -f $HOME/.oss/gate-state/*/*.tamper'",
    "emulate zsh -c 'echo x > $HOME/.claude/settings.json'",
    "trap 'echo x > $HOME/.oss/node-path' EXIT",
    "emulate zsh -c 'p=.o; echo x > ${p}ss/tool-gates.json'",
    "trap 'echo x > $(echo .oss)/tool-gates.json' EXIT",
    "emulate zsh -c 'git push -f origin ${B:-main}'",
    "trap 'git push --force origin $X' EXIT",
    "functions[f]='p=.o; echo x > ${p}ss/tool-gates.json'; f",
    "functions[f]='echo x > $HOME/.oss/node-path'; f",
    "sched +0 'echo x > $HOME/.oss/node-path'",
    "F=.oss/tool-gates.json; trap 'rm -f $F' EXIT",
    "trap 'rm -f .oss/$NAME' EXIT",
    "F=.oss/tool-gates.json; emulate zsh -c 'rm -f $F'",
    'trap "echo x > $PWD/.oss/tool-gates.json" EXIT',
    'trap "echo x > $OLDPWD/.oss/tool-gates.json" EXIT',
    'trap "echo x > $_/.oss/tool-gates.json" EXIT',
    'trap "echo x > $HOME[1,-1]/.oss/node-path" EXIT',
    'emulate zsh -c "echo x > $PWD/.oss/tool-gates.json"',
  ])('SEC HIGH-1: refuses what a trap, emulate -c, sched or functions[…] script hides behind a $: %s', (command) =>
    refuse(command, agent));

  it.each([
    'tmp=$(mktemp -d); trap "rm -rf $tmp" EXIT',
    'D=build; trap "rm -rf $D" EXIT',
    "trap 'rm -f \"$tmp\"' EXIT",
    'trap "kill -- -$$" INT TERM',
  ])('SEC HIGH-1: keeps the ADR-050 cleanup traps allowed: %s', (command) => allowed(command, agent));

  it.each([
    "trap 'rm -rf \"$dir\"' EXIT",
    'trap "rm -rf \\"$dir\\"" EXIT; echo x > out.txt',
  ])('ADR-050: keeps a clean-up trap of a folder only known when it runs allowed: %s', (command) => allowed(command, agent));

  it.each([
    "trap 'rm -rf .oss/$X' EXIT",
    "trap 'rm -rf \"$X\"/.git' EXIT",
  ])('ADR-050: still judges such a folder by its literal start and end: %s', (command) => refuse(command, agent));

  it.each([
    'functions+=([f]="echo x > .oss/tool-gates.json"); f',
    "functions+=(f 'rm -f .oss/tool-gates.json'); f",
    'functions=([f]="echo x > .oss/tool-gates.json"); f',
    'set -A functions f "echo x > .oss/tool-gates.json"; f',
    'set +A functions f "echo x > .oss/tool-gates.json"; f',
    'dis_functions[f]="echo x > .oss/tool-gates.json"; enable -f f; f',
    'enable -f f; f',
  ])('ADR-048: refuses the other ways to define a zsh function: %s', (command) => refuse(command, agent));

  describe.each(EXTENDED_GLOB_ON)('after %s', (on) => {
    it.each([
      'rm -f .oss/^x',
      'rm -f .oss/*~x',
      'rm -f .oss/tool-gates.json^x',
      "echo '{}' > ~/.claude/settings.js?n~x",
      'rm -rf ~/.oss/^x',
      'rm -f .oss/^x*(.)',
      'rm -f .oss/*~x(.)',
    ])('CR HIGH-1: reads ^ and ~ as wildcards: %s', (command) => refuse(`${on}; ${command}`, agent));

    it.each(['ls **/*.ts', 'rm -f build/^keep.txt'])('CR HIGH-1: keeps an ordinary pattern allowed: %s', (command) =>
      allowed(`${on}; ${command}`, agent));
  });

  it.each([
    "X='a[$(rm -f .oss/tool-gates.json)]'; ls *([X])",
    "X='a[$(rm -f .oss/tool-gates.json)]'; ls !([X])",
    "X='a[$(rm -f .oss/tool-gates.json)]'; ls *([1,X])",
  ])('ADR-047: refuses a qualifier subscript that is not digits, commas and dashes: %s', (command) => refuse(command, agent));

  it.each(['ls *([1,3])', 'ls src/*(.[1,-1])'])('ADR-047: keeps a numeric qualifier subscript allowed: %s', (command) =>
    allowed(command, agent));

  it.each([
    'echo x > ".oss/$X$Y"',
    'echo x > ".oss/$X-$Y"',
    'echo x > ".oss/${X}${Y}"',
    'X=tool-gates; echo x > ".oss/$X$Y"',
    'D=.oss; echo x > "$D/$X"',
  ])('CR MEDIUM-1: judges a literal head before two unknown parts as head + *: %s', (command) => refuse(command, agent));

  it.each(['echo x > "$X$Y"', 'echo x > "src/$X$Y"', 'echo x > "out/$X.log"'])(
    'CR MEDIUM-1: keeps an ordinary unknown write allowed: %s',
    (command) => allowed(command, agent),
  );

  it.each([
    'repeat 3 echo hi; echo x > out.txt',
    "trap 'popd' EXIT; echo x > out.txt",
    'D=build; trap "rm -rf $D" EXIT; trap "rm -rf $D/x" INT',
  ])('CR LOW-1 / PERF LOW-1: allows ordinary commands again: %s', (command) => allowed(command, agent));

  it.each([
    'repeat 3 rm -f .oss/tool-gates.json',
    'repeat 2 echo x > .oss/tool-gates.json',
    'repeat 3 cd src; echo x > ../.oss/tool-gates.json',
    "trap 'popd' DEBUG; echo x > tool-gates.json",
    "trap 'cd .oss' ERR; echo x > tool-gates.json",
    "trap 'cd .oss' INT; echo x > tool-gates.json",
  ])('CR LOW-1: still follows a repeat or non-EXIT trap that can move the folder: %s', (command) => refuse(command, agent));

  it.each([
    `x=HOME; (( (0), $x = 1 )); ${HOOK}`,
    `x=HOME; : $[ a[0], $x = 1 ]; ${HOOK}`,
    `x=HOME; getopts ab $x; ${HOOK}`,
    `x=HOME; zparseopts -A $x; ${HOOK}`,
  ])('ADR-048: counts more arithmetic and option-parser HOME/PATH setters before a hook call: %s', (command) =>
    refuse(command, agent));
});
