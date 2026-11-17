/**
 * @behavior Round 15 (part A) fixes to the mount backstop for review agents:
 *   - CR L3: a file system mounted over a folder ABOVE a watched place (the reviewed repo, the agent's
 *     private folder, ~/.claude, ~/.oss, the plugin root) hides it as surely as one at or under it.
 *     - Linux only (D-R15-2): the folders above are compared against the agent's baseline, like the
 *       ones at or under.
 *     - macOS keeps no baseline (ADR-043), so a mount above is not checked there (accepted limit:
 *       the review sandbox's mount deny is the defence); at or under still voids.
 *   - CR I3 / PERF INFO-2: the mount table read has its own cap (1.2 s), so the read, the decision and
 *     node's start fit under the CLI's 2.5 s hard limit; a read past the cap counts as unreadable.
 *   - CR L2: the baseline is said to live under ~/.oss/gate-state, where it is.
 * @business-rule R-266: a review whose code (or the gate itself) may have been swapped is void.
 * @boundary runToolGate (gate.ts) with review-agent hook inputs; the mount table (an OS boundary), the
 *   platform and the clock are swapped through the `mounts`, `platform` and `clock` seams. The pure
 *   ancestor rule (mounts.ts) is checked on its own.
 *   HOME is the test run's temp home.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateDeps, type GateRequest, type GateResult } from '../../../src/tool-gate/gate.js';
import { removeInScratchHome } from '../../helpers/scratch-home.js';
import { mountedAbove, type MountEntry } from '../../../src/tool-gate/mounts.js';
import { hasMark } from '../../../src/gate-run/run-store.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const REVIEWER = 'oss:code-reviewer';
const SESSION = `r15a-${process.pid}`;
let root: string;
let userTemp: string;

const m = (at: string, device = 'disk9'): MountEntry => ({ device, at });

function request(mode: 'pre' | 'post', cwd: string, tool: string, input: Record<string, unknown>, agentId: string, session = SESSION): GateRequest {
  return {
    mode,
    input: JSON.stringify({
      session_id: session,
      cwd,
      hook_event_name: mode === 'pre' ? 'PreToolUse' : 'PostToolUse',
      tool_name: tool,
      tool_input: input,
      ...(mode === 'post' ? { tool_response: { stdout: '' } } : {}),
      agent_type: REVIEWER,
      agent_id: agentId,
    }),
    env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
    hookEnv: { PATH: '/usr/bin:/bin', HOME },
    bundleRoot: PLUGIN_ROOT,
  };
}

function gate(mode: 'pre' | 'post', cwd: string, tool: string, input: Record<string, unknown>, agentId: string, deps: Partial<GateDeps> = {}, session = SESSION): Promise<GateResult> {
  return runToolGate(request(mode, cwd, tool, input, agentId, session), { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] }, ...deps });
}

function newRepo(name: string): string {
  const repo = path.join(HOME, 'dev', name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
  return fs.realpathSync(repo);
}

const readCall = (repo: string): Record<string, unknown> => ({ file_path: path.join(repo, 'README.md') });

beforeAll(() => {
  if (!path.basename(HOME).startsWith('oss-test-home-')) throw new Error("expected the test run's temp HOME");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r15a-')));
  userTemp = path.join(root, 'T');
  fs.mkdirSync(userTemp, { mode: 0o700 });
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  // Only ever inside the test run's temp HOME: if setup failed and HOME is the real home, this throws and deletes nothing.
  removeInScratchHome(HOME, 'dev');
  removeInScratchHome(HOME, '.oss');
});

describe('D-R15-2: on macOS a mount above a watched place does not void the review (accepted limit)', () => {
  it.each<[string, (repo: string) => string]>([
    ['a custom volume holding the repo (~/dev/ws)', (repo) => path.dirname(repo)],
    ['HOME (above ~/.oss and ~/.claude)', () => fs.realpathSync(HOME)],
    ['the folder holding the plugin root', () => path.dirname(PLUGIN_ROOT)],
  ])('a mount at %s, there before the review or new: passes, pre and post, not voided', async (what, at) => {
    const repo = newRepo(path.join('ws', `above-${what.length}`));
    const agent = `agent-above-${what.length}`;
    const table = (): MountEntry[] => [m('/'), m('/System/Volumes/Data'), m(at(repo))];
    const pre = await gate('pre', repo, 'Read', readCall(repo), agent, { mounts: table });
    expect(pre.exitCode, pre.stderr).toBe(0);
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, agent, { mounts: table });
    expect(post.exitCode, post.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, agent, 'tamper')).toBe(false);
  });

  it('a new mount stacked on a /Volumes root: passes', async () => {
    const repo = newRepo('mac-stacked');
    const result = await gate('pre', repo, 'Read', readCall(repo), 'agent-mac-stacked', { mounts: () => [m('/'), m('/Volumes/Work', 'disk4s1'), m('/Volumes/Work', 'disk7s1')] });
    expect(result.exitCode, result.stderr).toBe(0);
  });

  it('a mount at or under the repo still voids, and the reason does not say "above"', async () => {
    const repo = newRepo('mac-under');
    const result = await gate('pre', repo, 'Read', readCall(repo), 'agent-mac-under', { mounts: () => [m('/'), m(path.join(repo, '.git', 'hooks'))] });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('mounted or unmounted at or under');
    expect(result.stderr).not.toContain('above');
    expect(hasMark(HOME, SESSION, 'agent-mac-under', 'tamper')).toBe(true);
  });
});

describe('CR L3: the ancestor rule (mounts.ts), used on Linux', () => {
  it('every mount strictly above a place counts (the caller passes only the change from the baseline)', () => {
    expect(mountedAbove([m('/', 'overlay'), m('/workspaces', 'vda1')], ['/workspaces/repo'])).toEqual([m('/', 'overlay'), m('/workspaces', 'vda1')]);
  });

  it('a mount at or under a place, or beside it, is not "above" (mountedAtOrUnder judges those)', () => {
    expect(mountedAbove([m('/workspaces/repo'), m('/workspaces/repo/.git/hooks'), m('/workspaces/other')], ['/workspaces/repo'])).toEqual([]);
  });
});

describe('CR L3: on Linux the folders above are compared against the baseline', () => {
  const linux = (mounts: () => MountEntry[]): Partial<GateDeps> => ({ platform: 'linux', mounts });

  it('a baseline mount above the repo (a dev container workspace), unchanged: passes', async () => {
    const repo = newRepo('lx-above-same');
    const table = (): MountEntry[] => [m('/', 'overlay'), m(path.dirname(repo), 'vda1')];
    expect((await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-above-same', linux(table))).exitCode).toBe(0);
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-lx-above-same', linux(table));
    expect(post.exitCode, post.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-lx-above-same', 'tamper')).toBe(false);
  });

  it('a mount above the repo added after the baseline: voided', async () => {
    const repo = newRepo('lx-above-new');
    await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-above-new', linux(() => [m('/', 'overlay')]));
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-lx-above-new', linux(() => [m('/', 'overlay'), m(path.dirname(repo), 'tmpfs')]));
    expect(post.exitCode).toBe(2);
    expect(post.stderr).toContain('at, under or above');
    expect(hasMark(HOME, SESSION, 'agent-lx-above-new', 'tamper')).toBe(true);
  });

  it('a baseline mount above the repo that disappeared: voided', async () => {
    const repo = newRepo('lx-above-gone');
    await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-above-gone', linux(() => [m('/', 'overlay'), m(path.dirname(repo), 'vda1')]));
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-lx-above-gone', linux(() => [m('/', 'overlay')]));
    expect(post.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-lx-above-gone', 'tamper')).toBe(true);
  });

  it("CR L2: a baseline that can't be recorded is said to belong under ~/.oss/gate-state", async () => {
    const repo = newRepo('lx-no-record');
    const session = `${SESSION}-blocked`;
    fs.mkdirSync(path.join(HOME, '.oss', 'gate-state'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(HOME, '.oss', 'gate-state', session), 'not a folder');
    const result = await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-no-record', linux(() => [m('/', 'overlay')]), session);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('~/.oss/gate-state');
    expect(result.stderr).not.toContain('~/.oss/run');
  });
});

describe('CR I3 / PERF INFO-2: the mount table read is capped so the whole call fits under the hard limit', () => {
  it('a read that takes longer than its 1.2 s cap counts as unreadable: the pre call is refused (try again)', async () => {
    const repo = newRepo('slow-read-capped');
    let now = 0;
    const slow = (): MountEntry[] => {
      now += 1300;
      return [m('/')];
    };
    const result = await gate('pre', repo, 'Read', readCall(repo), 'agent-slow-capped', { mounts: slow, clock: () => now });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("couldn't read the mount table");
  });

  it('a read past its cap after a Bash call voids the run', async () => {
    const repo = newRepo('slow-read-capped-post');
    let now = 0;
    const slow = (): MountEntry[] => {
      now += 1300;
      return [m('/')];
    };
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-slow-capped-post', { mounts: slow, clock: () => now });
    expect(post.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-slow-capped-post', 'tamper')).toBe(true);
  });

  it('a read within its cap is judged on the mounts: passes', async () => {
    const repo = newRepo('slow-read-in-cap');
    let now = 0;
    const slow = (): MountEntry[] => {
      now += 1100;
      return [m('/')];
    };
    const result = await gate('pre', repo, 'Read', readCall(repo), 'agent-slow-in-cap', { mounts: slow, clock: () => now });
    expect(result.exitCode, result.stderr).toBe(0);
  });
});
