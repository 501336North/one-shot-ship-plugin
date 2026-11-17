/**
 * @behavior Round 14 (part A) fixes to the mount backstop for review agents:
 *   - SEC CRITICAL-1: the places a mount voids a review also cover the places a mount could hide to
 *     turn the gate off: ~/.claude, ~/.oss and the plugin root in use; and they are checked on every
 *     review pre call (Read, Grep, Glob, Bash), not only after a Bash call. A new mount there refuses
 *     the call and voids the run.
 *   - D-R14-1 "Record on Linux only": on macOS there is no baseline: any mount at or under a watched
 *     place voids the run. On Linux the baseline stays, compared as a multiset of (device, mount
 *     point) entries (CR LOW-4 / SEC LOW-1): a mount stacked on a baseline path, or a baseline mount
 *     that disappeared, voids it too.
 *   - CR LOW-2: the table is read before the decision's deadline starts, so a slow read (1.2 s) is
 *     still judged on the mounts, never voided as out of time.
 *   - CR INFO-1: the project folder counts only when it is a repo top folder (or a mount sits on it),
 *     so a mount beside the repo in a plain parent folder does not void the review.
 * @business-rule R-266: a review agent may not change what it judges, nor turn the gate off; when the
 *   gate can't tell whether it did, the review is void.
 * @boundary runToolGate (gate.ts) with review-agent hook inputs; the mount table (an OS boundary) and
 *   the platform are swapped through the `mounts` and `platform` seams. HOME is the test run's temp home.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateDeps, type GateRequest, type GateResult } from '../../../src/tool-gate/gate.js';
import { removeInScratchHome } from '../../helpers/scratch-home.js';
import { type MountEntry } from '../../../src/tool-gate/mounts.js';
import { type GitRun } from '../../../src/tool-gate/nested-repos.js';
import { hasMark, sessionFolder } from '../../../src/gate-run/run-store.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const REVIEWER = 'oss:code-reviewer';
const SESSION = `r14a-${process.pid}`;
let root: string;
let userTemp: string;

const m = (at: string, device = 'disk9'): MountEntry => ({ device, at });

function request(mode: 'pre' | 'post', cwd: string, tool: string, input: Record<string, unknown>, agentId: string, projectDir = cwd): GateRequest {
  return {
    mode,
    input: JSON.stringify({
      session_id: SESSION,
      cwd,
      hook_event_name: mode === 'pre' ? 'PreToolUse' : 'PostToolUse',
      tool_name: tool,
      tool_input: input,
      ...(mode === 'post' ? { tool_response: { stdout: '' } } : {}),
      agent_type: REVIEWER,
      agent_id: agentId,
    }),
    env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: projectDir, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
    hookEnv: { PATH: '/usr/bin:/bin', HOME },
    bundleRoot: PLUGIN_ROOT,
  };
}

function gate(mode: 'pre' | 'post', cwd: string, tool: string, input: Record<string, unknown>, agentId: string, deps: Partial<GateDeps> = {}, projectDir = cwd): Promise<GateResult> {
  const req = request(mode, cwd, tool, input, agentId, projectDir);
  // a test that gives the sandbox's self-test turns the review sandbox on
  const env = deps.sandbox?.run === undefined ? req.env : { ...req.env, OSS_TOOL_GATE_SANDBOX: undefined };
  return runToolGate({ ...req, env }, { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] }, ...deps });
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r14a-')));
  userTemp = path.join(root, 'T');
  fs.mkdirSync(userTemp, { mode: 0o700 });
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  // Only ever inside the test run's temp HOME: if setup failed and HOME is the real home, this throws and deletes nothing.
  removeInScratchHome(HOME, 'dev');
  removeInScratchHome(HOME, '.oss');
});

describe('SEC CRITICAL-1: a mount over the gate itself voids the review, on pre calls too', () => {
  it.each<[string, () => string]>([
    ['~/.claude/plugins', () => path.join(HOME, '.claude', 'plugins')],
    ['~/.claude (settings)', () => path.join(HOME, '.claude')],
    ['~/.oss/hooks', () => path.join(HOME, '.oss', 'hooks')],
    ['the plugin root in use', () => path.join(PLUGIN_ROOT, 'hooks')],
  ])('a mount at %s: the pre call is refused and the run voided', async (what, at) => {
    const repo = newRepo(`gate-${what.length}`);
    const agent = `agent-gate-${what.length}`;
    const result = await gate('pre', repo, 'Read', readCall(repo), agent, { mounts: () => [m('/'), m(at())] });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('mounted');
    expect(hasMark(HOME, SESSION, agent, 'tamper')).toBe(true);
  });

  it.each<[string, (repo: string) => Record<string, unknown>]>([
    ['Read', (repo) => readCall(repo)],
    ['Grep', (repo) => ({ pattern: 'x', path: repo })],
    ['Glob', (repo) => ({ pattern: '*', path: repo })],
    ['Bash', () => ({ command: 'ls' })],
  ])('a %s pre call with a new mount over the repo .git/hooks: refused, voided', async (tool, input) => {
    const repo = newRepo(`pre-${tool}`);
    const agent = `agent-pre-${tool}`;
    const result = await gate('pre', repo, tool, input(repo), agent, { mounts: () => [m('/'), m(path.join(repo, '.git', 'hooks'))] });
    expect(result.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, agent, 'tamper')).toBe(true);
  });
});

describe('D-R14-1: on macOS there is no baseline', () => {
  it('a pre call writes no baseline file', async () => {
    const repo = newRepo('mac-nofile');
    const result = await gate('pre', repo, 'Read', readCall(repo), 'agent-mac-nofile', { mounts: () => [m('/')] });
    expect(result.exitCode, result.stderr).toBe(0);
    const files = fs.existsSync(sessionFolder(HOME, SESSION)) ? fs.readdirSync(sessionFolder(HOME, SESSION)) : [];
    expect(files.filter((name) => name.startsWith('agent-mac-nofile.mounts'))).toEqual([]);
  });

  it('a mount at the repo root that was there from the first call: refused and voided (accepted catch)', async () => {
    const repo = newRepo('mac-root');
    const table = (): MountEntry[] => [m('/'), m(repo)];
    const first = await gate('pre', repo, 'Read', readCall(repo), 'agent-mac-root', { mounts: table });
    expect(first.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-mac-root', 'tamper')).toBe(true);
  });

  it('mounts elsewhere on the machine: passes, pre and post', async () => {
    const repo = newRepo('mac-elsewhere');
    const table = (): MountEntry[] => [m('/'), m('/System/Volumes/Data'), m('/Volumes/Backup'), m('/dev', 'devfs')];
    expect((await gate('pre', repo, 'Read', readCall(repo), 'agent-mac-else', { mounts: table })).exitCode).toBe(0);
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-mac-else', { mounts: table });
    expect(post.exitCode, post.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-mac-else', 'tamper')).toBe(false);
  });

  it('a post call with no pre call before it is judged on the mounts alone: passes', async () => {
    const repo = newRepo('mac-post-only');
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-mac-post', { mounts: () => [m('/')] });
    expect(post.exitCode, post.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-mac-post', 'tamper')).toBe(false);
  });
});

describe('CR LOW-4 / SEC LOW-1: on Linux the baseline is a multiset of (device, mount point)', () => {
  const linux = (mounts: () => MountEntry[]): Partial<GateDeps> => ({ platform: 'linux', mounts });

  it('a baseline mount at the repo root, unchanged: passes (dev containers)', async () => {
    const repo = newRepo('lx-same');
    const table = (): MountEntry[] => [m('/', 'overlay'), m(repo, 'vda1')];
    expect((await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-same', linux(table))).exitCode).toBe(0);
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-lx-same', linux(table));
    expect(post.exitCode, post.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-lx-same', 'tamper')).toBe(false);
  });

  it('a mount stacked on the baseline repo-root mount: voided', async () => {
    const repo = newRepo('lx-stacked');
    await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-stacked', linux(() => [m('/', 'overlay'), m(repo, 'vda1')]));
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-lx-stacked', linux(() => [m('/', 'overlay'), m(repo, 'vda1'), m(repo, 'tmpfs')]));
    expect(post.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-lx-stacked', 'tamper')).toBe(true);
  });

  it('the repo-root mount replaced by another device at the same path: voided', async () => {
    const repo = newRepo('lx-swapped');
    await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-swapped', linux(() => [m('/', 'overlay'), m(repo, 'vda1')]));
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-lx-swapped', linux(() => [m('/', 'overlay'), m(repo, 'tmpfs')]));
    expect(post.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-lx-swapped', 'tamper')).toBe(true);
  });

  it('a baseline mount under the repo that disappeared: voided', async () => {
    const repo = newRepo('lx-gone');
    const hooks = path.join(repo, '.git', 'hooks');
    await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-gone', linux(() => [m('/', 'overlay'), m(hooks, 'vdb1')]));
    const post = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-lx-gone', linux(() => [m('/', 'overlay')]));
    expect(post.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-lx-gone', 'tamper')).toBe(true);
  });

  it('a new mount under ~/.claude after the baseline: the next pre call is refused, voided', async () => {
    const repo = newRepo('lx-claude');
    await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-claude', linux(() => [m('/', 'overlay')]));
    const next = await gate('pre', repo, 'Read', readCall(repo), 'agent-lx-claude', linux(() => [m('/', 'overlay'), m(path.join(HOME, '.claude', 'plugins'), 'tmpfs')]));
    expect(next.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-lx-claude', 'tamper')).toBe(true);
  });
});

describe('CR LOW-2: the mount table is read before the decision deadline starts', () => {
  /** A command whose post-call work takes many steps, each of which looks at the deadline. */
  const busy = { command: `echo ${Array.from({ length: 3000 }, (_v, i) => `w${i}`).join(' ')} > out.txt` };

  it('a 1.2 s read with nothing mounted there: judged on the mounts, passes, not voided', async () => {
    const repo = newRepo('slow-read-clean');
    expect((await gate('pre', repo, 'Read', readCall(repo), 'agent-slow-clean', { mounts: () => [m('/')] })).exitCode).toBe(0);
    let now = 0;
    const slow = (): MountEntry[] => {
      now += 1200;
      return [m('/')];
    };
    const post = await gate('post', repo, 'Bash', busy, 'agent-slow-clean', { mounts: slow, clock: () => now });
    expect(post.exitCode, post.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-slow-clean', 'tamper')).toBe(false);
  });

  it('a 1.2 s read with a new mount: refused for the mount, not for the time', async () => {
    const repo = newRepo('slow-read-mounted');
    expect((await gate('pre', repo, 'Read', readCall(repo), 'agent-slow-mounted', { mounts: () => [m('/')] })).exitCode).toBe(0);
    let now = 0;
    const slow = (): MountEntry[] => {
      now += 1200;
      return [m('/'), m(path.join(repo, '.git', 'hooks'))];
    };
    const post = await gate('post', repo, 'Bash', busy, 'agent-slow-mounted', { mounts: slow, clock: () => now });
    expect(post.exitCode).toBe(2);
    expect(post.stderr).toContain('mounted');
  });
});

