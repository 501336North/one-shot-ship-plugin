/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) can't hide a forced
 *   push or a write to a protected file inside a zsh glob group `(…)`:
 *   - zsh reads a group across newlines up to its `)`, so a `#` on a later line is pattern text, not a
 *     comment, and the commands after the group still run;
 *   - zsh ends the group's word at an unquoted `>` or `<`: the redirect runs when the `)` closes an
 *     enclosing subshell or `$(…)`.
 *   User decision D-R19-3 ("Refuse all groups", 2026-11-17): any zsh glob group in the middle of a command
 *   (after the command's first word, or as a redirect target) is refused for every agent, with a reason
 *   that says to list the names instead. Exempt forms stay allowed: subshells, `$(…)`, `<(…)`, `>(…)`,
 *   `for i ({1..3})`, `for x (…)`, `for ((…))`, `coproc (…)`, `time (…)`, `f()`, `name=(…)`, `(( ))`, case
 *   patterns, `[[ … ]]`, glob qualifiers and extglob patterns; quoted text and heredoc bodies are no groups.
 *   Reading a long run of `(` takes work in proportion to the command, not its square.
 * @business-rule R-266 round 19: PEN HIGH-1 + SEC HIGH-1 (glob group across a newline or cut by a
 *   redirect), D-R19-3, PERF LOW-1 (quadratic group-end search).
 * @boundary runToolGate (the gate as the hook calls it) with a scratch home and repo; tokenize under a
 *   counting deadline clock for the work bound.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { tokenize } from '../../src/tool-gate/tokenize.js';
import { withDeadline } from '../../src/tool-gate/deadline.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r19a-groups-')));
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
        session_id: 'r19a-glob-groups',
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

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    '( noglob echo (a|b >.oss/tool-gates.json )',
    '( noglob echo (a|b >~/.claude/settings.json )',
    'echo $(noglob echo (a|b >.oss/tool-gates.json )',
    '"$(noglob echo (a|b >.oss/tool-gates.json )"',
    'noglob echo (a|b >.oss/tool-gates.json )',
    '( noglob echo (a|b >.git/hooks/pre-commit )',
    '( noglob echo (a|b <in >.oss/tool-gates.json )',
    '( noglob echo (a|b<>.oss/tool-gates.json )',
  ])('SEC HIGH-1: a redirect inside a glob group is refused: %s', (command) => refuse(command, agent));

  it.each([
    'ls (a|b\n#x) ; git push --force origin main',
    'ls (a|b\n#x) ; echo x > .oss/tool-gates.json',
    'ls -d (a|b\n#) && rm -rf ~/.claude',
    'noglob echo (a|b\n#) ; echo x > ~/.claude/settings.json',
    'ls (a|b\nc) ; git push --force origin main',
  ])('PEN HIGH-1: a glob group zsh reads across a newline is refused: %s', (command) => refuse(command, agent));

  it.each([
    'noglob echo (a|$(echo q))',
    'noglob echo (a|"$(echo q)")',
    'noglob echo (a|`echo q`)',
    'noglob echo (a|<(echo q))',
    'noglob echo (a|>(cat))',
  ])('a substitution inside a glob group is refused: %s', (command) => refuse(command, agent));

  it.each([
    'ls (a|b) && echo found',
    'noglob echo (a)',
    'noglob echo (a|<1-5>)',
    'noglob echo (a|"b > c")',
    "noglob echo (a|'b\nc')",
    'noglob echo (a|\\>c)',
    'ls (src|test)/*.ts > files.txt',
    'rm -f (a|b).log',
    'echo x > (a|b)/y',
    'cat < (a|b)',
  ])('D-R19-3: any glob group in the middle of a command is refused: %s', (command) => refuse(command, agent));

  it.each([
    "cat <<'EOF' > x.txt\n(a|b)\nEOF",
    'cat <<EOF > x.txt\n(a|b)\nEOF',
    'for f in src/*.ts; do\n  (cd "$(dirname "$f")" && wc -l "$f")\ndone > counts.txt',
    'echo "(a|b) # not a comment" > notes.txt',
    "grep -E '(foo|bar)' src/x.ts > out.txt",
    'seq 1 5 | (while read n; do echo $n; done)',
    'diff <(ls a) <(ls b)',
    'echo $(date) > out.txt',
    'for i ({1..3}) echo $i',
    'for x (a b) echo $x',
    'for ((i = 0; i < 3; i++)); do echo $i; done',
    'coproc (cat)',
    'time (npm test)',
    '(cd src && npm test)',
    'f() { echo hi; }; f',
    'function g () { :; }',
    'arr=(a b); echo ${arr[1]}',
    'if (( x > 1 )); then echo; fi',
    'case $x in (a|b) echo;; esac',
    '[[ $x == (a|b) ]] && echo y',
    'ls *.ts(N)',
    'rm -rf !(node_modules)',
  ])('keeps exempt forms, quoted text and heredoc bodies allowed: %s', (command) => allowed(command, agent));
});

describe('the refusal names the glob group', () => {
  it('says glob groups are not read and to list the names', () => {
    const result = tokenize('( noglob echo (a|b >.oss/tool-gates.json )', '/home/dev');
    expect('unreadable' in result && result.limit).toBe(true);
    expect('unreadable' in result && result.reason).toMatch(/zsh glob groups like `\(a\|b\)` in the middle of a command aren't read by the gate; list the names instead/);
  });
});

describe('PERF LOW-1: finding where glob groups end takes work in proportion to the command', () => {
  /** The deadline clock is read once per 256 steps of work: counting reads counts the work. */
  function work(command: string): number {
    let reads = 0;
    withDeadline(1e12, () => ++reads, () => tokenize(command, '/home/dev'));
    return reads * 256;
  }

  it('does at most a small multiple of the command length in steps, at 64, 128 and 256 KB', () => {
    for (const kb of [64, 128, 256]) {
      const command = `ls ${'(a '.repeat(Math.floor((kb * 1024) / 3))}`;
      expect(work(command), `${kb} KB`).toBeLessThan(command.length * 20);
    }
  });
});
