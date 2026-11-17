/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere) can't hide a forced
 *   push or a write to a protected file inside a `name=(` that zsh reads as a glob group:
 *   - zsh treats `typeset` and its family (and `nocorrect`, `time`, `if` …) as reserved words, and `A=1` as
 *     an assignment, only when they are written plainly. A quoted or escaped `'typeset'`, `\typeset`,
 *     `t"ypeset"`, `'A=1'`, `A\=1`, or a brace list `{A=1,B=2}`, is an ordinary command word, so the
 *     `x=(` after it is a glob group that runs on across lines (`#x) ; echo x > …` writes the file). Such a
 *     `name=(` is refused for every agent (ADR-061);
 *   - `disable -r` and `enable -r` change which words zsh reserves, so any call using them is refused;
 *   - a plainly written `nocorrect` is a command-start prefix: `nocorrect arr=(a)` is an array.
 *   Ordinary array assignments stay allowed.
 * @business-rule R-266 round 21 Part A: PEN HIGH (round 20) = SEC HIGH-1 (round 20), round-19 H2 still open
 *   through quoted words; CR INFO-1 (round 20), `nocorrect arr=(a)`.
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r21a-arrays-')));
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
        session_id: 'r21a-arrays',
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

const WRITE = ' x=(a|b\n#x) ; echo x > .oss/tool-gates.json';

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each([
      `'typeset'${WRITE}`,
      `\\typeset${WRITE}`,
      `"typeset"${WRITE}`,
      `t\\ypeset${WRITE}`,
      `t"ypeset"${WRITE}`,
      `\\local${WRITE}`,
      `\\export${WRITE}`,
      `'A=1'${WRITE}`,
      `A\\=1${WRITE}`,
      `{A=1,B=2}${WRITE}`,
      '"typeset" x=(a|b\n#x) ; git push --force origin main',
      '\\typeset x=(a b)',
      `\\time${WRITE}`,
      `\\nocorrect${WRITE}`,
    ])('PEN/SEC HIGH: `name=(` after a quoted or escaped typeset word or assignment is a glob group and is refused: %s', (command) =>
      refuse(command, agent, platform),
    );

    it.each([
      `disable -r typeset; typeset${WRITE}`,
      'disable -r typeset',
      'enable -r typeset',
      'disable -pr local',
      'builtin disable -r export',
    ])('`disable -r` / `enable -r` change which words are reserved and are refused: %s', (command) =>
      refuse(command, agent, platform),
    );

    it.each([
      'nocorrect arr=(a b)',
      'nocorrect arr=(a)',
      'typeset -a arr=(a b)',
      'f() { local x=(1 2); }',
      'arr=(a b); echo $arr',
      'A=1 B=2 arr=(x)',
      'typeset "-a" arr=(a b)',
      // round 22, Task 19: zsh reads `A=$B` as an assignment, the same as `A=1` (only a quoted or escaped name breaks
      // that), so `x=(` is an array and the line is a parse error that runs nothing; it was allowed at round 20
      `A=$B${WRITE}`,
      'grep enable -r src',
      'git log --grep=disable -r',
    ])('keeps ordinary array assignments and commands allowed: %s', (command) => allowed(command, agent, platform));
  });
});

describe('the refusal says why', () => {
  it('names a quoted typeset word before `name=(` as a mid-command glob group', () => {
    const result = tokenize(`\\typeset${WRITE}`, '/home/dev');
    expect('unreadable' in result && result.limit).toBe(true);
    expect('unreadable' in result && result.reason).toMatch(/zsh glob groups like `\(a\|b\)` in the middle of a command aren't read by the gate/);
  });

  it('names `disable -r` as changing the reserved words', () => {
    const result = tokenize('disable -r typeset', '/home/dev');
    expect('unreadable' in result && result.limit).toBe(true);
    expect('unreadable' in result && result.reason).toMatch(/reserved words/);
  });
});
