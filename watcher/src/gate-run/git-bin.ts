/**
 * The programs the review check runs, from fixed places only, never from PATH (security CRITICAL-1): a
 * review agent could put a fake git first on PATH that replays a clean answer.
 *   - git on macOS: the real developer git in xcode-select's folder (`xcode-select -p`, run with an empty
 *     environment so DEVELOPER_DIR cannot steer it), not the /usr/bin/git shim, which goes through xcrun
 *     and its cache in the user's temp folder, writable by a review agent (INFO-1);
 *   - git on Linux: /usr/bin/git, else /bin/git.
 * A program is used only when checkedProgram passes: an absolute path where neither it nor any link it
 * goes through (folders resolved physically, so `..` and folder links count) lies in a temp folder, each
 * link and the file itself owned by the user or root, ending in an executable regular file. The same
 * rule as hooks/oss-node.sh's oss_node_ok.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEMP_ROOTS: readonly string[] = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders', '/dev/shm'];
const MAX_HOPS = 8;

function inTemp(file: string): boolean {
  const roots = [...TEMP_ROOTS];
  const tmp = process.env.TMPDIR?.replace(/\/+$/, '');
  if (tmp !== undefined && path.isAbsolute(tmp)) roots.push(tmp);
  return roots.some((root) => file === root || file.startsWith(`${root}/`));
}

function ownerOk(stats: fs.Stats): boolean {
  return stats.uid === 0 || stats.uid === process.getuid?.();
}

/** The path with its folder resolved physically (`..`, folder links), its last part kept; null when the folder is gone. */
function physical(file: string): string | null {
  try {
    return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  } catch {
    return null;
  }
}

/** True when the path is a program the check may run (see above). */
export function checkedProgram(file: string): boolean {
  if (!path.isAbsolute(file)) return false;
  let current = file;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const real = physical(current);
    if (inTemp(path.normalize(current)) || real === null || inTemp(real)) return false;
    const stats = fs.lstatSync(real, { throwIfNoEntry: false });
    if (stats === undefined || !ownerOk(stats)) return false;
    if (!stats.isSymbolicLink()) return stats.isFile() && (stats.mode & 0o111) !== 0;
    current = path.resolve(path.dirname(real), fs.readlinkSync(real));
  }
  return false;
}

/** macOS: <xcode-select -p>/usr/bin/git, or null when xcode-select has no folder. */
function developerGit(): string | null {
  try {
    const dir = execFileSync('/usr/bin/xcode-select', ['-p'], { env: {}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    return path.isAbsolute(dir) ? path.join(dir, 'usr', 'bin', 'git') : null;
  } catch {
    return null;
  }
}

let resolved: string | undefined;

/** The git the check runs (resolved once per process). Throws when there is no checked one. */
export function gitBinary(): string {
  if (resolved !== undefined) return resolved;
  const candidates = process.platform === 'darwin' ? [developerGit()] : ['/usr/bin/git', '/bin/git'];
  const found = candidates.find((file): file is string => file !== null && checkedProgram(file));
  if (found === undefined) throw new Error('no git at a fixed, checked path');
  resolved = found;
  return found;
}

/** The first of the fixed paths that exists (the hooks pick the same one), or the first when none does. */
export function fixedProgram(candidates: readonly string[]): string {
  return candidates.find((file) => fs.existsSync(file)) ?? candidates[0];
}
