/**
 * @behavior After the gate fills a variable's value into a trap, `emulate … -c` or `sched` script (which
 *   runs later), the main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) are refused only
 *   when a later command could change that value the gate can't see: a builtin that sets a name chosen at
 *   run time (also with a leading assignment or redirect, inside a later trap's script or in the filled
 *   script itself), a set of the filled name, eval/alias/nameref, an unknown command word, a shell option
 *   the gate doesn't model, or new positional parameters a filled script reads (`$argv` too). Every other
 *   later command is allowed: ordinary clean-up traps keep working with the usual commands after them.
 * @business-rule R-266 round 18, user decision D-R18-1 ("Refuse only risky setters"): the round-17
 *   allowlist after a filled trap is replaced by a denylist; SEC INFO-1 (`$argv`), CR limit 1 / SEC limit 1
 *   (options after a filled trap).
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r18-filled-trap-')));
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
        session_id: 'r18-filled-trap',
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

/** `$G` holds `F` at run time, which the gate can't see: `$'…'` is never followed. */
const G = "G=$'\\x46'; ";
const FILLED = "F=src; trap 'echo x > $F/tool-gates.json' EXIT; ";
/** A builtin that sets the variable `$(printf '\106')` (F) names at run time. */
const HIDDEN = "$(printf '\\106')";
const CLEAN_UP = "D=build; trap 'rm -rf \"$D\"' EXIT; ";

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    `${G}${FILLED}trap 'X=1 printf -v $G %s .oss' DEBUG; true`,
    `${G}${FILLED}trap '>/dev/null printf -v $G %s .oss' DEBUG; true`,
    `${G}${FILLED}trap 'X=1 read -r $G <<< .oss' DEBUG; true`,
    `${G}${FILLED}trap 'X=1 printf -v $G %s .oss' ZERR; false`,
    `${G}F=src; trap 'rm -rf ~/$F' EXIT; trap 'X=1 printf -v $G %s .oss' DEBUG; true`,
    `${FILLED}trap 'trap "printf -v $G %s .oss" DEBUG' INT`,
    `${G}F=src; trap 'X=1 printf -v $G %s .oss; echo x > $F/tool-gates.json' EXIT; true`,
  ])('D-R18-1: refuses a hidden setter inside a later (or the filled) script, past a leading assignment or redirect: %s', (command) =>
    refuse(command, agent));

  it.each([
    `${FILLED}{ printf -v ${HIDDEN} %s .oss; }`,
    `${FILLED}if true; then read ${HIDDEN} <<< .oss; fi`,
    `${FILLED}(printf -v ${HIDDEN} %s .oss)`,
    `${FILLED}true | printf -v ${HIDDEN} %s .oss`,
    `${FILLED}echo $(printf -v ${HIDDEN} %s .oss)`,
    `${FILLED}command printf -v ${HIDDEN} %s .oss`,
    `${FILLED}X=1 printf -v ${HIDDEN} %s .oss`,
    `${FILLED}mapfile ${HIDDEN} < /dev/null`,
    `${FILLED}zparseopts -A ${HIDDEN}`,
    `${FILLED}export ${HIDDEN}=.oss`,
    `${FILLED}x=F; let "$x=2"`,
    `${FILLED}: \${F::=.oss}`,
    `${FILLED}echo $H[F=1]`,
    `${FILLED}emulate sh -c 'printf -v $(printf "\\106") %s .oss'`,
    `${FILLED}sched +0 'printf -v $(printf "\\106") %s .oss'`,
  ])('D-R18-1: refuses a builtin that sets a name not written out, anywhere after the filled trap: %s', (command) =>
    refuse(command, agent));

  it.each([
    `${FILLED}F=.oss`,
    `${FILLED}for F in .oss; do :; done`,
    `${FILLED}read F <<< .oss`,
    `${FILLED}printf -v F %s .oss`,
    "F=src; trap 'rm -rf ~/$F' EXIT; unset F",
    `${FILLED}eval 'F=.oss'`,
    `${FILLED}alias x=y`,
    `${FILLED}typeset -n R=F`,
    `${FILLED}$CMD x`,
    "F=src; trap 'echo x > $F/$argv' EXIT; set -- ../.oss/tool-gates.json",
    "F=src; trap 'echo x > $F/${argv}' EXIT; set -- ../.oss/tool-gates.json",
    "F=ax.oss; trap 'rm -rf $F' EXIT; IFS=x; true",
  ])('D-R18-1: refuses a later set of the filled name, eval, alias, nameref, unknown command or positional change: %s', (command) =>
    refuse(command, agent));

  it.each([
    "F='~/.oss'; trap 'rm -rf $F' EXIT; set -o globsubst",
    "F=zz; trap 'cd $F && echo x > tool-gates.json' EXIT; set -o cdablevars; zz=.oss",
    `${FILLED}setopt extendedglob`,
    `${FILLED}set -o braceccl`,
  ])('CR limit 1 / SEC limit 1: refuses a shell option the gate does not model after a filled trap: %s', (command) =>
    refuse(command, agent));

  it.each([
    'D=build; trap "rm -rf $D" EXIT; trap "rm -rf $D/x" INT',
    'LOG=out.log; trap "echo failed >> $LOG" ERR; npm test',
    `${CLEAN_UP}export FOO=1; npm test`,
    `${CLEAN_UP}set -e`,
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; npm test; status=$?; tail \"$tmp/log\"; exit $status",
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; npm test; exit $?",
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; git worktree add \"$tmp/wt\" HEAD && cd \"$tmp/wt\" && npm test",
    "tmp=$(mktemp); trap 'rm -f \"$tmp\"' EXIT; git diff > \"$tmp\"; test -s \"$tmp\" && echo changed",
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; [[ -f dist/index.js ]] && echo ok",
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; node server.js & PID=$!; sleep 1; kill $PID; wait",
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; printf '%s\\n' a b > \"$tmp/in\"; while read -r f; do echo \"$f\"; done < \"$tmp/in\"",
    "tmp=$(mktemp -d); trap 'rm -rf \"$tmp\"' EXIT; time npm test; pushd src; popd; command -v jq; umask 022; ulimit -n; cd -",
    `${CLEAN_UP}set -euo pipefail; export CI=1; npm test`,
    `${CLEAN_UP}arr=(a b); echo \${arr[1]}`,
    `${CLEAN_UP}if (( x > 1 )); then echo; fi`,
    `${CLEAN_UP}time (npm test)`,
    `${CLEAN_UP}coproc (cat)`,
    `${CLEAN_UP}[[ -n "$x" ]] && echo y`,
    `${CLEAN_UP}IFS=x; true`,
  ])('D-R18-1: allows ordinary commands after a filled clean-up trap: %s', (command) => allowed(command, agent));

  it('D-R19-3: refuses a zsh glob group after a filled clean-up trap, as anywhere in the middle of a command', () =>
    refuse(`${CLEAN_UP}noglob echo (a)`, agent));

  it('D-R18-1: the refusal names the cause and the double-quote way out', async () => {
    const result = await call(`${FILLED}printf -v ${HIDDEN} %s .oss`, agent);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('a later command could change `$F`');
    expect(result.stderr).toContain('trap "rm -rf $F" EXIT');
  });
});
