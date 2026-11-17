/**
 * @behavior Round 13 (part A) fixes for review agents:
 *   - D-R13-1 "Drop cache, accept slow": the nested-repo answer is never kept; git is asked on every
 *     review call, so a repo cloned into an existing untracked folder after a first check is hidden
 *     on the next call.
 *   - PERF LOW-2 / CR L-c / SEC INFO-2, the mount backstop: after a review agent's Bash call the mount
 *     table is read first, on its own time limit, so a slow nested-repo check can't use up the time
 *     it needs; a table that can't be read voids the review; a NEW mount exactly AT the reviewed
 *     repo's root or the agent's private folder voids it, as one under them does.
 *   - D-R13-2 "Void only new mounts": the agent's first pre call records the mount table once (its
 *     baseline, write-once); only mounts not in it void the run, so a repo root that was already a
 *     mount point (a dev container) can still be reviewed. No baseline voids the run; a pre call that
 *     can't read the table is refused.
 *   - SEC INFO-1: the review sandbox denies running the file-system tools in /Library/Filesystems.
 * @business-rule R-266: a review agent may read what it reviews, nothing beyond it, and may not
 *   change what it judges; when the gate can't tell whether it did, the review is void.
 * @boundary runToolGate (gate.ts) with review-agent hook inputs; the mount table (an OS boundary)
 *   is swapped through the `mounts` seam for the unreadable-table cases, and is the real one (real
 *   hdiutil mounts, detached in afterAll) for the others. HOME is the test run's own temp home.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateErrorResult, runToolGate, type GateDeps, type GateRequest, type GateResult } from '../../../src/tool-gate/gate.js';
import { removeInScratchHome } from '../../helpers/scratch-home.js';
import { reviewSandboxProfile } from '../../../src/tool-gate/sandbox.js';
import { mountTable, type MountEntry } from '../../../src/tool-gate/mounts.js';
import { hasMark, sessionFolder } from '../../../src/gate-run/run-store.js';

const ON_MAC = process.platform === 'darwin';
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const REVIEWER = 'oss:code-reviewer';
const SESSION = `r13a-${process.pid}`;
let root: string;
let userTemp: string;

/** A mount table holding these mount points (one device each). */
const mountsAt = (...points: string[]): MountEntry[] => points.map((point) => ({ device: `dev:${point}`, at: point }));
/** Round 14, D-R14-1: the baseline exists on Linux only. */
const LINUX: Partial<GateDeps> = { platform: 'linux' };

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
};

function request(mode: 'pre' | 'post', cwd: string, tool: string, input: Record<string, unknown>, agentId: string): GateRequest {
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
    env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
    hookEnv: { PATH: '/usr/bin:/bin', HOME },
    bundleRoot: PLUGIN_ROOT,
  };
}

function gate(mode: 'pre' | 'post', cwd: string, tool: string, input: Record<string, unknown>, agentId: string, deps: Partial<GateDeps> = {}): Promise<GateResult> {
  return runToolGate(request(mode, cwd, tool, input, agentId), { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] }, ...deps });
}

/** The agent's first pre call: it records the agent's mount baseline. */
async function baseline(repo: string, agentId: string, deps: Partial<GateDeps> = {}): Promise<void> {
  const result = await gate('pre', repo, 'Read', { file_path: path.join(repo, 'README.md') }, agentId, deps);
  expect(result.exitCode, result.stderr).toBe(0);
}