describe('CR INFO-1: a project folder that is not a repo top does not count', () => {
  it('a mount beside the repo in its plain parent folder: passes', async () => {
    const parent = path.join(HOME, 'dev', 'plain-parent');
    fs.mkdirSync(parent, { recursive: true });
    const repo = path.join(parent, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    const real = fs.realpathSync(repo);
    const first = await gate('pre', real, 'Read', readCall(real), 'agent-plain-parent', { mounts: () => [m('/')] }, fs.realpathSync(parent));
    expect(first.exitCode, first.stderr).toBe(0);
    const table = (): MountEntry[] => [m('/'), m(path.join(fs.realpathSync(parent), 'other-volume'))];
    const result = await gate('post', real, 'Bash', { command: 'ls' }, 'agent-plain-parent', { mounts: table }, fs.realpathSync(parent));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-plain-parent', 'tamper')).toBe(false);
  });
});

describe('D-R14-2: a nested-repo check that runs out of time says how to retry', () => {
  const timedOut: GitRun = () => ({ status: null, stdout: '', timedOut: true });

  it.each<[string, (repo: string) => Record<string, unknown>]>([
    ['Read', (repo) => readCall(repo)],
    ['Bash', () => ({ command: 'ls' })],
  ])('a %s call: retry on its own or with fewer calls at once; no sandbox-exec advice', async (tool, input) => {
    const repo = newRepo(`git-timeout-${tool}`);
    const result = await gate('pre', repo, tool, input(repo), `agent-git-timeout-${tool}`, {
      mounts: () => [m('/')],
      nestedGit: timedOut,
      sandbox: { userTemp, settingsHomes: [HOME], run: () => true },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('the nested-repo check timed out');
    expect(result.stderr).toContain('retry this call on its own, or with fewer calls at once');
    expect(result.stderr).not.toContain('sandbox-exec');
  });
});
