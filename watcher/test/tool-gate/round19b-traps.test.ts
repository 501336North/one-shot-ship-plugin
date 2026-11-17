/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) that set a trap reading a
 *   variable: an ordinary clean-up trap set before its variable (`trap 'rm -rf "$tmp"' EXIT; tmp=$(mktemp -d)`)
 *   is allowed again, and is refused only when one of the values the variable can hold at exit is protected; a
 *   later assignment the gate can't follow, an `unset`, an assignment behind a prefix word (`time F=.oss`) or a
 *   name given as an option's value (`read -aF`, `zparseopts -AF`, `getopts -- s $G`) is refused. A long
 *   unbalanced `a[` chain after a filled trap is decided quickly, and GNU-named copies (`gcp`, `gmv`, `gln`,
 *   `ginstall`, `grsync`) have their destinations checked like cp, mv, ln, install and rsync.
 * @business-rule R-266 round 19 Part B: D-R19-1 ("Follow later values", CR MEDIUM-1), D-R19-2 ("Keep refused"),
 *   CR limit L-A, SEC MEDIUM-1, PERF MEDIUM-1, PEN MEDIUM / SEC MEDIUM-2 part 2.
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

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r19b-traps-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'run'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
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
        session_id: 'r19b-traps',
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

const CHAIN = 'a['.repeat(12 * 1024);

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    "trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d); npm test",
    "trap 'rm -f \"$f\"' EXIT; f=$(mktemp); git diff > \"$f\"; cat \"$f\"",
    "trap 'rm -rf \"$WORK\"' EXIT INT TERM; WORK=$(mktemp -d -t x); cd \"$WORK\" && ls",
    "tmp=\"\"; trap 'rm -rf \"$tmp\"' EXIT; tmp=$(mktemp -d); npm test",
    "trap 'kill $pid 2>/dev/null' EXIT; node server.js & pid=$!; sleep 1",
    "trap 'echo \"exit $rc\"' EXIT; npm test; rc=$?",
    "trap 'rm -rf build' EXIT; OUT=build; npm run build",
    "trap 'rm -rf \"$tmp\"' EXIT; tmp=build; tmp=out; npm test",
    "F=src; trap 'rm -rf $F' EXIT; F=out",
  ])('D-R19-1: allows a clean-up trap whose variable is set after it to values the gate can follow: %s', (command) =>
    allowed(command, agent));

  it.each([
    "trap 'rm -rf $F' EXIT; F=.oss",
    "trap 'rm -rf \"$F\"' EXIT; F=~/.claude",
    "trap 'rm -rf $F' EXIT; F=src; F=.oss",
    "trap 'rm -rf \"$F\"' EXIT; F=$(cat name.txt)",
    "trap 'rm -rf ~/$F' EXIT; F=.claude",
    "trap 'cd $F; rm -rf tool-gates.json' EXIT; F=src; F=.oss",
    "trap 'rm -rf $F' EXIT; read F < name.txt",
    "trap 'rm -rf $F' EXIT; for F in src; do :; done",
    "trap 'rm -rf $F' EXIT; F=src; eval \"$X\"",
  ])('D-R19-1: refuses a trap when a value its variable can hold at exit is protected, or a later set can\'t be followed: %s', (command) =>
    refuse(command, agent));

  it.each([
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; unset tmp",
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; for i in 0 1; do arr[$i]=x; done",
  ])('D-R19-2: keeps refusing an unset or a computed subscript after a filled trap: %s', (command) => refuse(command, agent));

  it.each(['time', 'nocorrect', 'noglob', 'builtin', 'command', 'exec'])(
    'CR L-A: refuses a set of the filled name behind the prefix word %s',
    (prefix) => refuse(`F=src; trap 'rm -rf $F' EXIT; ${prefix} F=.oss; true`, agent),
  );

  it.each([
    "set -- -a $(printf '\\56claude'); F=src; trap 'rm -rf ~/$F' EXIT; zparseopts -D -AF a:",
    "G=$'\\x46'; F=x; trap 'rm -rf ~/.os$F' EXIT; getopts -- s $G -s",
    "F=src; trap 'rm -rf ~/$F' EXIT; read -aF <<< .claude",
    "F=src; trap 'rm -rf ~/$F' EXIT; read -AF <<< .claude",
    "F=src; trap 'rm -rf ~/$F' EXIT; zparseopts -a F",
    "F=src; trap 'rm -rf ~/$F' EXIT; mapfile -t F",
    "F=src; trap 'rm -rf ~/$F' EXIT; compgen -V F",
    "F=src; trap 'rm -rf ~/$F' EXIT; compgen -VF",
  ])('SEC MEDIUM-1: refuses a filled name given as an option\'s value: %s', (command) => refuse(command, agent));

  it.each([
    'read -r -a parts <<< "a b"',
    'while getopts ab opt; do echo $opt; done',
    'read -r line < README.md',
    "F=src; trap 'rm -rf ~/$F' EXIT; read -r -a parts <<< \"a b\"",
    "F=src; trap 'rm -rf ~/$F' EXIT; while getopts ab opt; do echo $opt; done",
    "F=src; trap 'rm -rf ~/$F' EXIT; read -r line < README.md",
  ])('SEC MEDIUM-1: keeps allowing ordinary read and getopts: %s', (command) => allowed(command, agent));

  it.each([
    ['a comment', `F=x; trap 'echo $F' EXIT; true # ${CHAIN}`],
    ['a heredoc', `F=x; trap 'echo $F' EXIT; cat <<'EOF'\n${CHAIN}\nEOF`],
    ['single quotes', `F=x; trap 'echo $F' EXIT; echo '${CHAIN}'`],
    ['a comment, as `${(` (flags never closed)', `F=x; trap 'echo $F' EXIT; true # ${'${('.repeat(20 * 1024)}`],
  ])('PERF MEDIUM-1: decides an unbalanced chain in %s after a filled trap within a second', async (_where, command) => {
    const start = Date.now();
    await call(command, agent);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it.each([
    'D=$(cd ~ && pwd); gcp -R mydir/. "$D"/.claude',
    'D=$(cd ~ && pwd); gmv x "$D"/.claude',
    'D=$(cd ~ && pwd); gln -sfn /tmp/z "$D"/.claude',
    'D=$(cd ~ && pwd); ginstall x "$D"/.claude',
    'D=$(cd ~ && pwd); gcp -t "$D"/.claude x',
    'D=$(cd ~ && pwd); grsync -a x/ "$D"/.claude/',
    'gcp x .oss/tool-gates.json',
  ])('PEN MEDIUM: refuses a GNU-named copy into a protected place: %s', (command) => refuse(command, agent));

  it.each(['gcp -R src dist', 'gmv a b', 'gln -s "$PWD/dist" current', 'ginstall -m 644 x "$OUT/"', 'grsync -a src/ "$DEST/"', 'gcp -t dist x'])(
    'PEN MEDIUM: keeps allowing an ordinary GNU-named copy: %s',
    (command) => allowed(command, agent),
  );
});
