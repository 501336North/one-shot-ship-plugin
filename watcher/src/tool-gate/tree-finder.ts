/**
 * Searches a folder on disk for names a protected pattern can match anywhere below it (a nested
 * `.git`), for a recursive delete (fix round 4, K3): `rm -rf build` removes `build/sub/.git` as
 * surely as `rm -rf build/sub/.git` does. The walk goes the way `rm -r` does: it never follows a
 * link (rm removes the link itself) and never goes inside a name it found (that name is what
 * matters). A folder it can't read is unknown, so the call is refused (fix round 4, K8).
 *
 * A finder made for one call reads each folder once and counts its work: past its limits (folders
 * read, time spent) it throws OverBudget, so the call is refused as too complex, never allowed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { OverBudget } from './budget.js';
import { tick } from './deadline.js';

export interface TreeFinder {
  /** Absolute paths of the entries below `dir` (not `dir` itself) whose name `wanted` accepts. */
  namedBelow(dir: string, wanted: (name: string) => boolean): string[];
}

export interface TreeLimits {
  /** Most folders read per call. */
  maxDirs: number;
  /** Most entries read per call, in all folders (one folder can hold a million: fix round 4, K8). */
  maxEntries?: number;
  /**
   * Most time, from its first read, the reads may take in all (fix part K12: time the call spent
   * before the search, such as git's dry run, is not charged to it; the call's deadline still is).
   */
  timeMs?: number;
}

/** One folder's entries, read one at a time: names, and whether each is a real folder (a link is not). */
type ReadDir = (dir: string) => Iterable<fs.Dirent>;

/** Reads a folder entry by entry (`opendir`), so a huge folder never has to be read whole before the limits are looked at. */
function* readEntries(dir: string): Iterable<fs.Dirent> {
  const handle = fs.opendirSync(dir);
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) yield entry;
  } finally {
    handle.closeSync();
  }
}

/** Errors that mean there is no folder to search (nothing there, or a file): rm -r has nothing below to reach. */
const NO_FOLDER = new Set(['ENOENT', 'ENOTDIR']);

export function createTreeFinder(
  limits: TreeLimits = { maxDirs: Infinity },
  readdir: ReadDir = readEntries,
  now: () => number = () => performance.now(),
): TreeFinder {
  let deadline: number | undefined;
  const maxEntries = limits.maxEntries ?? Infinity;
  const read = new Map<string, fs.Dirent[]>();
  let entriesRead = 0;

  const entriesOf = (dir: string): fs.Dirent[] => {
    const known = read.get(dir);
    if (known !== undefined) return known;
    if (read.size >= limits.maxDirs) throw new OverBudget(`it makes the gate search more than ${limits.maxDirs} folders on disk`);
    deadline ??= limits.timeMs === undefined ? Infinity : now() + limits.timeMs;
    if (now() > deadline) throw new OverBudget('searching the folders on disk took too long');
    const entries: fs.Dirent[] = [];
    try {
      for (const entry of readdir(dir)) {
        tick();
        if (++entriesRead > maxEntries) throw new OverBudget(`it makes the gate search more than ${maxEntries} names on disk`);
        entries.push(entry);
      }
    } catch (error) {
      if (error instanceof OverBudget) throw error;
      // a folder it may not read holds something it can't see: unknown, so refused (K8)
      if (!NO_FOLDER.has((error as NodeJS.ErrnoException).code ?? '')) throw new OverBudget(`the gate can't list ${dir}`);
    }
    read.set(dir, entries);
    return entries;
  };

  return {
    namedBelow(dir, wanted) {
      const found: string[] = [];
      const todo = [dir];
      for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
        for (const entry of entriesOf(next)) {
          const full = path.join(next, entry.name);
          if (wanted(entry.name)) found.push(full);
          else if (entry.isDirectory()) todo.push(full);
        }
      }
      return found;
    },
  };
}
