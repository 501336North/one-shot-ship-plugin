/**
 * The ONE routing rule for model-run CLIs (notify-routing-unify D1). Twin of oss_resolve_project
 * in hooks/oss-safe-path.sh; keep the rules identical.
 *
 * CLAUDE_PROJECT_DIR if set, else this session's pointer (sessionProjectDir), else the nearest real (not linked) .oss walking up from the cwd,
 * stopping at (and including) the first directory holding a .git entry (no git call), else null (the caller uses the global ~/.oss).
 * ~/.oss/current-project is never read: it names whichever session started last.
 */
import * as fs from 'fs';
import * as path from 'path';
export function resolveProjectDir(env, cwd = process.cwd()) {
    const fromEnv = env.CLAUDE_PROJECT_DIR;
    if (fromEnv !== undefined && fromEnv !== '')
        return fromEnv;
    const fromSession = sessionProjectDir(env);
    if (fromSession !== null)
        return fromSession;
    let dir;
    try {
        dir = fs.realpathSync(cwd);
    }
    catch {
        return null;
    }
    let found = null;
    for (;;) {
        if (found === null && isRealDir(path.join(dir, '.oss')))
            found = dir;
        if (exists(path.join(dir, '.git')))
            return found;
        const up = path.dirname(dir);
        if (up === dir)
            return null;
        dir = up;
    }
}
/**
 * This session's pointer ~/.oss/sessions/<CLAUDE_CODE_SESSION_ID>/project (D2), written by the
 * SessionStart hook. Twin of oss_session_project: the id is ^[A-Za-z0-9-]{1,100}$; the sessions
 * folder, the id folder and the file are the user's own and not links; the content is one absolute
 * line naming a folder with a real .oss. Anything else: null.
 */
export function sessionProjectDir(env) {
    const id = env.CLAUDE_CODE_SESSION_ID ?? '';
    const home = env.HOME ?? '';
    if (!/^[A-Za-z0-9-]{1,100}$/.test(id) || !home.startsWith('/'))
        return null;
    const sessions = path.join(home, '.oss', 'sessions');
    const file = path.join(sessions, id, 'project');
    try {
        const uid = process.geteuid?.();
        const own = (p, dir) => {
            const st = fs.lstatSync(p);
            return (dir ? st.isDirectory() : st.isFile()) && st.uid === uid;
        };
        if (!own(sessions, true) || !own(path.join(sessions, id), true) || !own(file, false))
            return null;
        const p = fs.readFileSync(file, 'utf-8').replace(/\n+$/, '');
        // eslint-disable-next-line no-control-regex
        if (!p.startsWith('/') || /[\x00-\x1f\x7f]/.test(p))
            return null;
        return isRealDir(path.join(p, '.oss')) ? p : null;
    }
    catch {
        return null;
    }
}
function exists(p) {
    try {
        fs.lstatSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function isRealDir(p) {
    try {
        return fs.lstatSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=project-dir.js.map