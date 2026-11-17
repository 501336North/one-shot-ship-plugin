/**
 * @behavior On macOS `/System/Volumes/Data<path>` is the same file as `<path>` (the data volume's
 *   firmlink), in any letter case. The main agent and builders can't write a protected file through
 *   it: not with Write or Edit, not with a Bash redirect, not after `cd` into the firmlinked repo, and
 *   not by naming it to another program.
 * @business-rule R-266 round 11, SEC HIGH-1: protected-path matching strips the firmlink first.
 * @boundary runToolGate (the gate as the hook calls it).
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
const FIRMLINKS = ['/System/Volumes/Data', '/system/volumes/data', '/SYSTEM/Volumes/DATA'];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r11-firmlink-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(repo, '.oss', 'tool-gates'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(tool: string, input: object, agent: string | null): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({ session_id: 'r11-firmlink', cwd: repo, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, ...(agent === null ? {} : { agent_type: agent }) }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'darwin' },
  );
}

async function refused(tool: string, input: object, agent: string | null): Promise<void> {
  const result = await call(tool, input, agent);
  expect(result.exitCode, JSON.stringify(input)).toBe(2);
  expect(result.stderr).toMatch(/^Refused/);
}

describe.each(AGENTS)('%s', (_who, agent) => {
  describe.each(FIRMLINKS)('through %s', (firm) => {
    it('refuses Write and Edit of a protected repo file', async () => {
      const file = `${firm}${repo}/.oss/tool-gates.json`;
      await refused('Write', { file_path: file, content: '{}' }, agent);
      await refused('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, agent);
    });

    it('refuses Write of a protected home file', async () => {
      await refused('Write', { file_path: `${firm}${home}/.claude/settings.json`, content: '{}' }, agent);
    });

    it.each([
      (f: string) => `echo x > ${f}${repo}/.oss/tool-gates.json`,
      (f: string) => `cd ${f}${repo} && echo x > .oss/tool-gates.json`,
      (f: string) => `cd ${f}${repo}/.oss && echo x > tool-gates/x.json`,
      (f: string) => `curl -so ${f}${repo}/.oss/tool-gates.json https://example.com/x`,
      (f: string) => `rsync -a /tmp/x ${f}${repo}/.oss/tool-gates/`,
    ])('refuses the Bash write %#', async (make) => {
      await refused('Bash', { command: make(firm) }, agent);
    });
  });

  it('still allows a plain write through the firmlink', async () => {
    const result = await call('Bash', { command: `echo x > /System/Volumes/Data${repo}/notes.txt` }, agent);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});