function newRepo(name: string): string {
  const repo = path.join(HOME, 'dev', name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  return repo;
}

beforeAll(() => {
  if (!path.basename(HOME).startsWith('oss-test-home-')) throw new Error("expected the test run's temp HOME");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r13a-')));
  userTemp = path.join(root, 'T');
  fs.mkdirSync(userTemp, { mode: 0o700 });
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  // Only ever inside the test run's temp HOME: if setup failed and HOME is the real home, this throws and deletes nothing.
  removeInScratchHome(HOME, 'dev');
  removeInScratchHome(HOME, '.oss');
});

describe('D-R13-1: the nested-repo check is asked fresh on every call', () => {
  it('hides a repo cloned into an existing untracked folder after a first check', async () => {
    const repo = newRepo('fresh-clone');
    fs.mkdirSync(path.join(repo, 'plain', 'later'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'plain', 'later', 'secret.txt'), 'theirs\n');
    const target = { file_path: path.join(repo, 'plain', 'later', 'secret.txt') };
    const first = await gate('pre', repo, 'Read', target, 'agent-fresh');
    expect(first.exitCode, first.stderr).toBe(0);
    // cloned after the first check: the index, HEAD and the repo's own folder are unchanged
    git(path.join(repo, 'plain', 'later'), 'init', '-q', '-b', 'main');
    const second = await gate('pre', repo, 'Read', target, 'agent-fresh');
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toMatch(/^Refused/);
  });
});

describe('the mount backstop: a mount table that cannot be read voids the review', () => {
  it.each<[string, () => readonly MountEntry[] | null]>([
    ['no table (null)', () => null],
    ['an error reading it', () => {
      throw new Error('mount table unreadable');
    }],
  ])('%s: refused, and the review is voided', async (_what, mounts) => {
    const repo = newRepo(`unreadable-${_what.length}`);
    const agent = `agent-unread-${_what.length}`;
    await baseline(repo, agent, { mounts: () => mountsAt('/') });
    const result = await gate('post', repo, 'Bash', { command: 'ls' }, agent, { mounts });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('mount table');
    expect(hasMark(HOME, SESSION, agent, 'tamper')).toBe(true);
  });

  it('a readable table with nothing mounted there: passes, not voided', async () => {
    const repo = newRepo('readable-empty');
    await baseline(repo, 'agent-readable', { mounts: () => mountsAt('/', '/dev', '/System/Volumes/Data') });
    const result = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-readable', { mounts: () => mountsAt('/', '/dev', '/System/Volumes/Data') });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-readable', 'tamper')).toBe(false);
  });

});

