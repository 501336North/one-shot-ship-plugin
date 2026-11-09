/**
 * Finds where an absolute path really lands on disk, following symlinks. A path that doesn't
 * exist yet resolves through its deepest existing ancestor, and a symlink whose target doesn't
 * exist yet resolves to that target (writing through it creates the target). Never throws: a
 * path it can't resolve (a symlink loop, say) comes back as given.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface PathResolver {
  realpath(absPath: string): string;
}

/** Symlinks followed through missing targets before giving up, as the kernel's loop limit. */
const MAX_LINKS = 40;

function resolve(absPath: string, links: number): string | null {
  const rest: string[] = [];
  for (let current = absPath; ; current = path.dirname(current)) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch {
      // missing, or a symlink to something missing: follow the link, else try the parent
    }
    let target: string | null = null;
    try {
      target = fs.readlinkSync(current);
    } catch {
      // not a symlink
    }
    if (target !== null) {
      if (links >= MAX_LINKS) return null;
      return resolve(path.resolve(path.dirname(current), target, ...rest), links + 1);
    }
    if (path.dirname(current) === current) return null;
    rest.unshift(path.basename(current));
  }
}

export const realPathResolver: PathResolver = {
  realpath(absPath: string): string {
    return resolve(absPath, 0) ?? absPath;
  },
};
