/**
 * @behavior The main agent and builders can't write a git ref or a git pointer file through a path
 *   the gate can't read: a write whose target holds an unknown part (a variable or `$(…)`) and whose
 *   readable last part is a protected branch name (from the `protectedBranches` setting), `HEAD`,
 *   `ORIG_HEAD`, `FETCH_HEAD`, `packed-refs`, `commondir`, `gitdir`, `grafts`, `alternates` or `shallow`
 *   is refused, whatever its case (`grafts`, `alternates`, `shallow`: Task 11).
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

// Task 11: grafts, alternates and shallow change which commits the repo sees
const GIT = 'x=${R:-.git}; ';
const REFUSED_MORE_POINTERS = [
  `${GIT}echo > "$x"/info/grafts`,
  `${GIT}echo > "$x"/objects/info/alternates`,
  `${GIT}echo > "$x"/shallow`,
  `${GIT}tee "$x"/SHALLOW`,
  `${GIT}cp /tmp/a "$x"/info/graft?`,
];
const CONTROLS_MORE_POINTERS = [
  `${GIT}echo > "$x"/notes.txt`,
  `${GIT}echo > "$x"/shallow-copy.md`,
  `${GIT}echo > "$x"/alternatives.txt`,
];

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

  it.each(REFUSED_MORE_POINTERS)('should refuse grafts, alternates or shallow after an unknown part: %s', async (command) => {
    await refused(command, agent);
  });

  it.each(CONTROLS_MORE_POINTERS)('should still allow a name that only starts like one of them: %s', async (command) => {
    await allowed(command, agent);
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

/**
 * gate-gaps-r3 Task 4 (narrow #4, owner pick "Keep all three", 2026-11-19): git's ref history (the
 * reflogs a lost commit is found by) and raw ref writes can't be rewritten or erased. Every
 * `git update-ref`, every `git reflog expire|delete`, a setting that stops or expires reflogs
 * (`core.logAllRefUpdates`, `core.bare`, `gc.reflogExpire*`) through any config path, and writes
 * under a reflog folder are refused. Everyday fetch, push, pull, gc and reflog reads stay allowed.
 */
const REF_HISTORY_REFUSED = [
  // every update-ref, whatever the ref
  'git update-ref refs/remotes/origin/x HEAD',
  'git update-ref refs/heads/feature HEAD',
  'git update-ref -d refs/tags/v1',
  'git update-ref HEAD HEAD~1',
  'git update-ref --stdin',
  // reflog settings, whatever the value, through every config path
  'git -c core.logAllRefUpdates=false commit -m x',
  'git -c core.logAllRefUpdates=0 commit -m x',
  'git -c core.logAllRefUpdates=no commit -m x',
  'git -c core.logAllRefUpdates=off commit -m x',
  'git -c core.logAllRefUpdates= commit -m x',
  'git -c CORE.LOGALLREFUPDATES=true commit -m x',
  'git --config-env=core.logAllRefUpdates=V commit -m x',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.logAllRefUpdates GIT_CONFIG_VALUE_0=false git commit -m x',
  'git config core.logAllRefUpdates false',
  'git config set core.logAllRefUpdates false',
  'git -c core.bare=true status',
  'git config core.bare true',
  'git -c gc.reflogExpire=now gc',
  'git -c gc.reflogExpireUnreachable=now gc',
  'git -c GC.ReflogExpire=0 gc',
  'git -c gc.refs/heads/*.reflogExpire=now gc',
  'git config gc.reflogExpire now',
  'git config --global gc.reflogExpireUnreachable now',
  // every reflog expire or delete
  'git reflog expire --expire=now HEAD',
  'git reflog expire --expire=now refs/heads/feat/x',
  'git reflog delete HEAD@{1}',
  // owner pick 2026-11-19 ("Refuse them in Task 4"): drop erases a whole reflog, write forges an entry
  'git reflog drop HEAD',
  'git reflog drop --all',
  'git reflog write refs/heads/feat/x 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 msg',
  // writes under a reflog folder
  'echo x > .git/logs/HEAD',
  'rm -rf .git/logs',
  'cp f .git/logs/refs/heads/main',
  'echo x > .git/worktrees/w/logs/HEAD',
  'echo x > .git/modules/sub/logs/HEAD',
  'echo x > .git/reftable/tables.list',
  // a link made in the same call to a reflog folder
  'ln -s .git/logs L && rm -rf L/',
];

const REF_HISTORY_ALLOWED = [
  'git fetch origin',
  'git push -u origin feat/x',
  'git pull',
  'git log -g',
  'git reflog',
  'git reflog show HEAD',
  'git gc',
  'cat .git/logs/HEAD',
  'git config --get core.logAllRefUpdates',
  'git config core.logAllRefUpdates',
];

describe.each(AGENTS)('ref history (gate-gaps-r3 Task 4): %s', (_label, agent) => {
  it.each(REF_HISTORY_REFUSED)('should refuse a raw ref write or a change to ref history: %s', async (command) => {
    await refused(command, agent);
  });

  it.each(REF_HISTORY_ALLOWED)('should still allow everyday git and reflog reads: %s', async (command) => {
    await allowed(command, agent);
  });
});

describe('ref history (gate-gaps-r3 Task 4): the refusal does not repeat the value it was given', () => {
  it.each([
    'git update-ref refs/heads/VALUE-7f3 HEAD',
    'git -c core.logAllRefUpdates=VALUE-7f3 commit -m x',
    'git config gc.reflogExpire VALUE-7f3',
    'git reflog expire --expire=VALUE-7f3 HEAD',
    'git reflog write refs/heads/x 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 VALUE-7f3',
  ])('should refuse without echoing the value: %s', async (command) => {
    const result = await call(command, null);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).not.toContain('VALUE-7f3');
  });

  it.each([
    'git -c core.logAllRefUpdates=VALUE-7f3 commit -m x',
    'git -c gc.reflogExpire=VALUE-7f3 gc',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.bare GIT_CONFIG_VALUE_0=VALUE-7f3 git status',
    'git config core.logAllRefUpdates VALUE-7f3',
    'git config --global gc.reflogExpireUnreachable VALUE-7f3',
  ])('should say a ref-history setting changes or erases ref history, not that it runs a program or moves pushes: %s', async (command) => {
    const result = await call(command, null);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/ref history/);
    expect(result.stderr, command).not.toMatch(/run a hook|changes where pushes go/);
    expect(result.stderr, command).not.toContain('VALUE-7f3');
  });
});
