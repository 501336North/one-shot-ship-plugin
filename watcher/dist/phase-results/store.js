/**
 * Phase result store (R-257 Task 3, amended P7, P8, S10).
 *
 * Results live at `<repo>/.oss/dev/active/<feature>/results/<phase>.json`. Writes are atomic (O_EXCL|O_NOFOLLOW
 * temp file, then rename) and confined (no symlink at any level under .oss; right before the rename results/ must still
 * be the checked folder by realpath, device and inode, and after it the target's realpath must still be inside
 * results/). A write never unlinks a path that is not the file it created (round 1 finding 9). Reads are hang-safe (O_NONBLOCK|O_NOFOLLOW) and accept only a regular file with one
 * link owned by the current user. Error ids are the stable strings in NOTES.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { PHASES } from './schemas.js';
const FEATURE_RE = /^[A-Za-z0-9._-]+$/;
const RESULT_CAP = 256 * 1024;
const VALUE_CAP = 64 * 1024;
const VALUE_MAX_AGE_MS = 10 * 60 * 1000;
const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
/** Physical git toplevel of cwd (GIT_* env removed, CLAUDE_PROJECT_DIR ignored), or null outside a repo. */
export function resolveRepo(cwd) {
    const env = {};
    for (const [k, v] of Object.entries(process.env))
        if (!k.startsWith('GIT_'))
            env[k] = v;
    try {
        const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd,
            env,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000,
        }).trim();
        return top === '' ? null : fs.realpathSync(top);
    }
    catch {
        return null;
    }
}
function checkNames(feature, phase) {
    if (!FEATURE_RE.test(feature) || feature.startsWith('.'))
        throw new Error(`bad_feature: ${JSON.stringify(feature)}`);
    if (!PHASES.includes(phase))
        throw new Error(`unsafe_path: unknown phase ${JSON.stringify(phase)}`);
}
/**
 * Walk .oss/dev/active/<feature>/results under repo, refusing any symlink or non-directory.
 * Returns the results/ path, or null when a component is missing and create is false.
 */
function resultsDir(repo, feature, create) {
    let cur = repo;
    for (const comp of ['.oss', 'dev', 'active', feature, 'results']) {
        cur = path.join(cur, comp);
        let st;
        try {
            st = fs.lstatSync(cur);
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
            if (!create)
                return null;
            fs.mkdirSync(cur, { mode: 0o700 });
            st = fs.lstatSync(cur);
        }
        if (st.isSymbolicLink() || !st.isDirectory())
            throw new Error(`unsafe_path: ${comp}`);
    }
    return cur;
}
/** Read at most cap + 1 bytes from fd. */
function readCapped(fd, cap) {
    const buf = Buffer.alloc(cap + 1);
    let n = 0;
    while (n < buf.length) {
        const got = fs.readSync(fd, buf, n, buf.length - n, null);
        if (got === 0)
            break;
        n += got;
    }
    return buf.subarray(0, n);
}
/** True when `p` is still the checked folder: same realpath, not a link, same device and inode. */
function sameDir(p, realDir, dirStat) {
    try {
        const st = fs.lstatSync(p);
        return !st.isSymbolicLink() && st.isDirectory() && st.dev === dirStat.dev && st.ino === dirStat.ino && fs.realpathSync(p) === realDir;
    }
    catch {
        return false;
    }
}
/** True when `p` is (still) the very file the store created: same device and inode, not a link. */
function isOurFile(p, ours) {
    try {
        const st = fs.lstatSync(p);
        return st.isFile() && st.dev === ours.dev && st.ino === ours.ino;
    }
    catch {
        return false;
    }
}
export function writeResult(repo, feature, phase, obj, hooks = {}) {
    checkNames(feature, phase);
    const data = JSON.stringify(obj);
    if (Buffer.byteLength(data) > RESULT_CAP)
        throw new Error('too_large: result over 256 KB');
    const dir = resultsDir(repo, feature, true);
    const realDir = fs.realpathSync(dir);
    const dirStat = fs.lstatSync(dir);
    const target = path.join(dir, `${phase}.json`);
    try {
        if (fs.lstatSync(target).isSymbolicLink())
            throw new Error(`unsafe_path: ${phase}.json`);
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const tmp = path.join(dir, `.${phase}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    const fd = fs.openSync(tmp, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o600);
    let ours;
    try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
        ours = fs.fstatSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    // Finding 9: re-check right before the rename that results/ (the temp file's and the target's folder) is still the
    // checked folder, and the temp name still holds our file. On any change, refuse and touch nothing we did not create.
    try {
        hooks.beforeRename?.(tmp);
    }
    catch (e) {
        if (isOurFile(tmp, ours))
            fs.unlinkSync(tmp);
        throw e;
    }
    if (!sameDir(path.dirname(tmp), realDir, dirStat) || !sameDir(path.dirname(target), realDir, dirStat) || !isOurFile(tmp, ours)) {
        throw new Error('unsafe_path: results/ moved during write');
    }
    try {
        fs.renameSync(tmp, target);
    }
    catch (e) {
        if (isOurFile(tmp, ours))
            fs.unlinkSync(tmp);
        throw e;
    }
    const realTarget = fs.realpathSync(target);
    if (path.dirname(realTarget) !== realDir) {
        if (isOurFile(realTarget, ours))
            fs.unlinkSync(realTarget);
        throw new Error('unsafe_path: results/ moved during write');
    }
}
/** Removes results/<phase>.unverified.json (the Stop hook's repo marker) under the checked results/ dir; no-op if absent. */
export function clearUnverifiedMarker(repo, feature, phase) {
    checkNames(feature, phase);
    const dir = resultsDir(repo, feature, false);
    if (dir === null)
        return;
    try {
        fs.unlinkSync(path.join(dir, `${phase}.unverified.json`));
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
}
export function readResult(repo, feature, phase) {
    checkNames(feature, phase);
    let dir;
    try {
        dir = resultsDir(repo, feature, false);
    }
    catch {
        return { ok: false, error: 'unsafe_path' };
    }
    if (dir === null)
        return { ok: false, error: 'missing' };
    let fd;
    try {
        fd = fs.openSync(path.join(dir, `${phase}.json`), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    }
    catch (e) {
        return { ok: false, error: e.code === 'ENOENT' ? 'missing' : 'unsafe_path' };
    }
    try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.())
            return { ok: false, error: 'unsafe_path' };
        const bytes = readCapped(fd, RESULT_CAP);
        if (bytes.length > RESULT_CAP)
            return { ok: false, error: 'too_large' };
        try {
            return { ok: true, bytes, value: JSON.parse(bytes.toString('utf-8')) };
        }
        catch {
            return { ok: false, error: 'invalid_json' };
        }
    }
    finally {
        fs.closeSync(fd);
    }
}
/** A value file the model wrote: regular, not a link, at most 64 KB, written in the last 10 minutes; else null. */
export function readValueFile(dir, name) {
    let fd;
    try {
        fd = fs.openSync(path.join(dir, name), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    }
    catch {
        return null;
    }
    try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || Date.now() - st.mtimeMs > VALUE_MAX_AGE_MS)
            return null;
        const bytes = readCapped(fd, VALUE_CAP);
        return bytes.length > VALUE_CAP ? null : bytes.toString('utf-8');
    }
    finally {
        fs.closeSync(fd);
    }
}
//# sourceMappingURL=store.js.map