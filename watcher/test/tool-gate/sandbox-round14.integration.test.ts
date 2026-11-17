/**
 * @behavior Round 14 (part A), SEC CRITICAL-1: a review agent's Bash call can't call mount(2) or
 *   unmount(2) itself. Denying the mount tools and DiskArbitration (round 12) left the system call
 *   open: an unprivileged user may mount devfs over a folder they own, e.g. over ~/.claude/plugins,
 *   which hides the gate's own hook and turns it off. The sandbox now denies file-mount and
 *   file-unmount outright.
 * @business-rule R-266: a review agent may not change what it judges, nor the gate that holds it.
 * @boundary /usr/bin/sandbox-exec and the mount(2)/unmount(2) system calls (through /usr/bin/perl's
 *   `syscall`), run for real on macOS. Targets are scratch folders in the test's own temp folder,
 *   whose path holds a marker; every mount holding it is detached in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewContainment, reviewSandboxProfile, SANDBOX_EXEC, type Containment } from '../../src/tool-gate/sandbox.js';

const ON_MAC = process.platform === 'darwin';
const SESSION = 'sbx-r14';
const MARKER = `oss-r14-mount-${process.pid}`;
const SYS_MOUNT = 167;
const SYS_UNMOUNT = 159;
/** mount(2) of devfs at ARGV[0], then prints the result and errno (perl's syscall wants writable strings). */
const PERL_MOUNT = `my ($f, $t) = ("devfs", $ARGV[0]); my $r = syscall(${SYS_MOUNT}, $f, $t, 0, 0); print "rc=$r errno=", $! + 0, "\\n";`;
/** unmount(2) of ARGV[0], then prints the result and errno. */
const PERL_UNMOUNT = `my $t = $ARGV[0]; my $r = syscall(${SYS_UNMOUNT}, $t, 0); print "rc=$r errno=", $! + 0, "\\n";`;
const EPERM = 1;

let root: string;
let home: string;
let repo: string;
let userTemp: string;

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

function sandboxed(command: string): string {
  const wrapped = String(containment().wrap(command, [repo]));
  expect(wrapped.startsWith(`${SANDBOX_EXEC} `)).toBe(true);
  const ran = spawnSync('/bin/bash', ['-c', wrapped], { cwd: repo, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
  return `${ran.stdout}${ran.stderr}`.trim();
}

const quote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/** The mount table lines that hold the marker (only the test's own scratch folders do). */
function ourMounts(): string[] {
  return spawnSync('/sbin/mount', [], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(MARKER));
}

function unmountAll(): void {
  for (let round = 0; round < 3 && ourMounts().length > 0; round += 1) {
    for (const line of ourMounts()) {
      const at = / on (.+) \(/.exec(line)?.[1];
      if (at !== undefined) spawnSync('/sbin/umount', ['-f', at], { stdio: 'ignore', timeout: 30_000 });
    }
  }
}

describe('SEC CRITICAL-1: the profile denies the mount system calls', () => {
  it('holds (deny file-mount) and (deny file-unmount)', () => {
    const lines = reviewSandboxProfile({ homes: ['/Users/x'], privateDir: '/private/var/folders/t/T/oss-review/s/a', repos: [] }).split('\n');
    expect(lines).toContain('(deny file-mount)');
    expect(lines).toContain('(deny file-unmount)');
  });
});

describe.runIf(ON_MAC)('SEC CRITICAL-1: no mount(2) from a review call (macOS, real sandbox)', () => {
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`)));
    home = path.join(root, 'home');
    repo = path.join(home, 'dev', 'repo');
    userTemp = path.join(root, 'T');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(userTemp, { mode: 0o700 });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  });

  afterAll(() => {
    unmountAll();
    expect(ourMounts()).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('outside the sandbox the same call mounts (the attack is real), and it is detached again', () => {
    const target = path.join(root, 'outside');
    fs.mkdirSync(target);
    try {
      expect(execFileSync('/usr/bin/perl', ['-e', PERL_MOUNT, target], { encoding: 'utf8' }).trim()).toBe('rc=0 errno=0');
      expect(ourMounts().length).toBe(1);
    } finally {
      unmountAll();
    }
  });

  it('a direct mount(2) of devfs over a folder the agent may write: EPERM, nothing mounted', () => {
    const target = path.join(userTemp, 'oss-review', SESSION, 'agent-a', 'over');
    containment();
    fs.mkdirSync(target, { recursive: true });
    const out = sandboxed(`/usr/bin/perl -e ${quote(PERL_MOUNT)} ${quote(target)}`);
    expect(out).toBe(`rc=-1 errno=${EPERM}`);
    expect(ourMounts()).toEqual([]);
  });

  it('a direct mount(2) of devfs over a folder in the reviewed repo: EPERM, nothing mounted', () => {
    const target = path.join(repo, '.git', 'hooks');
    fs.mkdirSync(target, { recursive: true });
    const out = sandboxed(`/usr/bin/perl -e ${quote(PERL_MOUNT)} ${quote(target)}`);
    expect(out).toBe(`rc=-1 errno=${EPERM}`);
    expect(ourMounts()).toEqual([]);
  });

  it('a direct unmount(2) of a mount made outside the sandbox: EPERM, still mounted', () => {
    const target = path.join(root, 'held');
    fs.mkdirSync(target);
    try {
      execFileSync('/usr/bin/perl', ['-e', PERL_MOUNT, target]);
      expect(ourMounts().length).toBe(1);
      const out = sandboxed(`/usr/bin/perl -e ${quote(PERL_UNMOUNT)} ${quote(target)}`);
      expect(out).toBe(`rc=-1 errno=${EPERM}`);
      expect(ourMounts().length).toBe(1);
    } finally {
      unmountAll();
    }
  });
});
