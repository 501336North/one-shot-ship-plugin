/**
 * @behavior A variable the main agent or a builder sets is followed to its use only past commands
 *   that can't change it. `test` / `[` with `-v` (bash evaluates the subscript as arithmetic, and
 *   runs `$(…)` in it), and `printf` (zsh evaluates its numeric arguments as arithmetic: `printf %d F=7`
 *   sets F) can change it, so after one the variable is unknown. A name written after `-` or `--`
 *   (`--F`) still counts as a mention of F.
 * @business-rule R-266 round 13, CR M-1 (MEDIUM): `F=src; [ -v 'a[--F]' ]; echo x > "$F/config"`
 *   wrote somewhere other than the `src/config` the gate read.
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r13-arith-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
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
        session_id: 'r13-harmless-arithmetic',
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

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    `F=src; [ -v 'a[--F]' ]; echo x > "$F/config"`,
    `F=src; printf %d '--F' >/dev/null; echo x > "$F/config"`,
    `F=src; [ -v 'a[--F]' ]; cd "$F" && echo x > config`,
    `F=src; printf %d '--F' >/dev/null; cd "$F" && echo x > config`,
    // zsh: any numeric printf argument is arithmetic
    `F=src; printf %d 'F=7' >/dev/null; cd "$F" && echo x > config`,
    `F=src; printf '%.*s' 'F=2' x >/dev/null; cd "$F" && echo x > config`,
    // bash: -v reads its operand as a variable, subscript and all
    `F=src; test -v 'a[$(echo 1)]'; cd "$F" && echo x > config`,
    // a test operand only known when it runs could be -v
    `F=src; [ "$V" 'a[--F]' ]; cd "$F" && echo x > config`,
  ])('fails closed after a command that can change the variable: %s', (command) => refused(command, agent));

  it.each([
    'F=src; [ -f x ]; cd "$F" && echo x > config',
    'F=src; test -d src && cd "$F" && echo x > config',
    'F=src; [ 1 -eq 1 ]; echo x > "$F/config"',
    'd=$(mktemp -d) && echo x > "$d"/config',
  ])('still follows past harmless commands: %s', (command) => allowed(command, agent));
});
