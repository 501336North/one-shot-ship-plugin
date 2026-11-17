/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) can't hide a write to
 *   a protected file, or a hook call with a HOME/PATH they chose, behind:
 *   - a script `trap`, `emulate … -c` or zsh's `functions[…]=` runs, or `sched`;
 *   - a zsh prefix (`noglob`, `nocorrect`, `-`) before `cd`, `pushd` or `setopt`, or `repeat`, or a `cd`
 *     builtin switched off (`enable -n cd`, `disable cd`);
 *   - an unknown variable next to a wildcard, a variable that is not at the start of the word, or one read
 *     through `${~X}`, `${=X}`, `${^X}`;
 *   - a variable set to a value that starts with `$HOME` or `~`;
 *   - a HOME or PATH setter the gate didn't count (`mapfile "$x"`, `set -A "$x"`, `(( $x = … ))`, `let`).
 *   Ordinary commands stay allowed: bash extended patterns that can't run code in zsh (`!(test)`,
 *   `!(node_modules)`), and a plain write after a shell option that can't move the folder (`set -o vi`).
 * @business-rule R-266 round 15: SEC HIGH-A/B, CR HIGH-1, CR HIGH-2, SEC MEDIUM-A, CR MEDIUM-1, PEN LOW-1,
 *   CR L1, CR L2, and the user's decision D-R14-4 "Loosen the safe cases".
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r15-forms-')));
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
        session_id: 'r15-shell-forms',
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

async function refused(command: string, agent: string | null): Promise<string> {
  const result = await call(command, agent);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
  return result.stderr;
}

