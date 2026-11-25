/**
 * @behavior The main agent and builders can't make git show a different history: a `git replace` that
 *   adds, forces, edits, grafts, converts a graft file into or deletes a replacement is refused, however
 *   it is spelled (`-c …` or global options before `replace` included), and so is a write to
 *   `.git/info/grafts` or `.git/refs/replace/` by a shell command or an edit tool. Listing replacements
 *   (`git replace`, `-l` / `--list` with or without a pattern, `--format=…`), reading the grafts file and
 *   `git log --no-replace-objects` stay allowed. The refusal is fixed text: it never repeats the call's values.
 * @business-rule gate-gaps-r3 Task 11, owner pick 2026-11-19 (R-257 gate round 5): replace refs and
 *   grafts rewrite which commits git shows without a ref change, so they can make a rewritten history
 *   pass as the reviewed one. `git update-ref refs/replace/…` stays refused by Task 4.
 * @boundary runToolGate (the gate as the hook calls it), with the plugin's real config/tool-gates.json,
 *   a scratch home and a scratch repo, on darwin and linux.
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
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-replace-graft-')));
/** A scratch home: never the real ~/.oss or ~/.claude. */
const home = path.join(root, 'home');
const repo = path.join(root, 'repo');

beforeAll(() => {
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'f'), 'x\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(toolName: string, toolInput: Record<string, unknown>, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'replace-graft',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: toolInput,
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform },
  );
}

async function allowed(command: string, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call('Bash', { command }, agent, platform);
  expect(result.stderr, command).toBe('');
  expect(result.exitCode, command).toBe(0);
}

async function refused(toolName: string, toolInput: Record<string, unknown>, agent: string | null, platform: NodeJS.Platform): Promise<string> {
  const result = await call(toolName, toolInput, agent, platform);
  expect(result.exitCode, JSON.stringify(toolInput)).toBe(2);
  expect(result.stderr, JSON.stringify(toolInput)).toMatch(/^Refused/);
  return result.stderr;
}

const REFUSED = [
  'git replace HEAD~1 HEAD',
  'git replace -f a b',
  'git replace --force a b',
  'git replace --graft HEAD',
  'git replace -g HEAD',
  'git replace --edit HEAD',
  'git replace -e HEAD',
  'git replace -d x',
  'git replace --delete x',
  'git replace --convert-graft-file',
  'git -c core.pager=cat replace a b',
  'git --no-pager replace -d x',
  'git -C . replace --graft HEAD',
  'echo x > .git/info/grafts',
  'cp f .git/refs/replace/abc',
  // Task 4 guard: update-ref of a replace ref stays refused
  'git update-ref refs/replace/x HEAD',
];

const ALLOWED = [
  'git replace',
  'git replace -l',
  'git replace --list',
  "git replace --list 'a*'",
  'git replace -l --format=medium',
  'git replace --format=short',
  'git log --no-replace-objects',
  'cat .git/info/grafts',
  'ls .git/refs',
];

describe.each(PLATFORMS)('git replace and grafts on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each(REFUSED)('should refuse a call that rewrites which history git shows: %s', async (command) => {
      await refused('Bash', { command }, agent, platform);
    });

    it.each(ALLOWED)('should still allow a read of replacements or grafts: %s', async (command) => {
      await allowed(command, agent, platform);
    });

    it('should refuse a Write to .git/info/grafts', async () => {
      await refused('Write', { file_path: path.join(repo, '.git', 'info', 'grafts'), content: 'a b\n' }, agent, platform);
    });

    it('should not repeat the call\'s values in the refusal', async () => {
      const stderr = await refused('Bash', { command: 'git replace sEcReTvAlUe0123 oThErVaLuE4567' }, agent, platform);
      expect(stderr).not.toContain('sEcReTvAlUe0123');
      expect(stderr).not.toContain('oThErVaLuE4567');
    });
  });
});
