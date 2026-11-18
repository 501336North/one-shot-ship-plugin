/**
 * @behavior The main agent and builders can't write a git ref or a git pointer file through a path
 *   the gate can't read: a write whose target holds an unknown part (a variable or `$(…)`) and whose
 *   readable last part is a protected branch name (from the `protectedBranches` setting), `HEAD`,
 *   `ORIG_HEAD`, `FETCH_HEAD`, `packed-refs`, `commondir` or `gitdir` is refused, whatever its case.
 *   Other names after an unknown part keep their decision.
 * @business-rule hook-env-refs Task 3, user pick "Fix the refs gap now" (2026-11-18): the write-sandbox
 *   acceptance test found `x=${R:-.git/refs/heads}; echo > "$x/main"` allowed.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home; the branch-list row
 *   calls the protected-path rule with its own settings.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { readCommand } from '../../src/tool-gate/command-reader.js';
import { loadSettings, type GateSettings } from '../../src/tool-gate/rule-file.js';
import { checkProtectedPathBash } from '../../src/tool-gate/rules/protected-path.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-refs-gap-')));
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
        session_id: 'refs-gap',
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

const REFS = 'x=${R:-.git/refs/heads}; ';

const REFUSED = [
  `${REFS}echo > "$x/main"`,
  `${REFS}echo > "$x/MAIN"`,
  `${REFS}echo > "$x/master"`,
  'echo > "$d/HEAD"',
  'echo > "$d/head"',
  'cp f "$d/packed-refs"',
  'echo x | tee "$d/ORIG_HEAD"',
];

const REFUSED_GLOB_LOCK_SLASH = [
  `${REFS}echo x > "$x"/mai?`,
  `${REFS}tee "$x"/m[a]in`,
  `${REFS}cp /tmp/a "$x"/mai*`,
  `${REFS}ln -sf /tmp/a "$x"/ORIG_HEA?`,
  `${REFS}echo x > "$x"/main.lock`,
  `${REFS}echo x > "$x"/HEAD.lock`,
  `${REFS}echo x > "$x"/packed-refs.lock`,
  `${REFS}echo x > "$x"/main/`,
  `${REFS}echo x > "$x"/HEAD/`,
];

const REFUSED_WILDCARD_ONLY = [
  `${REFS}tee "$x"/* </dev/null`,
  `${REFS}echo > "$x"/?*`,
  `${REFS}cp /tmp/a "$x"/*`,
  `${REFS}rm "$x"/*`,
  `${REFS}echo x > "$x"/[a-z]*`,
];

const CONTROLS_ALLOWED = [
  `${REFS}echo > "$x/notes.txt"`,
  `${REFS}echo > "$x/mainline.txt"`,
  `${REFS}echo x > "$x"/notes.txt`,
  `${REFS}echo x > "$x"/mainline.txt`,
  `${REFS}echo x > "$x"/*.txt`,
  `${REFS}echo x > "$x"/m*.md`,
  'tee build/* </dev/null',
];
const CONTROLS_REFUSED = ['echo > .git/refs/heads/feature'];

describe.each(AGENTS)('refs gap: %s', (_label, agent) => {
  it.each(REFUSED)('should refuse a git ref or pointer file after an unknown part: %s', async (command) => {
    await refused(command, agent);
  });

  it.each(REFUSED_GLOB_LOCK_SLASH)('should refuse a ref name written as a glob, with .lock or a trailing slash: %s', async (command) => {
    await refused(command, agent);
  });

  it.each(REFUSED_WILDCARD_ONLY)('should refuse a wildcard-only last part, which matches every ref name: %s', async (command) => {
    await refused(command, agent);
  });

  it.each(CONTROLS_ALLOWED)('should still allow another name after an unknown part: %s', async (command) => {
    await allowed(command, agent);
  });

  it.each(CONTROLS_REFUSED)('should still refuse a literal ref path: %s', async (command) => {
    await refused(command, agent);
  });
});

describe('refs gap: the branch names come from the protectedBranches setting', () => {
  const base: GateSettings = loadSettings(
    (p) => (p.startsWith(PLUGIN_ROOT) ? fs.readFileSync(p, 'utf8') : null),
    PLUGIN_ROOT,
    '/work/repo',
  ).settings;
  const settings: GateSettings = { ...base, protectedBranches: ['main', 'release'] };

  it('should refuse a configured branch name after an unknown part', () => {
    const facts = readCommand(`${REFS}echo > "$x/release"`, '/work/repo', '/home/dev', false, undefined, undefined, undefined, true);
    if ('unreadable' in facts) throw new Error('expected a readable command');
    const refusal = facts.parts
      .map((part) => checkProtectedPathBash(part, settings, '/work/repo', '/home/dev', { realpath: (p: string) => p }))
      .find((r) => r !== null) ?? null;
    expect(refusal?.rule).toBe('protected-path');
  });
});
