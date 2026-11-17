/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) can't hide a forced
 *   push or a write to a protected file inside a zsh glob group that follows a pattern or a `name=`:
 *   - after a pattern (`x*(`, `@(`, `!(`, `?(`, `*.(`, `[a](`, `src/*(`) zsh ends the group's word at an
 *     unquoted `>`, `<`, `&` or `;` (the rest runs as a command) and reads the group across newlines (a
 *     `#` on a later line is pattern text). A group that holds an unquoted newline, comment, redirect,
 *     separator or substitution, or never closes, is refused for every agent;
 *   - `name=(` is an array only where an assignment can stand: at command start (after other
 *     assignments) or as an argument of `typeset`, `declare`, `local`, `export`, `readonly`, `integer` or
 *     `float`. Anywhere else zsh reads it as a glob group (`ls x=(a|b` ⏎ `#x) ; git push …` runs the push),
 *     so it is refused like any mid-command glob group (ADR-061).
 *   Ordinary glob qualifiers, extended globs and array assignments stay allowed.
 * @business-rule R-266 round 20 Part A: PEN HIGH-1 = SEC HIGH-1 (round-18 H1 still open through wildcard
 *   groups), SEC HIGH-2 (`name=(` read as an array in argument position).
 * @boundary runToolGate (the gate as the hook calls it) with a scratch home and repo, on darwin and linux.
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
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r20a-groups-')));
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

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r20a-groups',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform },
  );
}

async function allowed(command: string, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(command, agent, platform);
  expect(result.stderr, command).toBe('');
  expect(result.exitCode, command).toBe(0);
}

async function refuse(command: string, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(command, agent, platform);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
}

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each([
      '( noglob echo x*(a|b >.oss/tool-gates.json )',
      '( noglob echo @(a|b >.oss/tool-gates.json )',
      '( noglob echo !(a|b >.oss/tool-gates.json )',
      '( noglob echo x?(a|b >.oss/tool-gates.json )',
      '( noglob echo *.(a|b >.oss/tool-gates.json )',
      '( noglob echo [a](a|b >.oss/tool-gates.json )',
      '( noglob echo *(a|b >~/.claude/settings.json )',
      'echo $( noglob echo x*(a|b >.oss/tool-gates.json )',
      '( noglob echo *(a|b && rm -rf ~/.claude )',
      '( noglob echo src/*(a|b >.git/hooks/pre-commit )',
      'noglob echo *(a|b\necho x > .oss/tool-gates.json\n#)',
      '( noglob echo *(a|b ; rm -rf ~/.claude )',
      '( noglob echo *(a|b <in >.oss/tool-gates.json )',
      'noglob echo *(a|b #x)',
      'ls *(a|b',
    ])('PEN/SEC HIGH-1: a wildcard glob group holding a newline, comment, redirect or separator is refused: %s', (command) =>
      refuse(command, agent, platform),
    );

    it.each([
      'ls x=(a|b\n#x) ; git push --force origin main',
      'noglob echo x=(a|b\n#x) ; echo x > .oss/tool-gates.json',
      'echo x=(a)',
      'echo then x=(a|b\n#x) ; git push --force origin main',
    ])('SEC HIGH-2: `name=(` outside an assignment is a glob group and is refused: %s', (command) =>
      refuse(command, agent, platform),
    );

    it.each([
      'ls *(.N)',
      'ls **/*.ts(.om[1,5])',
      'ls *(/)',
      'ls !(node_modules)',
      'ls @(a|b).txt',
      'ls *.(ts|js)',
      'ls src/*(.)',
      'ls x*(a|b)',
      'ls *(a|b) > files.txt',
      'ls *.ts(N)',
      'rm -rf !(node_modules)',
      'arr=(a b)',
      'arr=(a b); echo ${arr[1]}',
      'typeset -a arr=(a b)',
      'f() { local arr=(1 2); }',
      'declare -a x=(1 2)',
      'readonly R=(a)',
      'export PATHS=(a b)',
      'integer -a n=(1 2)',
      'A=1 arr=(a b)',
      'arr+=(c)',
      'if true; then arr=(a); fi',
    ])('keeps ordinary glob qualifiers, extended globs and arrays allowed: %s', (command) => allowed(command, agent, platform));
  });
});

describe('the refusal says why', () => {
  it('names a glob group that holds a redirect or separator', () => {
    const result = tokenize('( noglob echo x*(a|b >.oss/tool-gates.json )', '/home/dev');
    expect('unreadable' in result && result.limit).toBe(true);
    expect('unreadable' in result && result.reason).toMatch(/a zsh glob group holds a newline, comment, redirect or separator/);
  });

  it('names `name=(` outside an assignment as a mid-command glob group', () => {
    const result = tokenize('echo x=(a)', '/home/dev');
    expect('unreadable' in result && result.limit).toBe(true);
    expect('unreadable' in result && result.reason).toMatch(/zsh glob groups like `\(a\|b\)` in the middle of a command aren't read by the gate; list the names instead/);
  });
});
