/**
 * The ONE routing rule for model-run CLIs (notify-routing-unify D1). Twin of oss_resolve_project
 * in hooks/oss-safe-path.sh; keep the rules identical.
 *
 * CLAUDE_PROJECT_DIR if set, else the nearest real (not linked) .oss walking up from the cwd,
 * stopping at (and including) the first directory holding a .git entry (no git call), else null (the caller uses the global ~/.oss).
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
  let dir: string;
  try {
    dir = fs.realpathSync(cwd);
  } catch {
    return null;
  }
  let found: string | null = null;
  for (;;) {
    if (found === null && isRealDir(path.join(dir, '.oss'))) found = dir;
    if (exists(path.join(dir, '.git'))) return found;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
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
