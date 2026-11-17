/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) can't hide a write to
 *   a protected file or a forced push behind:
 *   - a variable filled into a trap, `emulate … -c` or `sched` script and then changed by a later builtin
 *     that sets a name chosen at run time (`printf -v`, `read`, `vared`, `(( ))`, `getopts`…);
 *   - a clean-up `rm -rf` in such a script whose unknown folder could hold protected files
 *     (`~/"$X"`, `"$X"/.oss`, `"../$X"`);
 *   - a zsh glob group `(a|#)`, whose `#` would otherwise hide the rest of the command;
 *   - a glob qualifier or extglob bracket that takes its text from a variable or a substitution.
 *   Ordinary commands stay allowed: clean-up traps, function and array definitions, subshells, `$(…)`,
 *   process substitution, `(( ))`, and the usual qualifiers and extglob patterns.
 * @business-rule R-266 round 17: SEC MEDIUM-1, SEC LOW-1 / PEN LOW-1, code-review limits A and B, PEN INFO
 *   (the refusal text for a launcher script names the inner command, not the launcher).
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r17-forms-')));
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
        session_id: 'r17-shell-forms',
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

const LAUNCHERS: Array<[string, (script: string) => string]> = [
  ['trap', (script) => `trap '${script}' EXIT`],
  ['emulate -c', (script) => `emulate zsh -c '${script}'`],
  ['sched', (script) => `sched +0 '${script}'`],
];

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    "F=src; trap 'echo x > $F/tool-gates.json' EXIT; printf -v $(printf '\\106') %s .oss",
    "F=src; trap 'rm -rf ~/$F' EXIT; printf -v $(printf '\\106') %s .oss",
    "F=src; trap 'echo x > $F/tool-gates.json' DEBUG; printf -v $(printf '\\106') %s .oss",
    "F=src; trap 'echo x > $F/tool-gates.json' EXIT; read $(printf '\\106') <<< .oss",
    "F=src; trap 'echo x > $F/tool-gates.json' EXIT; vared $(printf '\\106')",
    "F=src; trap 'echo x > $F/tool-gates.json' EXIT; strftime -s $(printf '\\106') %s 0",
    "F=src; trap 'echo x > $F/tool-gates.json' EXIT; print -v $(printf '\\106') .oss",
    "F=build; trap 'rm -f $F/tool-gates.json' EXIT; x=$(printf '\\x46'); (( $x = 0 ))",
    "F=build; trap 'rm -f $F/tool-gates.json' EXIT; x=$(printf '\\x46'); getopts ab $x",
    "F=build; trap 'rm -f $F/tool-gates.json' EXIT; x=$(printf '\\x46'); read $x",
  ])('SEC MEDIUM-1: refuses a filled-in trap variable a later builtin may change: %s', (command) =>
    refuse(command, agent));

  it.each([
    "D=build; trap 'rm -rf \"$D\"' EXIT; npm test",
    'D=build; trap "rm -rf $D" EXIT; trap "rm -rf $D/x" INT',
    'tmp=$(mktemp -d); trap "rm -rf $tmp" EXIT; cd src && npm test',
    'LOG=out.log; trap "echo failed >> $LOG" ERR; npm test',
    "D=build; trap 'rm -rf \"$D\"' EXIT; pwd; npm test",
  ])('SEC MEDIUM-1: keeps ordinary clean-up traps allowed: %s', (command) => allowed(command, agent));

  it.each([
    "D=build; trap 'rm -rf \"$D\"' EXIT; set -e; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; set -euo pipefail; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; set -o pipefail; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; set -- a b; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; export FOO=1; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; typeset -i N=1; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; trap 'rm -rf \"$D/x\"' INT",
  ])('D-R17-2: allows a later set, a literal-name declaration or a readable trap: %s', (command) => allowed(command, agent));

  it.each([
    "D=build; trap 'rm -rf \"$D\"' EXIT; export D=.oss; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; typeset -n R=$(printf '\\x44'); npm test",
    "D=src; trap 'echo x > $D/tool-gates.json' EXIT; typeset -n R=D; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; set -A D .oss; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; local $(printf '\\x44')=.oss; npm test",
    "D=build; trap 'rm -rf \"$D/$1\"' EXIT; set -- ../.oss; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; trap 'printf -v $(printf \"\\x44\") %s .oss' DEBUG; npm test",
    "D=build; trap 'rm -rf \"$D\"' EXIT; $CMD test",
  ])('D-R17-2: still refuses a later builtin that may change the filled variable: %s', (command) => refuse(command, agent));

  describe.each(LAUNCHERS)('in a %s script', (_launcher, wrap) => {
    it.each([
      'rm -rf ~/"$X"',
      'rm -rf "$HOME/$X"',
      'rm -rf "$X"/.oss',
      'rm -rf "../$X"',
      'rm -rf "$dir"/.oss',
      'rm -rf "$dir"/.claude',
      'rm -rf "$dir"/.git/hooks',
      'rm -rf "$dir"/.oss/tool-gates',
    ])('SEC LOW-1: refuses a clean-up delete whose folder could hold protected files: %s', (script) =>
      refuse(wrap(script), agent));

    it.each(['rm -rf "$dir"', 'rm -rf "$tmp"', 'rm -rf "$dir/build"', 'rm -rf "out/$X"'])(
      'SEC LOW-1: keeps an ordinary clean-up delete allowed: %s',
      (script) => allowed(wrap(script), agent),
    );
  });

  it.each([
    'ls (a|#); git push --force origin main',
    'ls (a|#); echo x > .oss/tool-gates.json',
    'rm -rf (.oss|x)',
    'echo x > (.oss|x)/tool-gates.json',
    'setopt extendedglob; rm -f (#i).OSS/tool-gates.json',
  ])('CR limit A: reads a zsh glob group as unknown and never as a comment: %s', (command) => refuse(command, agent));

  it.each([
    'f() { echo hi; }',
    'function f () { echo hi; }',
    'arr=(a b)',
    '[[ -n "$x" ]]',
    '(cd src && npm test)',
    'echo $(date)',
    'diff <(ls a) <(ls b)',
    'if (( x > 1 )); then echo big; fi',
  ])('CR limit A: keeps ordinary brackets allowed: %s', (command) => allowed(command, agent));

  it.each([
    "X='e:rm -f .oss/tool-gates.json:'; ls *($X)",
    'ls *($X)',
    'ls *(.$X)',
    'ls !($X)',
    'rm -f *(${X})',
    'ls *($(echo e:x:))',
    'ls *(`echo e:x:`)',
  ])('CR limit B: refuses a qualifier or extglob bracket that takes text from a variable: %s', (command) =>
    refuse(command, agent));

  it.each(['ls *(.om[1,5])', 'ls src/*.ts(N)', 'rm -rf !(node_modules)', 'ls @(src|test)'])(
    'CR limit B: keeps ordinary qualifiers and extglob patterns allowed: %s',
    (command) => allowed(command, agent),
  );

  it.each(["trap 'rm -rf \"$dir\"/.git' EXIT", "emulate zsh -c 'echo x > .oss/tool-gates.json'"])(
    'PEN INFO: a refusal inside a launcher script never names the launcher as a file to read: %s',
    async (command) => {
      const result = await call(command, agent);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).not.toMatch(/\| (trap|emulate|sched)`/);
      expect(result.stderr, command).not.toMatch(/`cat (rm|echo|trap|emulate|sched) /);
    },
  );
});
