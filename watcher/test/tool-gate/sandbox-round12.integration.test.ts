/**
 * @behavior Round 12 (part A), SEC CRITICAL-A: a review agent's Bash call can't mount a disk image
 *   (or anything else) over the repo it reviews, e.g. over `.git/hooks`, which would swap the hooks
 *   git runs later for ones the agent chose. The sandbox denies DiskArbitration and running the
 *   mount tools; nothing is left mounted.
 * @business-rule R-266: a review agent may not change what it judges.
 * @boundary /usr/bin/sandbox-exec and /usr/bin/hdiutil, run for real (macOS). The test image is made
 *   OUTSIDE the sandbox in the test's own temp folder; every mount under it is detached in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewContainment, SANDBOX_EXEC, type Containment } from '../../src/tool-gate/sandbox.js';

const ON_MAC = process.platform === 'darwin';
const SESSION = 'sbx-r12';
const MARKER = `oss-r12-mount-${process.pid}`;

let root: string;
let home: string;
let repo: string;
let userTemp: string;
let image: string;

function containment(): Extract<Containment, { kind: 'sandbox' }> {
  const c = reviewContainment({
    platform: 'darwin',
    home,
    sessionId: SESSION,
    agentId: 'agent-a',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home },
    toolInput: {},
    disabled: false,
    userTemp,
    settingsHomes: [home],
  });
  if (c.kind !== 'sandbox') throw new Error(`expected the sandbox, got ${c.kind}`);
  return c;
}

function run(command: string): { status: number | null; out: string } {
  const wrapped = String(containment().wrap(command, [repo]));
  expect(wrapped.startsWith(`${SANDBOX_EXEC} `)).toBe(true);
  const ran = spawnSync('/bin/bash', ['-c', wrapped], { cwd: repo, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

/** The mount table lines under the test's temp folder (the marker is in its name). */
function ourMounts(): string[] {
  const table = spawnSync('/sbin/mount', [], { encoding: 'utf8' }).stdout;
  return table.split('\n').filter((line) => line.includes(MARKER));
}

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
  // devices attached from the image but not mounted
  let current = '';
  for (const line of spawnSync('/usr/bin/hdiutil', ['info'], { encoding: 'utf8' }).stdout.split('\n')) {
    const img = /^image-path\s*:\s*(.+)$/.exec(line)?.[1];
    if (img !== undefined) current = img;
    const dev = /^(\/dev\/disk\d+)\s/.exec(line)?.[1];
    if (dev !== undefined && current === image) spawnSync('/usr/bin/hdiutil', ['detach', '-force', dev], { stdio: 'ignore', timeout: 30_000 });
  }
}

describe.runIf(ON_MAC)('SEC CRITICAL-A: no mounts from a review call (macOS, real sandbox)', () => {
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`)));
    home = path.join(root, 'home');
    repo = path.join(home, 'dev', 'repo');
    userTemp = path.join(root, 'T');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(userTemp, { mode: 0o700 });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    // made outside the sandbox, hermetically, in the test's own temp folder
    image = path.join(root, 'img.dmg');
    execFileSync('/usr/bin/hdiutil', ['create', '-quiet', '-size', '1m', '-fs', 'HFS+', '-volname', 'ossr12', '-layout', 'NONE', image], { timeout: 60_000 });
  });

  afterAll(() => {
    detachAll(MARKER, image);
    expect(ourMounts()).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('hdiutil attach over <repo>/.git/hooks fails and mounts nothing', () => {
    const hooks = path.join(repo, '.git', 'hooks');
    const ran = run(`/usr/bin/hdiutil attach -nobrowse -readonly -mountpoint '${hooks}' '${image}'`);
    expect(ran.status, ran.out).not.toBe(0);
    expect(ourMounts()).toEqual([]);
  });

  it('diskutil (not a mount tool itself) mounts nothing either: DiskArbitration is denied', () => {
    const hooks = path.join(repo, '.git', 'hooks');
    run(`/usr/sbin/diskutil image attach --readOnly --nobrowse --mountPoint '${hooks}' '${image}'`);
    expect(ourMounts()).toEqual([]);
  });

  it('the mount tools themselves do not run (/sbin/mount, /sbin/mount_hfs, a filesystem bundle tool)', () => {
    for (const tool of ['/sbin/mount', '/sbin/mount_hfs', '/sbin/mount_apfs']) {
      const ran = run(`'${tool}' >/dev/null 2>&1; echo "rc=$?"`);
      // 126: the shell could not run it (the sandbox denied the exec)
      expect(ran.out.trim(), tool).toBe('rc=126');
    }
    const bundle = fs.readdirSync('/System/Library/Filesystems').find((name) => name.endsWith('.fs'));
    if (bundle !== undefined) {
      const tools = path.join('/System/Library/Filesystems', bundle, 'Contents', 'Resources');
      const exe = fs.existsSync(tools) ? fs.readdirSync(tools).map((n) => path.join(tools, n)).find((p) => fs.statSync(p).isFile() && (fs.statSync(p).mode & 0o111) !== 0) : undefined;
      if (exe !== undefined) expect(run(`'${exe}' >/dev/null 2>&1; echo "rc=$?"`).out.trim(), exe).toBe('rc=126');
    }
  });

  it('ordinary programs still run', () => {
    expect(run('/bin/echo ok').out).toBe('ok\n');
  });
});