describe('D-R13-2 (Linux only from round 14, D-R14-1): only mounts that are not in the baseline void the review', () => {
  it('a mount at the repo root that was already there when the agent started: not voided (dev containers)', async () => {
    const repo = newRepo('root-in-baseline');
    const table = (): MountEntry[] => mountsAt('/', fs.realpathSync(repo));
    await baseline(repo, 'agent-root-old', { ...LINUX, mounts: table });
    const result = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-root-old', { ...LINUX, mounts: table });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-root-old', 'tamper')).toBe(false);
  });

  it('a new mount exactly at the repo root after the baseline: voided', async () => {
    const repo = newRepo('root-new');
    await baseline(repo, 'agent-root-new', { ...LINUX, mounts: () => mountsAt('/') });
    const result = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-root-new', { ...LINUX, mounts: () => mountsAt('/', fs.realpathSync(repo)) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('mounted');
    expect(hasMark(HOME, SESSION, 'agent-root-new', 'tamper')).toBe(true);
  });

  it('a new mount under the repo after the baseline: voided, even with an old mount at the root', async () => {
    const repo = newRepo('under-new');
    const real = fs.realpathSync(repo);
    await baseline(repo, 'agent-under-new', { ...LINUX, mounts: () => mountsAt('/', real) });
    const result = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-under-new', { ...LINUX, mounts: () => mountsAt('/', real, path.join(real, '.git', 'hooks')) });
    expect(result.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-under-new', 'tamper')).toBe(true);
  });

  it('no baseline (no pre call recorded one): voided', async () => {
    const repo = newRepo('no-baseline');
    const result = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-no-baseline', { ...LINUX, mounts: () => mountsAt('/') });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('baseline');
    expect(hasMark(HOME, SESSION, 'agent-no-baseline', 'tamper')).toBe(true);
  });

  it('an unreadable baseline: voided', async () => {
    const repo = newRepo('bad-baseline');
    await baseline(repo, 'agent-bad-baseline', { ...LINUX, mounts: () => mountsAt('/') });
    const files = fs.readdirSync(sessionFolder(HOME, SESSION)).filter((name) => name.startsWith('agent-bad-baseline.mounts'));
    expect(files.length).toBe(1);
    fs.chmodSync(path.join(sessionFolder(HOME, SESSION), files[0] ?? ''), 0o600);
    fs.writeFileSync(path.join(sessionFolder(HOME, SESSION), files[0] ?? ''), 'not json');
    const result = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-bad-baseline', { ...LINUX, mounts: () => mountsAt('/') });
    expect(result.exitCode).toBe(2);
    expect(hasMark(HOME, SESSION, 'agent-bad-baseline', 'tamper')).toBe(true);
  });

  it('a pre call that cannot read the mount table (no baseline yet) is refused', async () => {
    const repo = newRepo('pre-unreadable');
    const result = await gate('pre', repo, 'Read', { file_path: path.join(repo, 'README.md') }, 'agent-pre-unread', { ...LINUX, mounts: () => null });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('mount table');
  });

  it('parallel first pre calls write exactly one baseline, and the first one wins', async () => {
    const repo = newRepo('parallel');
    const agent = 'agent-parallel';
    await Promise.all(Array.from({ length: 8 }, (_v, i) => gate('pre', repo, 'Read', { file_path: path.join(repo, 'README.md') }, agent, { ...LINUX, mounts: () => mountsAt('/', `/m${i}`) })));
    const files = fs.readdirSync(sessionFolder(HOME, SESSION)).filter((name) => name.startsWith(`${agent}.`));
    expect(files).toEqual([`${agent}.mounts`]);
    // what the post call compares against is one of the tables, whole
    const recorded: unknown = JSON.parse(fs.readFileSync(path.join(sessionFolder(HOME, SESSION), `${agent}.mounts`), 'utf8'));
    expect(Array.isArray(recorded) && recorded.length === 2 && JSON.stringify(recorded[0]) === JSON.stringify({ device: 'dev:/', at: '/' })).toBe(true);
  });

  it('writes the baseline on the first pre call only (cost)', async () => {
    const repo = newRepo('cost');
    let reads = 0;
    const counted = (): MountEntry[] => {
      reads += 1;
      return mountsAt('/');
    };
    for (let i = 0; i < 3; i += 1) await baseline(repo, 'agent-cost', { ...LINUX, mounts: counted });
    // round 14, SEC CRITICAL-1: every pre call reads the table (to compare); the baseline is written once
    expect(reads).toBe(3);
    expect(fs.readdirSync(sessionFolder(HOME, SESSION)).filter((name) => name.startsWith('agent-cost.'))).toEqual(['agent-cost.mounts']);
  });

  it('a post call for a review agent that the gate could not finish in time: voided', () => {
    const repo = newRepo('hard-limit');
    const result = gateErrorResult(request('post', repo, 'Bash', { command: 'ls' }, 'agent-hard-limit'), true);
    expect(result.exitCode).toBe(0);
    expect(hasMark(HOME, SESSION, 'agent-hard-limit', 'tamper')).toBe(true);
  });

  it("a builder's post call the gate could not finish is not a review: nothing is marked", () => {
    const repo = newRepo('hard-limit-builder');
    const req = request('post', repo, 'Bash', { command: 'ls' }, 'agent-builder');
    const builder = { ...req, input: req.input.replace(REVIEWER, 'oss:typescript-pro') };
    gateErrorResult(builder, true);
    expect(hasMark(HOME, SESSION, 'agent-builder', 'tamper')).toBe(false);
  });
});

describe('SEC INFO-1: the file-system tools in /Library/Filesystems do not run in the review sandbox', () => {
  it('denies running anything under /Library/Filesystems, as under /System/Library/Filesystems', () => {
    const profile = reviewSandboxProfile({ homes: ['/Users/x'], privateDir: '/private/var/folders/t/T/oss-review/s/a', repos: [] });
    const execDeny = profile.split('\n').find((line) => line.startsWith('(deny process-exec'));
    expect(execDeny).toContain('(subpath "/Library/Filesystems")');
    expect(execDeny).toContain('(subpath "/System/Library/Filesystems")');
  });
});

