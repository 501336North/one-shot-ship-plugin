/**
 * The review-run check's state (R-266, ADR-009): per session under ~/.oss/gate-state/<session_id>/,
 * outside any repo a review agent judges (round 14 C, D-R14-3: its own folder, which config/tool-gates.json
 * protects as `~/.oss/gate-state/**`, so the main agent and builders can't erase a tamper mark; not under
 * ~/.oss/run, which a served /oss:plan block sweeps; old ~/.oss/run/gate-run folders are left behind):
 *   <agent_id>.snap.json             the start snapshot
 *   <agent_id>.<unique>.notice.json  a pending notice for the main agent (never overwritten)
 *   <agent_id>.<mark>                the run's ledger: started, start-failed, tamper, done
 *   <agent_id>.run/                  the run's own temporary files (index, excludes, object copy)
 *   agents.seen                      every review run's agent id the check started (appended, one per line)
 *   repos.json                       more repos the main agent named for this session's review runs
 *   repo-request.txt                 the main agent's request to name one (taken by `add-repo`)
 * Folders are 0700 and never a symlink; files are 0600, opened with O_NOFOLLOW and O_NONBLOCK, and read
 * only when they are regular files (a FIFO in their place is refused, never waited on). Only plain ids
 * are used as names. A file is taken by renaming it to a name only this process knows first, so two hooks
 * never both hand out one notice. Each notice is checked on its own: a bad one is counted (unreadable),
 * one for a run the ledger does not know is counted (unknown, i.e. tampering), and neither hides the
 * good ones. Entries older than 2 days are swept (best effort).
 *
 * A review agent runs code as the user and can rewrite any of this; the checks raise the bar, they do
 * not make it impossible (recorded limit).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REASONS } from './messages.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NOTICE_SUFFIX = '.notice.json';
const MAX_AGE_MS = 2 * 24 * 3600 * 1000;
const MAX_NOTICE_FILES = 200;
const MAX_PATH_CHARS = 512;
const SEEN_FILE = 'agents.seen';
const REPOS_FILE = 'repos.json';
const KNOWN_REASONS: ReadonlySet<string> = new Set(Object.values(REASONS));

/** What the main agent is told about one review run. */
export type Notice = { kind: 'void'; files: string[]; total: number } | { kind: 'unverified'; reason: string };

/** A run's ledger entries. */
export type Mark = 'started' | 'start-failed' | 'tamper' | 'done';

export interface TakenNotices {
  notices: Notice[];
  /** Notices that could not be read or did not validate. */
  unreadable: number;
  /** Notices for a run the ledger does not know (planted). */
  unknown: number;
}

/** True when the id is a plain one, safe to use as a file name. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id);
}

/** The root of the gate's run state, ~/.oss/gate-state (hooks/oss-node.sh oss_gate_state_dir names the same). */
export function runRoot(home: string): string {
  return path.join(home, '.oss', 'gate-state');
}

/** A folder made 0700 if missing; refused when it is a symlink or not a folder. */
function privateFolder(dir: string): void {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  if (!fs.lstatSync(dir).isDirectory()) throw new Error('gate-run state folder is not a plain folder');
}

/** The session's state folder, made if missing (with ~/.oss/gate-state). */
export function sessionFolder(home: string, sessionId: string): string {
  if (!path.isAbsolute(home)) throw new Error('HOME is not an absolute path');
  if (!isSafeId(sessionId)) throw new Error('session_id is not a safe file name');
  fs.mkdirSync(path.join(home, '.oss'), { recursive: true, mode: 0o700 });
  privateFolder(runRoot(home));
  const dir = path.join(runRoot(home), sessionId);
  privateFolder(dir);
  return dir;
}