async function refuse(command: string, agent: string | null): Promise<void> {
  await refused(command, agent);
}

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    "trap 'echo x > .oss/tool-gates.json' EXIT",
    "trap 'rm -rf ~/.oss/gate-state' EXIT",
    "trap -- 'echo x > .oss/tool-gates.json' EXIT",
    "builtin trap 'echo x > .oss/tool-gates.json' EXIT",
    "emulate zsh -c 'cp /dev/null .oss/tool-gates.json'",
    "builtin emulate zsh -c 'cp /dev/null .oss/tool-gates.json'",
    "noglob emulate -L zsh -c 'cp /dev/null .oss/tool-gates.json'",
    "functions[f]='echo x > .oss/tool-gates.json'; f",
    "trap 'cd .oss' DEBUG; echo x > tool-gates.json",
    "emulate zsh -c 'cd .oss'; echo x > tool-gates.json",
    "functions[f]='cd .oss'; f; echo x > tool-gates.json",
  ])('SEC HIGH-A/B: reads the script trap, emulate -c and functions[…] run: %s', (command) => refuse(command, agent));

  it.each([
    "trap 'rm -f \"$tmp\"' EXIT; echo x > out.txt",
    "trap 'rm -f /tmp/x.$$' EXIT; echo x > out.txt",
  ])('SEC HIGH-A/B: keeps the folder known after a cleanup trap that reads a variable: %s', (command) => allowed(command, agent));

  it("SEC HIGH-A/B: a trap that runs a command named by a variable makes the folder unknown", () =>
    refuse("trap '$c .oss' DEBUG; echo x > tool-gates.json", agent));

  it.each([
    'X=.oss; trap "echo x > $X/tool-gates.json" EXIT',
    'X=.oss; builtin trap -- "echo x > $X/tool-gates.json" EXIT',
    'X=.oss; emulate zsh -c "cp /dev/null $X/tool-gates.json"',
    'p=$HOME/.oss; trap "rm -rf $p/gate-state" EXIT',
    'trap "echo x > $(echo .oss)/tool-gates.json" EXIT',
    'X=$(echo .oss); trap "echo x > $X/tool-gates.json" EXIT',
  ])('SEC HIGH-A/B: expands a double-quoted trap or emulate string as the shell does, then reads it: %s', (command) => refuse(command, agent));

  it.each([
    'trap "rm -f $tmp" EXIT; echo x > out.txt',
    'trap "rm -rf \\"$dir\\"" EXIT',
    'tmp=$(mktemp -d); trap "rm -rf \\"$tmp\\"" EXIT; echo x > "$tmp/out.txt"',
    'trap "rm -f /tmp/x.$$" EXIT; echo x > out.txt',
    'D=build; trap "rm -rf $D" EXIT',
  ])('SEC HIGH-A/B: keeps a double-quoted cleanup trap allowed: %s', (command) => allowed(command, agent));

  it("SEC HIGH-A/B: reads what zsh's sched runs later", () => refuse("sched +0:01 'echo x > .oss/tool-gates.json'", agent));

  it.each([
    'noglob cd .oss && echo x > tool-gates.json',
    'nocorrect cd .oss && echo x > tool-gates.json',
    '- cd .oss && echo x > tool-gates.json',
    'noglob pushd .oss && echo x > tool-gates.json',
    'noglob setopt cdablevars; D=$PWD/.oss; cd D && echo x > tool-gates.json',
    'repeat 1 cd src; echo x > ../.oss/tool-gates.json',
    'enable -n cd; cd src; echo x > .oss/tool-gates.json',
    'disable cd; cd src; echo x > .oss/tool-gates.json',
    'unfunction cd; cd src; echo x > .oss/tool-gates.json',
  ])('CR HIGH-1: follows zsh prefixes and builtin switches: %s', (command) => refuse(command, agent));

  it.each([
    "X=$(echo ~/.claud); echo '{}' > ${X}?/settings.json",
    "X=$(echo ~/.claud); echo '{}' > ${X}*/settings.json",
    "X=$(echo ~/.claud); echo '{}' > ${X}[e]/settings.json",
    "D='.os'; echo x > $D?/tool-gates.json",
    "D='.os'; echo x > $D*/tool-gates.json",
    "D='.os'; echo x > $D[s]/tool-gates.json",
    'X=$(echo ~/.os); echo x > ${X}?/node-path',
    'X=$(echo ~/.os); echo x > ${X}*/node-path',
  ])('CR HIGH-2: refuses an unknown variable next to a wildcard: %s', (command) => refuse(command, agent));

  it.each([
    'D=json; echo x > .oss/tool-gates.$D',
    'D=.oss/tool-gates.js; echo x > $D?n',
    'X=.oss; cp /dev/null "$X"/tool-gates.js?n',
    'cp /dev/null "$(pwd)"/.oss/tool-gates.js?n',
    "D='*'; echo x > .oss/tool-gates.$D",
    "D='.oss'; E='tool-gates.js?n'; echo x > $D/$E",
    "D='.oss'; E='tool-gates.json'; echo x > $D/$E",
    'echo x > .oss/tool-gates.$(echo json)',
  ])('SEC MEDIUM-A: reads a variable or wildcard that is not at the start of the word: %s', (command) => refuse(command, agent));

  it.each([
    "D='.os?/tool-gates.json'; echo x > ${~D}",
    "D='/tmp/x .oss/tool-gates.json'; cp ${=D}",
    "D='.oss/tool-gates.json'; echo x > ${^D}",
  ])('CR MEDIUM-1: refuses ${~X}, ${=X} and ${^X}: %s', (command) => refuse(command, agent));

  it.each([
    'p=$HOME/.oss/gate-state; echo FORGED > $p/sess1/a.tamper',
    'v=$HOME/.oss/gate-state/sess1; rm -f $v/a.tamper',
    'v=${HOME}/.oss/gate-state/sess1; rm -f $v/a.tamper',
    'v=~/.oss/gate-state/sess1; rm -f $v/a.tamper',
  ])('PEN LOW-1: follows a value that starts with the home folder: %s', (command) => refuse(command, agent));

  it.each([
    `x=HOME; mapfile "$x" < /dev/null; ${HOOK}`,
    `x=HOME; readarray -t $x < /dev/null; ${HOOK}`,
    `x=PATH; set -A "$x" /usr/bin; ${HOOK}`,
    `x=PATH; set +A "$x" /usr/bin; ${HOOK}`,
    `x=HOME; (( $x = 1 )); ${HOOK}`,
    `x=HOME; let "$x=1"; ${HOOK}`,
    `x=HOME; : $(( $x = 1 )); ${HOOK}`,
  ])('CR L1: counts more HOME/PATH setters before a hook call: %s', (command) => refuse(command, agent));

  it('CR L2: names the option assignment in the reason', async () => {
    const reason = await refused('options[cdablevars]=on; D=$PWD/.oss; cd D && echo x > tool-gates.json', agent);
    expect(reason).toContain('options[cdablevars]=on');
    expect(reason).not.toContain('after ``');
  });

  it.each([
    'rm -rf src/!(test)',
    'rm -rf src/!(node_modules)',
    'rm -rf src/!(keep.txt)',
    'rm -rf src/!(src|test)',
    'rm -rf src/!(dist)',
    'rm -rf src/!(keeper)',
    'ls src/@(test|spec).ts src/+(node_modules) src/*(test) src/?(test)',
  ])('D-R14-4: allows a bash extended pattern that can not run code in zsh: %s', (command) => allowed(command, agent));

  it.each([
    "rm -rf src/!(esxs)",
    "rm -rf src/!(tests)",
    "rm -rf src/!(e{x})",
    "rm -rf src/!(oe_x_)",
    "rm -rf src/!(o+x)",
    "rm -rf src/!(+x)",
    "rm -rf src/!(P_x_)",
    "rm -rf src/!(:s/a/b/)",
    "rm -rf src/!(u_root_e_x_)",
    "rm -rf src/!(#qe_x_)",
    "rm -rf src/*(.Ne_x_)",
    "rm -rf src/*(^e_x_)",
  ])('D-R14-4: refuses a pattern zsh reads as a qualifier that runs code or rewrites names: %s', async (command) => {
    const reason = await refused(command, agent);
    expect(reason).not.toMatch(/bash extglob/);
  });

  it.each([
    'set -o vi; echo x > out.txt',
    'set -o emacs; echo x > out.txt',
    'setopt extendedglob; echo x > out.txt',
    'setopt -o allexport; echo x > out.txt',
    'setopt +o allexport; echo x > out.txt',
    'set -a; echo x > out.txt; set +a',
    'setopt globstar errreturn err_return interactivecomments; echo x > out.txt',
    'shopt -s globstar interactive_comments; echo x > out.txt',
    'setopt kshglob; echo x > out.txt',
    'set -o posix; echo x > src/out.txt',
    'setopt rcquotes; rm -rf build',
    'setopt kshglob; cp a.txt b.txt',
  ])('D-R14-4: allows a plain write after a shell option that can not move the folder: %s', (command) => allowed(command, agent));

  it.each([
    'setopt extendedglob; echo x > .git/conff#ig',
    'setopt kshglob; echo x > .oss/tool-gates.json',
    'setopt kshglob; echo x > .oss/tool-gates.jso^',
    'setopt kshglob; X=.oss; echo x > $X/tool-gates.json',
    'setopt kshglob; cd .oss; echo x > tool-gates.json',
    'setopt kshglob; rm -rf src/*',
    'setopt cdablevars; echo x > out.txt',
    'setopt globsubst; echo x > out.txt',
    'setopt braceccl; echo x > .git/confi{g}',
    'setopt magicequalsubst; echo x > out.txt',
    'setopt autocd; echo x > out.txt',
    'set -T; echo x > out.txt',
  ])('D-R14-4: still refuses what an unmodelled option makes unknown: %s', (command) => refuse(command, agent));
});
