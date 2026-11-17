/**
 * The mount points under a set of folders (R-266 round 12, SEC CRITICAL-A backstop): after a review
 * agent's Bash call, a file system mounted under a reviewed repo or the agent's private folder (a disk
 * image over `.git/hooks`) means the reviewed code may have been swapped. The review sandbox denies
 * mounting (sandbox.ts); this check catches a mount that got past it. Round 13 (PERF LOW-2): the table
 * is read on its own time limit, never the decision's time left. Round 14 (D-R14-1): on macOS any mount
 * at or under a watched place counts (the sandbox denies mount(2) outright, so there is nothing to
 * excuse); only on Linux (dev containers) a baseline from the agent's first call excuses the mounts
 * that were already there. Accepted limit there: code running as the user can rewrite the baseline.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readPrivateFile, sessionFolder, writePrivateFile } from '../gate-run/run-store.js';

/** One mount table entry: the device (file system source) and where it is mounted. */
export interface MountEntry {
  device: string;
  at: string;
}

/** A mount table line: `dev on /path (type, …)` (macOS) or `dev on /path type t (…)` (Linux `mount`). */
const MOUNT_LINE = /^(.+?) on (.+?) (?:type \S+ )?\([^()]*\)$/;

const unescape = (field: string): string => field.replace(/\\([0-7]{3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)));

/** The mounts on this machine, or null when they can't be read within `capMs`. */
export function mountTable(platform: NodeJS.Platform, capMs: number): MountEntry[] | null {
  if (platform === 'linux') {
    try {
      // /proc/self/mounts: `dev mountpoint type …`, spaces in names as \040
      return fs.readFileSync('/proc/self/mounts', 'utf8').split('\n').flatMap((line) => {
        const [device, at] = line.split(' ');
        return device === undefined || at === undefined || at === '' ? [] : [{ device: unescape(device), at: unescape(at) }];
      });
    } catch {
      return null;
    }
  }
  const run = spawnSync('/sbin/mount', [], { encoding: 'utf8', timeout: capMs, stdio: ['ignore', 'pipe', 'ignore'] });
  if (run.status !== 0 || typeof run.stdout !== 'string') return null;
  return run.stdout.split('\n').flatMap((line) => {
    const found = MOUNT_LINE.exec(line);
    return found?.[1] === undefined || found[2] === undefined ? [] : [{ device: found[1], at: found[2] }];
  });
}

/**
 * The mounts at or inside any of `places` (round 13, CR L-c: a mount exactly at a repo root hides the
 * whole repo). A volume a repo lives on is above it, never at it, unless the repo is itself a volume's
 * root: that counts too (accepted: such a repo can't be reviewed on macOS).
 */
export function mountedAtOrUnder(points: readonly MountEntry[], places: readonly string[]): MountEntry[] {
  return points.filter(({ at }) => places.some((place) => at === place || at.startsWith(`${place}/`)));
}

/**
 * The mounts strictly above any of `places` (round 15, CR L3: a mount over a folder above a repo hides
 * it as surely as one on it). Linux only (D-R15-2), where the caller passes only the change from the
 * baseline; macOS keeps no baseline (ADR-043) and doesn't check above (accepted limit: the review
 * sandbox's mount deny is the defence).
 */
export function mountedAbove(points: readonly MountEntry[], places: readonly string[]): MountEntry[] {
  return points.filter(({ at }) => places.some((place) => place !== at && place.startsWith(at === '/' ? '/' : `${at}/`)));
}

const key = (entry: MountEntry): string => JSON.stringify([entry.device, entry.at]);

/**
 * The entries of `a` not matched one for one in `b` (round 14, CR LOW-4 / SEC LOW-1): a multiset of
 * (device, mount point), so a mount stacked on a path already in `b`, or another device at that path,
 * is still new.
 */
export function notIn(a: readonly MountEntry[], b: readonly MountEntry[]): MountEntry[] {
  const left = new Map<string, number>();
  for (const entry of b) left.set(key(entry), (left.get(key(entry)) ?? 0) + 1);
  return a.filter((entry) => {
    const count = left.get(key(entry)) ?? 0;
    if (count > 0) left.set(key(entry), count - 1);
    return count === 0;
  });
}

/**
 * The agent's mount baseline file in its gate state (round 13, D-R13-2): the session's own when the
 * hook names no safe agent id (as its private folder is); throws for an unsafe session id.
 */
function baselineFile(home: string, sessionId: unknown, agentId: unknown): string {
  const owner = typeof agentId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(agentId) ? agentId : 'session';
  return path.join(sessionFolder(home, String(sessionId)), `${owner}.mounts`);
}

/**
 * Records the agent's mount table once (round 13, D-R13-2; Linux only from round 14, D-R14-1), in its
 * gate state under ~/.oss/gate-state: write-once, the first caller wins (a whole file put in place with
 * link(), which never replaces one). Throws when the state can't be written.
 */
export function recordMountBaseline(home: string, sessionId: unknown, agentId: unknown, points: readonly MountEntry[]): void {
  const file = baselineFile(home, sessionId, agentId);
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() === true) return;
  const draft = `${file}.draft-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    writePrivateFile(draft, JSON.stringify(points));
    try {
      fs.linkSync(draft, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    fs.rmSync(draft, { force: true });
  }
}

const isEntry = (value: unknown): value is MountEntry =>
  typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).device === 'string' && typeof (value as Record<string, unknown>).at === 'string';

/** The agent's mount baseline, or null when it is missing or can't be used. */
export function readMountBaseline(home: string, sessionId: unknown, agentId: unknown): MountEntry[] | null {
  try {
    const data: unknown = JSON.parse(readPrivateFile(baselineFile(home, sessionId, agentId)) ?? 'null');
    return Array.isArray(data) && data.every(isEntry) ? data : null;
  } catch {
    return null;
  }
}
