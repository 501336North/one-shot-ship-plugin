/**
 * The ONE routing rule for model-run CLIs (notify-routing-unify D1). Twin of oss_resolve_project
 * in hooks/oss-safe-path.sh; keep the rules identical.
 *
 * CLAUDE_PROJECT_DIR if set; else the nearest real (not linked) .oss walking up from the cwd, stopping at
 * (and including) the first directory holding a .git entry (no git call), when that .git dir is not the
 * one of this session's pointer (sessionProjectDir); else the pointer; else the walk; else null (the
 * caller uses the global ~/.oss).
 * ~/.oss/current-project is never read: it names whichever session started last.
 */

import * as fs from 'fs';
import * as path from 'path';

export function resolveProjectDir(
  env: Record<string, string | undefined>,
  cwd: string = process.cwd(),
): string | null {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const walked = walk(cwd);
  const fromSession = sessionProjectDir(env);
  // R2-1 (D3): the pointer wins unless the walk finds a .oss in ANOTHER repo (its .git dir is not
  // the pointer project's): session started in product 1, the user now works in product 2.
  if (fromSession !== null && (walked.project === null || walk(fromSession).git === walked.git)) return fromSession;
  return walked.project;
}

/** The nearest real .oss from <start> up to the first dir holding a .git entry (`git`; null = none). */
function walk(start: string): { project: string | null; git: string | null } {
  let dir: string;
  try {
    dir = fs.realpathSync(start);
  } catch {
    return { project: null, git: null };
  }
  let found: string | null = null;
  for (;;) {
    if (found === null && isRealDir(path.join(dir, '.oss'))) found = dir;
    if (exists(path.join(dir, '.git'))) return { project: found, git: dir };
    const up = path.dirname(dir);
    if (up === dir) return { project: null, git: null };
    dir = up;
  }
}

/**
 * This session's pointer ~/.oss/sessions/<CLAUDE_CODE_SESSION_ID>/project (D2), written by the
 * SessionStart hook. Twin of oss_session_project: the id is ^[A-Za-z0-9-]{1,100}$; the sessions
 * folder, the id folder and the file are the user's own and not links; the content is one absolute
 * line naming a folder with a real .oss. Anything else: null.
 */
export function sessionProjectDir(env: Record<string, string | undefined>): string | null {
  const id = env.CLAUDE_CODE_SESSION_ID ?? '';
  const home = env.HOME ?? '';
  if (!/^[A-Za-z0-9-]{1,100}$/.test(id) || !home.startsWith('/')) return null;
  const sessions = path.join(home, '.oss', 'sessions');
  const file = path.join(sessions, id, 'project');
  try {
    const uid = process.geteuid?.();
    const own = (p: string, dir: boolean): boolean => {
      const st = fs.lstatSync(p);
      return (dir ? st.isDirectory() : st.isFile()) && st.uid === uid;
    };
    if (!own(sessions, true) || !own(path.join(sessions, id), true) || !own(file, false)) return null;
    const p = fs.readFileSync(file, 'utf-8').replace(/\n+$/, '');
    // eslint-disable-next-line no-control-regex
    if (!p.startsWith('/') || /[\x00-\x1f\x7f]/.test(p)) return null;
    return isRealDir(path.join(p, '.oss')) ? p : null;
  } catch {
    return null;
  }
}

function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isRealDir(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}
