/**
 * @behavior The main agent and builders can't rewrite, add to or erase an agent transcript: a session
 *   `.jsonl` file under `~/.claude/projects/<project>/`, a session's `subagents/` or `tool-results/`
 *   folder, or anything in one, by a shell write (`>>`, `cp`, `mv`, `rm`, `ln -s`, `mkdir`) or by an edit
 *   tool, however home is spelled (`~`, `$HOME`, `"$HOME"`, or a `cd` into the folder). The agent's
 *   memory folder (`~/.claude/projects/<project>/memory/`) stays writable, and transcripts stay readable.
 * @business-rule gate-gaps-r3 Task 9 (R-266), owner round-4 pick "Transcripts only": the session .jsonl
 *   files, subagents/ and tool-results/ are protected; memory/ stays writable. Task 9 picks (2026-11-19):
 *   the subagents/ and tool-results/ folders themselves are protected too, so they can't be made,
 *   removed or replaced by a symlink.
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

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-transcripts-protected-')));
/** A scratch home: never the real ~/.claude. */
const home = path.join(root, 'home');
const repo = path.join(root, 'repo');
const project = path.join(home, '.claude', 'projects', 'p');
const transcript = path.join(project, 's.jsonl');
const subagentTranscript = path.join(project, 's', 'subagents', 'a.jsonl');
const memoryFile = path.join(project, 'memory', 'm.md');

beforeAll(() => {
  fs.mkdirSync(path.dirname(subagentTranscript), { recursive: true });
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.writeFileSync(transcript, '{}\n');
  fs.writeFileSync(subagentTranscript, '{}\n');
  fs.writeFileSync(memoryFile, 'old\n');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(toolName: string, toolInput: Record<string, unknown>, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'transcripts-protected',
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

async function allowed(toolName: string, toolInput: Record<string, unknown>, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(toolName, toolInput, agent, platform);
  expect(result.stderr, JSON.stringify(toolInput)).toBe('');
  expect(result.exitCode, JSON.stringify(toolInput)).toBe(0);
}

async function refused(toolName: string, toolInput: Record<string, unknown>, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(toolName, toolInput, agent, platform);
  expect(result.exitCode, JSON.stringify(toolInput)).toBe(2);
  expect(result.stderr, JSON.stringify(toolInput)).toMatch(/^Refused/);
}

const REFUSED = [
  'printf x >> ~/.claude/projects/p/s.jsonl',
  'mkdir -p ~/.claude/projects/p/s/subagents',
  'ln -s /tmp/x ~/.claude/projects/p/s/subagents/a.jsonl',
  'cp f ~/.claude/projects/p/s.jsonl',
  'rm ~/.claude/projects/p/s.jsonl',
  'mv a ~/.claude/projects/p/s/tool-results/x',
  'printf x >> $HOME/.claude/projects/p/s.jsonl',
  'rm "$HOME"/.claude/projects/p/s.jsonl',
  'cp f "$HOME"/.claude/projects/p/s/tool-results/x',
  'cd ~/.claude/projects/p && rm s.jsonl',
  // Task 9 picks: the subagents/ and tool-results/ folders themselves can't be made, removed or replaced
  'mkdir ~/.claude/projects/p/s/tool-results',
  'rmdir ~/.claude/projects/p/s/subagents',
  'ln -s /tmp/x ~/.claude/projects/p/s/subagents',
];

const ALLOWED = [
  'printf x > ~/.claude/projects/p/memory/m.md',
  'mkdir -p ~/.claude/projects/p/memory',
  'cat ~/.claude/projects/p/s.jsonl',
  'ls ~/.claude/projects/p',
  'tail -n 5 ~/.claude/projects/p/s.jsonl',
  'grep x ~/.claude/projects/p/s.jsonl',
];

describe.each(PLATFORMS)('agent transcripts on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each(REFUSED)('should refuse a shell write to a transcript: %s', async (command) => {
      await refused('Bash', { command }, agent, platform);
    });

    it.each(ALLOWED)('should still allow a memory write or a transcript read: %s', async (command) => {
      await allowed('Bash', { command }, agent, platform);
    });

    it('should refuse a Write to a session transcript', async () => {
      await refused('Write', { file_path: transcript, content: '{"forged":true}\n' }, agent, platform);
    });

    it('should refuse an Edit of a subagent transcript', async () => {
      await refused('Edit', { file_path: subagentTranscript, old_string: '{}', new_string: '{"forged":true}' }, agent, platform);
    });

    it('should still allow a Write to a memory file', async () => {
      await allowed('Write', { file_path: memoryFile, content: 'new\n' }, agent, platform);
    });

    it('should still allow an Edit of a memory file', async () => {
      await allowed('Edit', { file_path: memoryFile, old_string: 'old', new_string: 'new' }, agent, platform);
    });
  });
});
