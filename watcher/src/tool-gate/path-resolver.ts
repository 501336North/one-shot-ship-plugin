/**
 * Finds where an absolute path really lands on disk. It walks the path one name at a time, as
 * the kernel does: a symlink is followed before the next name is read, so a `..` after a
 * symlinked folder climbs from where the link points, not from where it sits. A name that
 * doesn't exist yet is kept as is (the agent is about to create it), so a symlink whose target
 * doesn't exist yet resolves to that target. Never throws: a path it can't resolve (a symlink
 * loop, say) comes back as given.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface PathResolver {
  /** `absPath` may hold `..`; the result is absolute, with no `..` and no symlinks that exist. */
  realpath(absPath: string): string;
}

/** Symlinks followed before giving up, as the kernel's loop limit. */
const MAX_LINKS = 40;

function names(p: string): string[] {
  return p.split('/').filter((name) => name !== '' && name !== '.');
}

function resolve(absPath: string): string | null {
  let resolved = '/';
  let links = 0;
  const todo = names(absPath);
  for (let name = todo.shift(); name !== undefined; name = todo.shift()) {
    if (name === '..') {
      resolved = path.dirname(resolved);
      continue;
    }
    const next = path.join(resolved, name);
    let target: string | null = null;
    try {
      target = fs.readlinkSync(next);
    } catch {
      // missing, or not a symlink
    }
    if (target === null) {
      resolved = next;
      continue;
    }
    if (++links > MAX_LINKS) return null;
    if (target.startsWith('/')) resolved = '/';
    todo.unshift(...names(target));
  }
  return resolved;
}

export const realPathResolver: PathResolver = {
  realpath(absPath: string): string {
    return resolve(absPath) ?? absPath;
  },
};