/** Unmounts every mount whose line holds the marker, then detaches every device attached from `image`. */
function detachAll(marker: string, image: string): void {
  const table = (): string[] => spawnSync('/sbin/mount', [], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(marker));
  for (let round = 0; round < 3 && table().length > 0; round += 1) {
    for (const line of table()) {
      const at = / on (.+) \(/.exec(line)?.[1];
      const dev = line.split(' ')[0];
      if (at !== undefined) spawnSync('/sbin/umount', ['-f', at], { stdio: 'ignore', timeout: 30_000 });
      if (dev !== undefined) spawnSync('/usr/bin/hdiutil', ['detach', '-force', dev], { stdio: 'ignore', timeout: 30_000 });
    }
  }
  let current = '';
  for (const line of spawnSync('/usr/bin/hdiutil', ['info'], { encoding: 'utf8' }).stdout.split('\n')) {
    const img = /^image-path\s*:\s*(.+)$/.exec(line)?.[1];
    if (img !== undefined) current = img;
    const dev = /^(\/dev\/disk\d+)\s/.exec(line)?.[1];
    if (dev !== undefined && current === image) spawnSync('/usr/bin/hdiutil', ['detach', '-force', dev], { stdio: 'ignore', timeout: 30_000 });
  }
}

describe.runIf(ON_MAC)('the mount backstop with real mounts (macOS)', () => {
  const MARKER = `oss-r13a-post-${process.pid}`;
  let image: string;
  const mounts = (): string[] => execFileSync('/sbin/mount', [], { encoding: 'utf8' }).split('\n').filter((line) => line.includes(MARKER));
  const attach = (at: string): void => {
    execFileSync('/usr/bin/hdiutil', ['attach', '-quiet', '-nobrowse', '-readonly', '-mountpoint', at, image], { timeout: 60_000 });
    expect(mounts().length).toBe(1);
  };

  beforeAll(() => {
    image = path.join(root, 'post.dmg');
    execFileSync('/usr/bin/hdiutil', ['create', '-quiet', '-size', '1m', '-fs', 'HFS+', '-volname', 'ossr13apost', '-layout', 'NONE', image], { timeout: 60_000 });
  }, 120_000);

  afterAll(() => {
    detachAll(MARKER, image);
    expect(mounts()).toEqual([]);
  });

  // round 14, CR LOW-3: around a step the post call really runs (reading the mount table), and the
  // slow read is shown to have run; the post call's own work then runs past the deadline's start
  it('a mount table read that takes 1.2 s is still judged on the real mounts: voided for the mount', async () => {
    const repo = newRepo(`${MARKER}-slow`);
    await baseline(repo, 'agent-slow');
    attach(path.join(repo, '.git', 'hooks'));
    try {
      let now = 0;
      let reads = 0;
      const slow = (): MountEntry[] | null => {
        reads += 1;
        now += 1200;
        return mountTable(process.platform, 30_000);
      };
      const busy = { command: `echo ${Array.from({ length: 3000 }, (_v, i) => `w${i}`).join(' ')} > out.txt` };
      const result = await gate('post', repo, 'Bash', busy, 'agent-slow', { mounts: slow, clock: () => now });
      expect(reads).toBe(1);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('mounted');
      expect(hasMark(HOME, SESSION, 'agent-slow', 'tamper')).toBe(true);
    } finally {
      detachAll(MARKER, image);
    }
  });

  it('a disk image mounted exactly at the reviewed repo root: refused, and the review is voided', async () => {
    const repo = newRepo(`${MARKER}-root`);
    await baseline(repo, 'agent-root');
    attach(repo);
    try {
      const result = await gate('post', repo, 'Bash', { command: 'ls' }, 'agent-root');
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('mounted');
      expect(hasMark(HOME, SESSION, 'agent-root', 'tamper')).toBe(true);
    } finally {
      detachAll(MARKER, image);
    }
  });

  it("a disk image mounted exactly at the agent's private folder: voided", async () => {
    const repo = newRepo(`${MARKER}-own`);
    // the agent id carries the marker, so the mount line does too
    const agent = `${MARKER}-own`;
    const own = path.join(userTemp, 'oss-review', SESSION, agent);
    fs.mkdirSync(own, { recursive: true, mode: 0o700 });
    await baseline(repo, agent);
    attach(own);
    try {
      const result = await gate('post', repo, 'Bash', { command: 'ls' }, agent);
      expect(result.exitCode).toBe(2);
      expect(hasMark(HOME, SESSION, agent, 'tamper')).toBe(true);
    } finally {
      detachAll(MARKER, image);
    }
  });
});
