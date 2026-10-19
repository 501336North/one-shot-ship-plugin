/**
 * The ONE Node guard for writes under a project's .oss/ (ADR-1, oss-writer-nofollow).
 * Twin of hooks/oss-safe-path.sh; keep the rules identical.
 *
 * Every function takes the `.oss` directory and a path relative to it. Rules for each component
 * from the `.oss` directory down to the target's parent: not a symlink, a directory, owned by the
 * current user or by the owner of the physical project root; the target is absent or a regular file with link count 1 that is not a symlink;
 * the physical parent stays inside the physical project. The project itself is resolved
 * physically, so a symlink ABOVE it (e.g. /tmp -> /private/tmp) is fine.
 *
 * A failed check writes nothing, prints `oss: refusing unsafe .oss path <rel>` to stderr and
 * returns false (best-effort writers never break the user's flow). `$HOME/.oss` is the user's own
 * directory: out of scope, written exactly as before.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface SafeWriteOptions {
  /** Create missing directories (default true). When false a missing one throws ENOENT. */
  createDirs?: boolean;
}

/** G15: realpath($HOME) once per HOME value (HOME can change, e.g. in tests). */
let homeCache: { home: string; real: string } | null = null;
function realHome(home: string): string {
  if (homeCache === null || homeCache.home !== home) homeCache = { home, real: fs.realpathSync(home) };
  return homeCache.real;
}

function isUserOssDir(ossDir: string): boolean {
  const home = process.env.HOME;
  if (!home) return false;
  if (path.resolve(ossDir) === path.resolve(home, '.oss')) return true;
  try {
    return path.basename(ossDir) === '.oss' && fs.realpathSync(path.dirname(ossDir)) === realHome(home);
  } catch {
    return false;
  }
}

function refuse(ossDir: string, rel: string): false {
  process.stderr.write(`oss: refusing unsafe .oss path ${path.join(path.basename(ossDir), rel)}\n`);
  return false;
}

/** G3: owned by the current user OR by the owner of the physical project root. */
function ownedOk(st: fs.Stats, rootUid: number): boolean {
  return typeof process.getuid !== 'function' || st.uid === process.getuid() || st.uid === rootUid;
}

/** Physical path of ossDir/relDir after creating/checking each component, or null if unsafe. */
function safeDir(ossDir: string, relDir: string, createDirs: boolean): string | null {
  const projectReal = fs.realpathSync(path.dirname(path.resolve(ossDir)));
  const parts = [path.basename(path.resolve(ossDir)), ...relDir.split(/[\\/]/)].filter((c) => c !== '' && c !== '.');
  const rootUid = fs.lstatSync(projectReal).uid;
  let cur = projectReal;
  for (const comp of parts) {
    if (comp === '..') return null;
    cur = path.join(cur, comp);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      if (!createDirs) throw e;
      try {
        fs.mkdirSync(cur);
      } catch (m) {
        if ((m as NodeJS.ErrnoException).code !== 'EEXIST') throw m;
      }
      st = fs.lstatSync(cur);
    }
    if (st.isSymbolicLink() || !st.isDirectory() || !ownedOk(st, rootUid)) return null;
  }
  const phys = fs.realpathSync(cur);
  return phys === projectReal || phys.startsWith(projectReal + path.sep) ? phys : null;
}

/** Absolute safe target path, or null if any rule fails. */
function safeTarget(ossDir: string, rel: string, createDirs: boolean): string | null {
  const dir = safeDir(ossDir, path.dirname(rel), createDirs);
  if (dir === null) return null;
  const base = path.basename(rel);
  if (base === '' || base === '.' || base === '..') return null;
  const target = path.join(dir, base);
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1) return null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  return target;
}

/** Ensure ossDir/relDir exists safely. */
export function safeMkdirOss(ossDir: string, relDir = ''): boolean {
  if (isUserOssDir(ossDir)) {
    fs.mkdirSync(path.join(ossDir, relDir), { recursive: true });
    return true;
  }
  return safeDir(ossDir, relDir, true) !== null || refuse(ossDir, relDir);
}

/** Replace ossDir/rel with data: O_EXCL temp file in the same directory, then rename. */
export function safeWriteFileAtomic(ossDir: string, rel: string, data: string, options: SafeWriteOptions = {}): boolean {
  let target: string | null;
  if (isUserOssDir(ossDir)) {
    target = path.join(ossDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } else {
    target = safeTarget(ossDir, rel, options.createDirs ?? true);
    if (target === null) return refuse(ossDir, rel);
  }
  // G6: an existing file keeps its mode; a new one gets the umask default (0666 & ~umask).
  let keepMode: number | null = null;
  try {
    keepMode = fs.statSync(target).mode & 0o7777;
  } catch {
    keepMode = null;
  }
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'wx', 0o666);
  try {
    try {
      if (keepMode !== null) fs.fchmodSync(fd, keepMode);
      fs.writeSync(fd, data);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true }); // never leave the temp file behind
    throw e;
  }
  return true;
}

/** Append data to ossDir/rel with O_APPEND|O_NOFOLLOW; the opened fd is re-checked (fstat). */
export function safeAppendFile(ossDir: string, rel: string, data: string, options: SafeWriteOptions = {}): boolean {
  if (isUserOssDir(ossDir)) {
    fs.appendFileSync(path.join(ossDir, rel), data);
    return true;
  }
  const target = safeTarget(ossDir, rel, options.createDirs ?? true);
  if (target === null) return refuse(ossDir, rel);
  const c = fs.constants;
  const fd = fs.openSync(target, c.O_WRONLY | c.O_APPEND | c.O_CREAT | (c.O_NOFOLLOW ?? 0), 0o644);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) return refuse(ossDir, rel);
    fs.writeSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}
