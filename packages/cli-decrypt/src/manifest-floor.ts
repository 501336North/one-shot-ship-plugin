/**
 * Anti-rollback floor for the signed manifest (R-273 D11, ADR-007).
 *
 * The floor of one API lives in `~/.oss/manifest-floor.d/<sha256 of its normalised apiUrl>/`: recording a
 * version adds an empty file named by that version, and the floor is the highest such name (and at least the
 * compiled-in floor). Files are only ever added, never rewritten or removed, so no interleaving of runs can
 * lower a floor and no lock is needed. A folder on the way (the config dir, manifest-floor.d, the API's
 * folder) that is not a private dir of this user (a symlink, not a dir, group/other-writable, someone
 * else's), or that is no longer the dir that was checked when it is listed or written to, means the
 * compiled-in floor and no write. A config dir of ours that is only group/other-writable is made owner-only
 * (0700), with a notice, and trusted from the next run on. Nothing here throws: a floor that cannot be
 * recorded is one warning, and the run goes on. Call this only AFTER the manifest signature has verified.
 */

import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, type Stats,
} from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { getConfigDir } from './config.js';

/** The live manifest's version when this binary was built. */
export const MIN_MANIFEST_VERSION = 1794940034;

export type FloorVerdict = 'accepted' | 'older' | 'invalid';

const NOT_RECORDED = '[verify] Could not record the manifest version floor; this run is not affected';

const REPAIRED =
  '[verify] Your config folder was writable by other users; it is now owner-only (0700) so the manifest floor can be kept there';

const UNTRUSTED =
  '[verify] The manifest floor folder or your config folder is not a private folder of yours — using the built-in floor, not updating it';

/** A recorded version: a decimal name that is always a safe integer. */
const VERSION_NAME = /^[0-9]{1,15}$/;

/**
 * One key per API however its URL is spelled: the URL parser lower-cases scheme and host, drops the default
 * port and resolves dot segments (also percent-encoded ones); a trailing slash is dropped.
 */
function floorKey(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return apiUrl;
  }
}

/**
 * The folders from the config dir down to the API's floor folder. The config dir is resolved lexically
 * ("link/.", "link//", "link/x/.." are "link"), so a link given as the config dir is the last part and is refused.
 */
function floorDirs(apiUrl: string): [string, string, string] {
  const config = resolve(getConfigDir());
  const store = join(config, 'manifest-floor.d');
  return [config, store, join(store, createHash('sha256').update(floorKey(apiUrl)).digest('hex'))];
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/** Owned by this user and not writable by group or others. */
function isPrivate(stats: Stats): boolean {
  const uid = process.getuid?.();
  return (uid === undefined || stats.uid === uid) && (stats.mode & 0o022) === 0;
}

/** A dir opened without following a link, and never waiting on a FIFO. */
const DIR_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY | (constants.O_NONBLOCK ?? 0);

/**
 * Opens each of `dirs` in turn (making it first on the write) and returns how each looked and the open
 * descriptor of the last, or null at the first that is not a private dir of ours. On the read, a config dir of
 * ours that is only group/other-writable is made owner-only, but trusted from the next run on.
 */
function openPrivateDirs(dirs: readonly string[], write: boolean): { seen: Stats[]; fd: number } | null {
  const seen: Stats[] = [];
  for (const [i, dir] of dirs.entries()) {
    if (write) {
      try {
        mkdirSync(dir, { recursive: i === 0, mode: 0o700 });
      } catch (err) {
        if (errCode(err) !== 'EEXIST') throw err;
      }
    }
    const fd = openSync(dir, DIR_FLAGS);
    let keep = false;
    try {
      const stats = fstatSync(fd);
      if (!write && i === 0 && stats.isDirectory() && stats.uid === process.getuid?.() && (stats.mode & 0o022) !== 0) {
        fchmodSync(fd, 0o700);
        console.error(REPAIRED);
        return null;
      }
      if (!stats.isDirectory() || !isPrivate(stats)) return null;
      seen.push(stats);
      keep = i === dirs.length - 1;
      if (keep) return { seen, fd };
    } finally {
      if (!keep) closeSync(fd);
    }
  }
  return null;
}

/** Whether each of `dirs` is still the dir that was checked (a link or another dir in its place is not). */
function sameDirs(dirs: readonly string[], seen: Stats[]): boolean {
  return dirs.every((dir, i) => {
    const now = lstatSync(dir);
    return now.dev === seen[i].dev && now.ino === seen[i].ino;
  });
}

/** The highest recorded version for `apiUrl` (0 when none), or null when a folder on the way is not trusted. */
function readRecorded(apiUrl: string): number | null {
  const dirs = floorDirs(apiUrl);
  let checked = false;
  try {
    const opened = openPrivateDirs(dirs, false);
    if (opened === null) return null;
    checked = true;
    closeSync(opened.fd);
    const names = readdirSync(dirs[2]);
    if (!sameDirs(dirs, opened.seen)) return null;
    let max = 0;
    for (const name of names) if (VERSION_NAME.test(name)) max = Math.max(max, Number(name));
    return max;
  } catch (err) {
    return !checked && errCode(err) === 'ENOENT' ? 0 : null;
  }
}

/** The highest manifest version accepted from `apiUrl` (at least MIN_MANIFEST_VERSION). */
export function readManifestFloor(apiUrl: string): number {
  return Math.max(MIN_MANIFEST_VERSION, readRecorded(apiUrl) ?? 0);
}

/**
 * Add the file named `v` to the API's floor folder (creating owner-only folders); an existing one is kept as
 * it is. The new name is made durable (best effort) through the descriptor of the folder that was checked.
 */
function recordVersion(apiUrl: string, v: number): void {
  try {
    const dirs = floorDirs(apiUrl);
    const opened = openPrivateDirs(dirs, true);
    if (opened === null) {
      console.error(UNTRUSTED);
      return;
    }
    try {
      if (!sameDirs(dirs, opened.seen)) {
        console.error(UNTRUSTED);
        return;
      }
      try {
        closeSync(openSync(join(dirs[2], String(v)), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600));
      } catch (err) {
        if (errCode(err) !== 'EEXIST') throw err;
      }
      try {
        fsyncSync(opened.fd);
      } catch {
        // not every platform can flush a directory; the file exists either way
      }
      if (!sameDirs(dirs, opened.seen)) console.error(UNTRUSTED);
    } finally {
      closeSync(opened.fd);
    }
  } catch {
    console.error(NOT_RECORDED);
  }
}

/**
 * Check a signature-verified manifest version against the floor for `apiUrl`, and record it when it is
 * newer. A floor that cannot be read or recorded only warns: the version already passed the floor as read.
 */
export function checkAndRecordManifestVersion(apiUrl: string, version: unknown): FloorVerdict {
  if (typeof version !== 'number' || !VERSION_NAME.test(String(version))) return 'invalid';
  const v = version;
  const recorded = readRecorded(apiUrl);
  if (recorded === null) console.error(UNTRUSTED);
  const floor = Math.max(MIN_MANIFEST_VERSION, recorded ?? 0);
  if (v < floor) return 'older';
  if (v > floor && recorded !== null) recordVersion(apiUrl, v);
  return 'accepted';
}
