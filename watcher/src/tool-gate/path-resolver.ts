/**
 * Finds where an absolute path really lands on disk. It walks the path one name at a time, as
 * the kernel does: a symlink is followed before the next name is read, so a `..` after a
 * symlinked folder climbs from where the link points, not from where it sits. A name that
 * doesn't exist yet is kept as is (the agent is about to create it), so a symlink whose target
 * doesn't exist yet resolves to that target. Never throws: a path it can't resolve (a symlink
 * loop, say) comes back as given.
 *
 * Linear in the path's length: the result is built by appending, and below a name that is
 * missing (or too long for the system) nothing can be a link, so no more lookups are made until
 * a `..` climbs back out.
 *
 * A resolver made for one call remembers each lookup and each result, and counts its work: past
 * its limits (names looked up on disk, names walked) it throws OverBudget, since links can make
 * one short word walk thousands of names (fix round 4, K1).
 */

import fs from 'node:fs';
import { OverBudget } from './budget.js';
import { tick } from './deadline.js';

export interface PathResolver {
  /** `absPath` may hold `..`; the result is absolute, with no `..` and no symlinks that exist. */
  realpath(absPath: string): string;
}

/** Symlinks followed before giving up, as the kernel's loop limit. */
const MAX_LINKS = 40;

/** Lookup errors after which nothing below the name exists (file-system facts, not rule values). */
const NOTHING_BELOW = new Set(['ENOENT', 'ENAMETOOLONG', 'ENOTDIR']);

/** The names of `p`, last first, so the walk can pop them. */
function namesReversed(p: string): string[] {
  return p
    .split('/')
    .filter((name) => name !== '' && name !== '.')
    .reverse();
}

function parentOf(resolved: string): string {
  const slash = resolved.lastIndexOf('/');
  return slash <= 0 ? '/' : resolved.slice(0, slash);
}

export interface ResolverLimits {
  /** Most names looked up on disk (each name once per resolver). */
  maxLookups: number;
  /** Most names walked, links' names included. */
  maxSteps: number;
}

const NO_LIMITS: ResolverLimits = { maxLookups: Infinity, maxSteps: Infinity };

/** What the disk says about one name: the link's target (null: not a link), and whether nothing can be below it. */
interface Lookup {
  target: string | null;
  nothingBelow: boolean;
}

type ReadLink = (p: string) => string;

function resolve(absPath: string, lookup: (p: string) => Lookup, step: () => void): string | null {
  let resolved = '/';
  let links = 0;
  /** How many names deep the walk is below a name that doesn't exist (0: on disk). */
  let missingDepth = 0;
  const todo = namesReversed(absPath);
  for (let name = todo.pop(); name !== undefined; name = todo.pop()) {
    step();
    if (name === '..') {
      resolved = parentOf(resolved);
      if (missingDepth > 0) missingDepth--;
      continue;
    }
    const next = resolved === '/' ? `/${name}` : `${resolved}/${name}`;
    if (missingDepth > 0) {
      resolved = next;
      missingDepth++;
      continue;
    }
    const { target, nothingBelow } = lookup(next);
    if (nothingBelow) missingDepth = 1;
    if (target === null) {
      resolved = next;
      continue;
    }
    if (++links > MAX_LINKS) return null;
    if (target.startsWith('/')) resolved = '/';
    todo.push(...namesReversed(target));
  }
  return resolved;
}

/** A resolver for one call, remembering lookups and results; OverBudget past `limits`. */
export function createPathResolver(limits: ResolverLimits = NO_LIMITS, readlink: ReadLink = fs.readlinkSync): PathResolver {
  const lookups = new Map<string, Lookup>();
  const results = new Map<string, string>();
  let steps = 0;
  const step = (): void => {
    tick();
    if (++steps > limits.maxSteps) throw new OverBudget(`it makes the gate walk more than ${limits.maxSteps} path names`);
  };
  const lookup = (p: string): Lookup => {
    const known = lookups.get(p);
    if (known !== undefined) return known;
    if (lookups.size >= limits.maxLookups) throw new OverBudget(`it makes the gate look up more than ${limits.maxLookups} paths on disk`);
    let found: Lookup;
    try {
      found = { target: readlink(p), nothingBelow: false };
    } catch (error) {
      // not a symlink; when it doesn't exist at all, nothing below it can be one either
      found = { target: null, nothingBelow: NOTHING_BELOW.has((error as NodeJS.ErrnoException).code ?? '') };
    }
    lookups.set(p, found);
    return found;
  };
  return {
    realpath(absPath: string): string {
      const known = results.get(absPath);
      if (known !== undefined) return known;
      const resolved = resolve(absPath, lookup, step) ?? absPath;
      results.set(absPath, resolved);
      return resolved;
    },
  };
}

/** Resolves each path afresh (nothing remembered between calls), with no work limit. */
export const realPathResolver: PathResolver = {
  realpath: (absPath) => createPathResolver().realpath(absPath),
};
