/**
 * The ONE routing rule for model-run CLIs (notify-routing-unify D1). Twin of oss_resolve_project
 * in hooks/oss-safe-path.sh; keep the rules identical.
 *
 * CLAUDE_PROJECT_DIR if set, else the nearest real (not linked) .oss walking up from the cwd,
 * bounded by the git toplevel, else null (the caller uses the global ~/.oss).
 * ~/.oss/current-project is never read: it names whichever session started last.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
export function resolveProjectDir(env, cwd = process.cwd()) {
    const fromEnv = env.CLAUDE_PROJECT_DIR;
    if (fromEnv !== undefined && fromEnv !== '')
        return fromEnv;
    let top;
    let dir;
    try {
        dir = fs.realpathSync(cwd);
        const gitEnv = { ...process.env };
        delete gitEnv.GIT_DIR;
        delete gitEnv.GIT_WORK_TREE;
        top = execSync('git rev-parse --show-toplevel', {
            cwd: dir,
            env: gitEnv,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1000,
        }).trim();
    }
    catch {
        return null;
    }
    while (top !== '' && (dir === top || dir.startsWith(top + path.sep))) {
        try {
            if (fs.lstatSync(path.join(dir, '.oss')).isDirectory())
                return dir;
        }
        catch {
            // no .oss here
        }
        const up = path.dirname(dir);
        if (up === dir)
            break;
        dir = up;
    }
    return null;
}
//# sourceMappingURL=project-dir.js.map