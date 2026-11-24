/**
 * Owner-only run ledger (R-257 T3b; contract: NOTES "Ledger (D14, T3b)").
 * Root: $HOME/.oss/ledger/<key>/, key derived exactly as `_ov_key` in hooks/oss-value.sh.
 * Only node builtins and erasable TS syntax: child processes import this file directly.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
export class LedgerError extends Error {
    code;
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'LedgerError';
        this.code = code;
    }
}
/** A run row with every field a string; null otherwise (a row from before `feature` was recorded, for one). */
export function parseRunRow(row) {
    if (row === null)
        return null;
    const { startedAt, session, headSha, feature } = row;
    if (typeof startedAt !== 'string' || typeof session !== 'string' || typeof feature !== 'string')
        return null;
    return { startedAt, session, headSha: typeof headSha === 'string' ? headSha : '', feature };
}
const MAX_ROW_BYTES = 512;
const SMALL_CAP = 1024 * 1024;
const LARGE_CAP = 4 * 1024 * 1024;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
/** lastRow reads this much of the file's end: rows are under MAX_ROW_BYTES, so the last row is always inside it. */
const TAIL_BYTES = 4096;
const GIT_TIMEOUT_MS = 2000;
/** git-bin.ts's gitBin, copied (this file imports builtins only): a fixed git, never PATH's (D33); '' when none. */
function gitBin() {
    for (const p of ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git', '/bin/git']) {
        try {
            if (!fs.statSync(p).isFile())
                continue;
            fs.accessSync(p, fs.constants.X_OK);
            return p;
        }
        catch {
            /* missing or not executable: try the next one */
        }
    }
    return '';
}
function gitOut(cwd, args) {
    const env = { ...process.env };
    for (const k of Object.keys(env))
        if (k.startsWith('GIT_'))
            delete env[k];
    env.PATH = '/usr/bin:/bin'; // git's helpers (ssh, pager, hooks) never from the caller's PATH (D33)
    try {
        const out = execFileSync(gitBin(), args, {
            cwd,
            env,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: GIT_TIMEOUT_MS,
        });
        const v = out.replace(/\n$/, '');
        return v === '' ? null : v;
    }
    catch {
        return null;
    }
}
/** First 16 hex of the git blob sha1 of "<toplevel>\n<absolute-git-dir>\n"; null outside a repo. */
export function ledgerKey(cwd) {
    let physical;
    try {
        physical = fs.realpathSync(cwd);
    }
    catch {
        return null;
    }
    const top = gitOut(physical, ['rev-parse', '--show-toplevel']);
    if (top === null)
        return null;
    const gitDir = gitOut(top, ['rev-parse', '--absolute-git-dir']);
    if (gitDir === null)
        return null;
    const content = Buffer.from(`${top}\n${gitDir}\n`, 'utf8');
    return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex').slice(0, 16);
}
function splitRel(relPath) {
    const parts = relPath.split('/');
    for (const p of parts) {
        if (!SEGMENT.test(p) || p.startsWith('.'))
            throw new LedgerError('unsafe_path', relPath);
    }
    return parts;
}
function capFor(parts) {
    return parts[0] === 'results' || parts[0] === 'decisions' ? SMALL_CAP : LARGE_CAP;
}
function checkStat(st, uid, wantDir, where) {
    const kindOk = wantDir ? st.isDirectory() : st.isFile();
    if (st.isSymbolicLink() || !kindOk || st.uid !== uid || (st.mode & 0o077) !== 0) {
        throw new LedgerError('unsafe_path', where);
    }
}
function isErrno(e, code) {
    return e instanceof Error && e.code === code;
}
function parseObject(line) {
    try {
        const v = JSON.parse(line);
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;
    }
    catch {
        return null;
    }
}
/** Throws unsafe_path when cwd is not inside a git repo (no key to bind to). */
export function openLedger(cwd, opts = {}) {
    const key = ledgerKey(cwd);
    if (key === null)
        throw new LedgerError('unsafe_path', 'not a git repo');
    const uid = (opts.getuid ?? (() => (process.getuid ? process.getuid() : -1)))();
    const root = path.join(os.homedir(), '.oss', 'ledger');
    const keyDir = path.join(root, key);
    /** Walks root -> key dir -> parents of the file; creates missing dirs (0700) when asked, checks each. */
    function ensureDirs(dirParts, create) {
        if (create)
            fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
        let cur = root;
        for (const seg of [null, key, ...dirParts]) {
            if (seg !== null)
                cur = path.join(cur, seg);
            let st;
            try {
                st = fs.lstatSync(cur);
            }
            catch (e) {
                if (!isErrno(e, 'ENOENT'))
                    throw e;
                if (!create)
                    return false;
                try {
                    fs.mkdirSync(cur, { mode: 0o700 });
                }
                catch (me) {
                    if (!isErrno(me, 'EEXIST'))
                        throw me;
                }
                st = fs.lstatSync(cur);
            }
            checkStat(st, uid, true, cur);
        }
        return true;
    }
    function filePath(parts) {
        return path.join(keyDir, ...parts);
    }
    /** Opens the file with O_NOFOLLOW and checks it; null when it does not exist and flags lack O_CREAT. */
    function openChecked(parts, flags) {
        const p = filePath(parts);
        let fd;
        try {
            fd = fs.openSync(p, flags | fs.constants.O_NOFOLLOW, 0o600);
        }
        catch (e) {
            if (isErrno(e, 'ENOENT'))
                return null;
            if (isErrno(e, 'ELOOP') || isErrno(e, 'EMLINK'))
                throw new LedgerError('unsafe_path', p);
            throw e;
        }
        try {
            checkStat(fs.fstatSync(fd), uid, false, p);
        }
        catch (e) {
            fs.closeSync(fd);
            throw e;
        }
        return fd;
    }
    function readText(parts) {
        if (!ensureDirs(parts.slice(0, -1), false))
            return null;
        const fd = openChecked(parts, fs.constants.O_RDONLY);
        if (fd === null)
            return null;
        try {
            const size = fs.fstatSync(fd).size;
            if (size > capFor(parts))
                throw new LedgerError('ledger_too_large', filePath(parts));
            return fs.readFileSync(fd, 'utf8');
        }
        finally {
            fs.closeSync(fd);
        }
    }
    function writeFile(parts, data, flags) {
        ensureDirs(parts.slice(0, -1), true);
        const fd = openChecked(parts, fs.constants.O_WRONLY | fs.constants.O_CREAT | flags);
        if (fd === null)
            throw new LedgerError('unsafe_path', filePath(parts));
        try {
            fs.writeSync(fd, data);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    const readRows = (relPath) => {
        const text = readText(splitRel(relPath));
        if (text === null)
            return [];
        const rows = [];
        for (const line of text.split('\n')) {
            const row = parseObject(line);
            if (row !== null)
                rows.push(row);
        }
        return rows;
    };
    return {
        dir: keyDir,
        appendRow(relPath, row) {
            const parts = splitRel(relPath);
            const line = `${JSON.stringify(row)}\n`;
            if (Buffer.byteLength(line) >= MAX_ROW_BYTES)
                throw new LedgerError('too_large', relPath);
            writeFile(parts, line, fs.constants.O_APPEND);
        },
        readRows,
        lastRow(relPath) {
            const parts = splitRel(relPath);
            if (!ensureDirs(parts.slice(0, -1), false))
                return null;
            const fd = openChecked(parts, fs.constants.O_RDONLY);
            if (fd === null)
                return null;
            try {
                const size = fs.fstatSync(fd).size;
                const len = Math.min(size, TAIL_BYTES);
                const buf = Buffer.alloc(len);
                fs.readSync(fd, buf, 0, len, size - len);
                const lines = buf.toString('utf8').split('\n');
                // A tail that starts mid-file starts mid-row: its first line is never a whole row.
                for (let i = lines.length - 1; i >= (len < size ? 1 : 0); i--) {
                    const row = parseObject(lines[i]);
                    if (row !== null)
                        return row;
                }
                return null;
            }
            finally {
                fs.closeSync(fd);
            }
        },
        scanBack(relPath, visit) {
            const parts = splitRel(relPath);
            if (!ensureDirs(parts.slice(0, -1), false))
                return;
            const fd = openChecked(parts, fs.constants.O_RDONLY);
            if (fd === null)
                return;
            try {
                const size = fs.fstatSync(fd).size;
                const floor = Math.max(0, size - capFor(parts));
                let end = size;
                let rest = Buffer.alloc(0);
                while (end > floor) {
                    const start = Math.max(floor, end - TAIL_BYTES);
                    const buf = Buffer.alloc(end - start);
                    fs.readSync(fd, buf, 0, buf.length, start);
                    const all = Buffer.concat([buf, rest]);
                    end = start;
                    // Mid-file, every line after the first newline is whole; the bytes before it join the next (older) chunk.
                    // At the cap they are dropped, as lastRow drops a tail's first line.
                    const cut = start > 0 ? all.indexOf(10) : -1;
                    if (start > 0 && cut < 0) {
                        rest = all;
                        continue;
                    }
                    rest = cut < 0 ? Buffer.alloc(0) : all.subarray(0, cut);
                    const lines = all.subarray(cut + 1).toString('utf8').split('\n');
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const row = parseObject(lines[i]);
                        if (row !== null && !visit(row))
                            return;
                    }
                }
            }
            finally {
                fs.closeSync(fd);
            }
        },
        writeMarker(relPath, obj) {
            writeFile(splitRel(relPath), `${JSON.stringify(obj)}\n`, fs.constants.O_TRUNC);
        },
        readMarker(relPath) {
            const text = readText(splitRel(relPath));
            return text === null ? null : parseObject(text.trim());
        },
        clearMarker(relPath) {
            const parts = splitRel(relPath);
            if (!ensureDirs(parts.slice(0, -1), false))
                return;
            try {
                fs.unlinkSync(filePath(parts));
            }
            catch (e) {
                if (!isErrno(e, 'ENOENT'))
                    throw e;
            }
        },
        hasMarker(relPath) {
            const parts = splitRel(relPath);
            if (!ensureDirs(parts.slice(0, -1), false))
                return false;
            const fd = openChecked(parts, fs.constants.O_RDONLY);
            if (fd === null)
                return false;
            fs.closeSync(fd);
            return true;
        },
    };
}
//# sourceMappingURL=ledger.js.map