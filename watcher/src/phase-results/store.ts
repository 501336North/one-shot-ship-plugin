/**
 * Phase result store (R-257 Task 3, amended P7, P8, S10).
 *
 * Results live at `<repo>/.oss/dev/active/<feature>/results/<phase>.json`. Writes are atomic (O_EXCL|O_NOFOLLOW
 * temp file, then rename) and confined (no symlink at any level under .oss; after the rename the target's realpath
 * must still be inside results/). Reads are hang-safe (O_NONBLOCK|O_NOFOLLOW) and accept only a regular file with one
 * link owned by the current user. Error ids are the stable strings in NOTES.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { PHASES, type Phase } from './schemas.js';

export type ReadResult = { ok: true; bytes: Buffer; value: unknown } | { ok: false; error: string };
export interface WriteHooks {
  /** Test seam: runs after the temp file is complete and before it is renamed over the target. */
  beforeRename?: (tmp: string) => void;
}

const FEATURE_RE = /^[A-Za-z0-9._-]+$/;
const RESULT_CAP = 256 * 1024;
const VALUE_CAP = 64 * 1024;
const VALUE_MAX_AGE_MS = 10 * 60 * 1000;
const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs.constants;

/** Physical git toplevel of cwd (GIT_* env removed, CLAUDE_PROJECT_DIR ignored), or null outside a repo. */
export function resolveRepo(cwd: string): string | null {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return top === '' ? null : fs.realpathSync(top);
  } catch {
    return null;
  }
}

function checkNames(feature: string, phase: string): void {
  if (!FEATURE_RE.test(feature) || feature.startsWith('.')) throw new Error(`bad_feature: ${JSON.stringify(feature)}`);
  if (!(PHASES as readonly string[]).includes(phase)) throw new Error(`unsafe_path: unknown phase ${JSON.stringify(phase)}`);
}

/**
 * Walk .oss/dev/active/<feature>/results under repo, refusing any symlink or non-directory.
 * Returns the results/ path, or null when a component is missing and create is false.
 */
function resultsDir(repo: string, feature: string, create: boolean): string | null {
  let cur = repo;
  for (const comp of ['.oss', 'dev', 'active', feature, 'results']) {
    cur = path.join(cur, comp);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      if (!create) return null;
      fs.mkdirSync(cur, { mode: 0o700 });
      st = fs.lstatSync(cur);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`unsafe_path: ${comp}`);
  }
  return cur;
}

/** Read at most cap + 1 bytes from fd. */
function readCapped(fd: number, cap: number): Buffer {
  const buf = Buffer.alloc(cap + 1);
  let n = 0;
  while (n < buf.length) {
    const got = fs.readSync(fd, buf, n, buf.length - n, null);
    if (got === 0) break;
    n += got;
  }
  return buf.subarray(0, n);
}

export function writeResult(repo: string, feature: string, phase: Phase, obj: unknown, hooks: WriteHooks = {}): void {
  checkNames(feature, phase);
  const data = JSON.stringify(obj);
  if (Buffer.byteLength(data) > RESULT_CAP) throw new Error('too_large: result over 256 KB');
  const dir = resultsDir(repo, feature, true) as string;
  const realDir = fs.realpathSync(dir);
  const target = path.join(dir, `${phase}.json`);
  try {
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`unsafe_path: ${phase}.json`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const tmp = path.join(dir, `.${phase}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o600);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    hooks.beforeRename?.(tmp);
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  const realTarget = fs.realpathSync(target);
  if (path.dirname(realTarget) !== realDir) {
    fs.unlinkSync(realTarget);
    throw new Error('unsafe_path: results/ moved during write');
  }
}

export function readResult(repo: string, feature: string, phase: Phase): ReadResult {
  checkNames(feature, phase);
  let dir: string | null;
  try {
    dir = resultsDir(repo, feature, false);
  } catch {
    return { ok: false, error: 'unsafe_path' };
  }
  if (dir === null) return { ok: false, error: 'missing' };
  let fd: number;
  try {
    fd = fs.openSync(path.join(dir, `${phase}.json`), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    return { ok: false, error: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe_path' };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.()) return { ok: false, error: 'unsafe_path' };
    const bytes = readCapped(fd, RESULT_CAP);
    if (bytes.length > RESULT_CAP) return { ok: false, error: 'too_large' };
    try {
      return { ok: true, bytes, value: JSON.parse(bytes.toString('utf-8')) };
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** A value file the model wrote: regular, not a link, at most 64 KB, written in the last 10 minutes; else null. */
export function readValueFile(dir: string, name: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(path.join(dir, name), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || Date.now() - st.mtimeMs > VALUE_MAX_AGE_MS) return null;
    const bytes = readCapped(fd, VALUE_CAP);
    return bytes.length > VALUE_CAP ? null : bytes.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}