/** Whether the session's folder is missing, a plain folder, or there but unusable (a symlink, a file). */
export function sessionState(home: string, sessionId: unknown): 'missing' | 'ok' | 'unusable' {
  if (!path.isAbsolute(home) || !isSafeId(sessionId)) return 'unusable';
  for (const dir of [runRoot(home), path.join(runRoot(home), sessionId)]) {
    const stats = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (stats === undefined) return 'missing';
    if (!stats.isDirectory()) return 'unusable';
  }
  return 'ok';
}

/** The session's state folder when it exists as a plain folder; null otherwise (nothing is made). */
function existingSessionFolder(home: string, sessionId: unknown): string | null {
  return sessionState(home, sessionId) === 'ok' ? path.join(runRoot(home), sessionId as string) : null;
}

/** Writes a 0600 file without following a symlink in its place. */
export function writePrivateFile(file: string, text: string): void {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  const fd = fs.openSync(file, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_NONBLOCK, 0o600);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('gate-run state file is not a regular file');
    fs.writeFileSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

/** A file's text without following a symlink or reading anything but a regular file; null when there is none. */
export function readPrivateFile(file: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('gate-run state file is not a regular file');
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** A file's text, removed: claimed by a rename first, so only one caller gets it. Null when there is none. */
export function takePrivateFile(file: string): string | null {
  const claimed = `${file}.taken-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.renameSync(file, claimed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return readPrivateFile(claimed);
  } finally {
    fs.rmSync(claimed, { force: true });
  }
}

function markFile(home: string, sessionId: string, agentId: string, which: Mark): string {
  if (!isSafeId(agentId)) throw new Error('agent_id is not a safe file name');
  return path.join(sessionFolder(home, sessionId), `${agentId}.${which}`);
}

/** Adds a mark to the run's ledger. */
export function mark(home: string, sessionId: string, agentId: string, which: Mark): void {
  writePrivateFile(markFile(home, sessionId, agentId, which), `${new Date().toISOString()}\n`);
}

/** True when the run's ledger has the mark (a regular file, not followed). */
export function hasMark(home: string, sessionId: unknown, agentId: unknown, which: Mark): boolean {
  const dir = existingSessionFolder(home, sessionId);
  if (dir === null || !isSafeId(agentId)) return false;
  return fs.lstatSync(path.join(dir, `${agentId}.${which}`), { throwIfNoEntry: false })?.isFile() === true;
}

export function clearMark(home: string, sessionId: unknown, agentId: unknown, which: Mark): void {
  const dir = existingSessionFolder(home, sessionId);
  if (dir !== null && isSafeId(agentId)) fs.rmSync(path.join(dir, `${agentId}.${which}`), { force: true });
}

/** True when the reason is one of the check's own. */
export function isKnownReason(reason: string): boolean {
  return KNOWN_REASONS.has(reason);
}

/** Appends to a 0600 file without following a symlink or waiting on anything but a regular file (a FIFO throws). */
export function appendPrivateFile(file: string, text: string): void {
  const { O_WRONLY, O_CREAT, O_APPEND, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  const fd = fs.openSync(file, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW | O_NONBLOCK, 0o600);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('gate-run state file is not a regular file');
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

/** Adds the run's agent id to the session's ledger of started runs (appended, never rewritten). */
export function markSeen(home: string, sessionId: string, agentId: string): void {
  if (!isSafeId(agentId)) throw new Error('agent_id is not a safe file name');
  appendPrivateFile(path.join(sessionFolder(home, sessionId), SEEN_FILE), `${agentId}\n`);
}

/** True when the session's ledger says the check started this agent's run before. */
export function wasSeen(home: string, sessionId: string, agentId: string): boolean {
  const text = readPrivateFile(path.join(sessionFolder(home, sessionId), SEEN_FILE));
  return text !== null && text.split('\n').includes(agentId);
}

/**
 * The more repos the main agent named for this session's review runs (absolute paths, no `'`); empty when
 * there are none or the record cannot be used. The tool gate reads it too (its reviewed repos).
 */
export function reviewedReposFor(home: string, sessionId: unknown): string[] {
  const dir = existingSessionFolder(home, sessionId);
  if (dir === null) return [];
  try {
    const value: unknown = JSON.parse(readPrivateFile(path.join(dir, REPOS_FILE)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((repo): repo is string => typeof repo === 'string' && path.isAbsolute(repo) && !repo.includes("'"));
  } catch {
    return [];
  }
}

/** Adds a repo top to the session's named repos (each once). */
export function addReviewedRepo(home: string, sessionId: string, top: string): void {
  const repos = [...new Set([...reviewedReposFor(home, sessionId), top])];
  writePrivateFile(path.join(sessionFolder(home, sessionId), REPOS_FILE), JSON.stringify(repos));
}

/** Keeps a notice for the main agent (a new file each time: two notices for one run never overwrite). */
export function storeNotice(home: string, sessionId: string, agentId: string, notice: Notice): void {
  if (!isSafeId(agentId)) throw new Error('agent_id is not a safe file name');
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  writePrivateFile(path.join(sessionFolder(home, sessionId), `${agentId}.${unique}${NOTICE_SUFFIX}`), JSON.stringify(notice));
}

/** A notice checked and capped; null when it does not validate. */
function parseNotice(text: string): Notice | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const notice = value as Record<string, unknown>;
  if (notice.kind === 'unverified') {
    if (typeof notice.reason !== 'string') return null;
    return { kind: 'unverified', reason: KNOWN_REASONS.has(notice.reason) ? notice.reason : REASONS.checkFailed };
  }
  if (notice.kind !== 'void') return null;
  const { files, total } = notice;
  if (!Array.isArray(files) || !files.every((file): file is string => typeof file === 'string')) return null;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < files.length) return null;
  return { kind: 'void', files: files.slice(0, MAX_NOTICE_FILES).map((file) => file.slice(0, MAX_PATH_CHARS)), total };
}

/** The session's pending notices (only `agentId`'s, when given), each handed out once, each checked on its own. */
export function takeNotices(home: string, sessionId: unknown, agentId?: unknown): TakenNotices {
  const taken: TakenNotices = { notices: [], unreadable: 0, unknown: 0 };
  const dir = existingSessionFolder(home, sessionId);
  if (dir === null || (agentId !== undefined && !isSafeId(agentId))) return taken;
  const names = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(NOTICE_SUFFIX) && (agentId === undefined || name.startsWith(`${agentId}.`)))
    .sort();
  for (const name of names) {
    const owner = name.slice(0, name.indexOf('.'));
    const known = hasMark(home, sessionId, owner, 'started') || hasMark(home, sessionId, owner, 'done');
    let text: string | null;
    try {
      text = takePrivateFile(path.join(dir, name));
    } catch {
      taken.unreadable++;
      continue;
    }
    if (text === null) continue;
    if (!known) {
      taken.unknown++;
      continue;
    }
    const notice = parseNotice(text);
    if (notice === null) taken.unreadable++;
    else taken.notices.push(notice);
  }
  return taken;
}

function isOld(stats: fs.Stats, now: number): boolean {
  return now - stats.mtimeMs > MAX_AGE_MS;
}

/** Removes session folders untouched for 2 days and entries older than that. Best effort, never throws. */
export function sweepRunFolder(home: string, now: number): void {
  try {
    const root = runRoot(home);
    if (fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) return;
    for (const name of fs.readdirSync(root)) {
      const entry = path.join(root, name);
      const stats = fs.lstatSync(entry);
      if (!stats.isDirectory()) {
        if (isOld(stats, now)) fs.rmSync(entry, { force: true });
        continue;
      }
      if (isOld(stats, now)) {
        fs.rmSync(entry, { recursive: true, force: true });
        continue;
      }
      for (const inner of fs.readdirSync(entry)) {
        const file = path.join(entry, inner);
        if (isOld(fs.lstatSync(file), now)) fs.rmSync(file, { recursive: true, force: true });
      }
    }
  } catch {
    // Best effort: a sweep never fails the check.
  }
}
