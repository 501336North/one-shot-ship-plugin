/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) can't hide a forced
 *   push or a write to a protected file behind a zsh glob group `(…)` that zsh would not read as one:
 *   - an unclosed group, or one cut by `;`, `&` or a newline (zsh ends the group's word there and runs
 *     what follows, for instance under `noglob`);
 *   - a group after a `for` or `coproc` that is only an argument (`ls for (a|#)`), not the keyword;
 *   - a group whose quotes hide its real end (`"\""`, `$'\''`);
 *   - a `#` inside `(…)` in `[[ … ]]` or a case pattern, which zsh reads as pattern text, not a comment.
 *   Ordinary forms stay allowed: `for i ({1..3})`, `case $x in (a|b)`, `coproc (cat)`, `time (npm test)`,
 *   subshells.
 * @business-rule R-266 round 18: PEN HIGH-1, SEC MEDIUM-2 / CR LOW-1a, SEC LOW-1 / CR LOW-1b, CR limit 2,
 *   PERF INFO-1 (a refusal quotes at most about 60 characters of the group).
 * @boundary runToolGate (the gate as the hook calls it) with a scratch home and repo; tokenize for the
 *   refusal text.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { tokenize } from '../../src/tool-gate/tokenize.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r18-groups-')));
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
        session_id: 'r18-glob-groups',
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
    'ls (a|b; git push --force origin main',
    'ls (a|b; echo x > .oss/tool-gates.json',
    'ls (a|b; echo x > ~/.claude/settings.json',
    'ls (a|b; rm -rf .oss',
    'ls (a|b\ngit push --force origin main',
    'grep foo (a|b; git push --force origin main',
    'ls (a|b && git push --force origin main',
    'ls (a|b & git push --force origin main',
    'ls (a|b c; git push --force origin main',
    'noglob ls (a|#; git push --force origin main',
  ])('PEN HIGH-1: reads the commands after a glob group that `;`, `&` or a newline cuts: %s', (command) =>
    refuse(command, agent));

  it.each([
    'ls for x (src|#); git push --force origin main',
    'ls for (src|#); git push --force origin main',
    'echo coproc (src|#); git push --force origin main',
    'for x in a; do echo for (src|#); done; git push --force origin main',
    'echo for x (a|#); git push --force origin main',
    'rm -rf for (.oss|x)',
  ])('SEC MEDIUM-2: a `for` or `coproc` that is only an argument does not make `(…)` a list: %s', (command) =>
    refuse(command, agent));

  it.each([
    'ls -d (a"\\"" |#) ; git push --force origin main',
    "ls (src|$'\\'') ; git push --force origin main ; echo ' ) '",
  ])('SEC LOW-1: finds the end of a glob group past escaped quotes: %s', (command) => refuse(command, agent));

  it.each([
    '[[ x == (a|#) ]]; echo x > .oss/tool-gates.json',
    'case x in (a|#) echo m;; esac; echo x > .oss/tool-gates.json',
    '[[ x == (a| #) ]]; git push --force origin main',
  ])('CR limit 2: a `#` in `(…)` of a `[[ … ]]` or case pattern starts no comment: %s', (command) =>
    refuse(command, agent));

  it.each([
    'for i ({1..3}) echo $i',
    'for x (a b) echo $x',
    'case $x in (a|b) echo;; esac',
    'case $x in (a|b) echo m;; esac; echo x > out.txt',
    '[[ $x == (a|b) ]] && echo y',
    'coproc (cat)',
    'for x in a; do echo hi; done; coproc (cat)',
    'time (npm test)',
    '(cd src && npm test)',
  ])('keeps ordinary lists, case patterns and subshells allowed: %s', (command) => allowed(command, agent));

  it.each(['ls (a|b) && echo found', 'noglob echo (a)'])(
    'D-R19-3: refuses a plain glob group in the middle of a command (round 19): %s',
    (command) => refuse(command, agent),
  );
});

describe('PERF INFO-1: a refusal quotes a long group or qualifier cut short', () => {
  it.each([
    `ls (${'a'.repeat(300)}|#)`,
    `ls *(${'e'.repeat(300)}:x:)`,
  ])('quotes about 60 characters of %#', (command) => {
    const result = tokenize(command, '/home/dev');
    expect('unreadable' in result && result.reason).toMatch(/…/);
    expect('unreadable' in result ? result.reason.length : 0).toBeLessThan(200);
  });
});
