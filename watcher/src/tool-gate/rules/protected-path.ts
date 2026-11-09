/**
 * Protected-path rule (US-006): refuses an edit-tool call, or a Bash redirect / `rm` / `mv` /
 * `cp`, that writes a path matching `protectedPaths`. Each path is checked as written (already
 * absolute, `..` resolved) and as it really is on disk (symlinks followed), against the repo
 * root and home both as given and as resolved, so a link can't hide a protected file. A Bash
 * write onto a folder that holds protected files (the fixed folder part of a glob, or one of its
 * ancestors) is refused too: removing the folder removes the protected files in it.
 */

import path from 'node:path';
import type { CommandPart } from '../command-reader.js';
import type { EditCall } from '../edit-call.js';
import type { PathResolver } from '../path-resolver.js';
import { matchPath } from '../patterns.js';
import type { GateSettings } from '../rule-file.js';
import type { Refusal } from './refusal.js';

interface Places {
  home: string;
  root: string;
}

const HOME_PREFIX = '~/';
const WILDCARD = /[*?]/;

/** The places a glob can be anchored at: as given and as resolved on disk. */
function placesOf(root: string, home: string, paths: PathResolver): Places[] {
  return [
    { home, root },
    { home: paths.realpath(home), root: paths.realpath(root) },
  ];
}

/** The path as written and as it really is on disk. */
function formsOf(absPath: string, paths: PathResolver): string[] {
  const written = path.normalize(absPath);
  return [written, paths.realpath(written)];
}

function isProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  return formsOf(absPath, paths).some((p) =>
    places.some((at) => settings.protectedPaths.some((glob) => matchPath(glob, p, at))),
  );
}

/** The absolute folder part of a glob before its first wildcard segment. */
function fixedFolder(glob: string, at: Places): string {
  let full: string;
  if (glob.startsWith(HOME_PREFIX)) full = path.join(at.home, glob.slice(HOME_PREFIX.length));
  else if (path.isAbsolute(glob)) full = path.normalize(glob);
  else full = path.join(at.root, glob);
  const segments = full.split(path.sep);
  const first = segments.findIndex((segment) => WILDCARD.test(segment));
  return first === -1 ? full : segments.slice(0, first).join(path.sep) || path.sep;
}

function isSameOrAncestor(dir: string, of: string): boolean {
  const relative = path.relative(dir, of);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function holdsProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  return formsOf(absPath, paths).some((p) =>
    places.some((at) =>
      settings.protectedPaths.some((glob) => isSameOrAncestor(p, fixedFolder(glob, at))),
    ),
  );
}

/** The path relative to the repo, as `~/…` under home, else in full. */
function displayPath(absPath: string, root: string, home: string): string {
  const written = path.normalize(absPath);
  if (isSameOrAncestor(root, written)) return path.relative(root, written) || '.';
  if (isSameOrAncestor(home, written)) return HOME_PREFIX + path.relative(home, written);
  return written;
}

function refusal(absPath: string, what: string, root: string, home: string): Refusal {
  return {
    rule: 'protected-path',
    reason: `Refused: writes \`${displayPath(absPath, root, home)}\`, ${what}. Ask the user to change it with \`!\`.`,
  };
}

export function checkProtectedPathEdit(
  call: EditCall,
  settings: GateSettings,
  root: string,
  home: string,
  paths: PathResolver,
): Refusal | null {
  if (!isProtected(call.filePath, settings, placesOf(root, home, paths), paths)) return null;
  return refusal(call.filePath, 'a protected file', root, home);
}

export function checkProtectedPathBash(
  part: CommandPart,
  settings: GateSettings,
  root: string,
  home: string,
  paths: PathResolver,
): Refusal | null {
  const places = placesOf(root, home, paths);
  for (const target of part.writeTargets) {
    if (isProtected(target, settings, places, paths)) return refusal(target, 'a protected file', root, home);
    if (holdsProtected(target, settings, places, paths)) {
      return refusal(target, 'which holds protected files', root, home);
    }
  }
  return null;
}
