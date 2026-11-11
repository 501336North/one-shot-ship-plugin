/**
 * Protected-path rule (US-006): refuses an edit-tool call, or a Bash redirect / `rm` / `mv` /
 * `cp`, that writes a path matching `protectedPaths`. Each path is checked as written (already
 * absolute, `..` collapsed as text) and as it really is on disk (symlinks followed, then `..`
 * climbed from where they point), against the repo
 * root and home both as given and as resolved, so a link can't hide a protected file. A Bash
 * or edit-tool write onto a folder that holds protected files (the fixed folder part of a glob,
 * or one of its ancestors) is refused too: removing or replacing the folder removes the
 * protected files in it. On a case-insensitive file system (macOS, Windows) letter case is
 * ignored, since `.OSS/tool-gates.json` is the same file there; a path too long to check is refused.
 */

import path from 'node:path';
import type { CommandPart } from '../command-reader.js';
import type { EditCall } from '../edit-call.js';
import type { PathResolver } from '../path-resolver.js';
import { escapeGlob, floatingNames, matchAnyPath, shellGlobMayMatch, shellPatternMatchesPath, tailMayBeProtected, type PathMatchOptions } from '../patterns.js';
import { createTreeFinder, type TreeFinder } from '../tree-finder.js';
import { UNKNOWN } from '../tokenize.js';
import type { GateSettings } from '../rule-file.js';
import type { Refusal } from './refusal.js';

export type Places = PathMatchOptions;

const HOME_PREFIX = '~/';

/**
 * Longest path the rule reads (file-system limits, not rule values: PATH_MAX is 4096 on Linux, and
 * no real project nests 512 folders). A longer path is never a legitimate write, so it is refused
 * rather than checked, which keeps every check short.
 */
const MAX_PATH_CHARS = 4096;
const MAX_PATH_SEGMENTS = 512;

/** Over the length the gate checks: refused before any lookup on disk. */
export function isTooLong(p: string): boolean {
  return p.length > MAX_PATH_CHARS || p.split('/').length > MAX_PATH_SEGMENTS;
}

export const TOO_LONG: Refusal = {
  rule: 'protected-path',
  reason: 'Refused: writes a path too long for the gate to check (over 4096 characters or 512 folders).',
};
const WILDCARD = /[*?]/;

/** The places a glob can be anchored at: as given and as resolved on disk. */
export function placesOf(root: string, home: string, paths: PathResolver, caseInsensitive: boolean): Places[] {
  return [
    { home, root, caseInsensitive },
    { home: paths.realpath(home), root: paths.realpath(root), caseInsensitive },
  ];
}

/** The path as written (`..` collapsed as text) and as it really is on disk (from the raw path, `..` kept). */
function formsOf(absPath: string, paths: PathResolver): string[] {
  return [path.normalize(absPath), paths.realpath(absPath)];
}

export function isProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  return formsOf(absPath, paths).some((p) => places.some((at) => matchAnyPath(settings.protectedPaths, p, at)));
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

export function isSameOrAncestor(dir: string, of: string, caseInsensitive: boolean): boolean {
  const relative = caseInsensitive ? path.relative(dir.toLowerCase(), of.toLowerCase()) : path.relative(dir, of);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Fixed folders per anchoring and glob list, made once per call (the gate makes its places once). */
const fixedFolders = new WeakMap<Places, WeakMap<readonly string[], string[]>>();

function fixedFoldersOf(globs: readonly string[], at: Places): string[] {
  let lists = fixedFolders.get(at);
  if (lists === undefined) {
    lists = new WeakMap();
    fixedFolders.set(at, lists);
  }
  let folders = lists.get(globs);
  if (folders === undefined) {
    folders = globs.map((glob) => fixedFolder(glob, at));
    lists.set(globs, folders);
  }
  return folders;
}

export function holdsProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  return formsOf(absPath, paths).some((p) =>
    places.some((at) =>
      fixedFoldersOf(settings.protectedPaths, at).some((folder) => isSameOrAncestor(p, folder, at.caseInsensitive === true)),
    ),
  );
}

/** A shell pattern's folder part before its first wildcard segment, and the rest (null when it has none). */
function splitPattern(pattern: string): { prefix: string; rest: string } | null {
  const segments = pattern.split('/');
  const first = segments.findIndex((segment) => /(?:^|[^\\])[*?[]/.test(segment));
  if (first === -1) return null;
  return { prefix: segments.slice(0, first).join('/') || '/', rest: segments.slice(first).join('/') };
}

/**
 * True when the absolute shell pattern could match a protected path or a folder holding one. The
 * pattern is checked as written and with its fixed folder part resolved on disk (links followed);
 * `exemptAnchor` leaves the repo root, home and their parents out of "holding".
 */
export function patternReachesProtected(
  pattern: string,
  settings: GateSettings,
  places: Places[],
  paths: PathResolver,
  exemptAnchor = false,
  dots = false,
): boolean {
  const forms = [pattern];
  const split = splitPattern(pattern);
  if (split !== null && !split.prefix.includes('\\')) forms.push(`${escapeGlob(paths.realpath(split.prefix))}/${split.rest}`);
  return forms.some((form) => places.some((at) => shellGlobMayMatch(form, settings.protectedPaths, at, exemptAnchor, dots)));
}

/** The path as the agent wrote it (`..` kept): relative to the repo, as `~/…` under home, else in full. */
export function displayPath(absPath: string, root: string, home: string): string {
  if (absPath === root) return '.';
  if (absPath.startsWith(`${root}/`)) return absPath.slice(root.length + 1);
  if (absPath.startsWith(`${home}/`)) return HOME_PREFIX + absPath.slice(home.length + 1);
  return absPath;
}

function refusal(absPath: string, what: string, root: string, home: string): Refusal {
  return {
    rule: 'protected-path',
    reason: `Refused: writes \`${displayPath(absPath, root, home)}\`, ${what}. Ask the user to change it with \`!\`.`,
  };
}

export function checkProtectedPathEdit(
  call: Pick<EditCall, 'filePath'>,
  settings: GateSettings,
  root: string,
  home: string,
  paths: PathResolver,
  caseInsensitive = false,
): Refusal | null {
  if (isTooLong(call.filePath)) return TOO_LONG;
  const places = placesOf(root, home, paths, caseInsensitive);
  if (isProtected(call.filePath, settings, places, paths)) return refusal(call.filePath, 'a protected file', root, home);
  if (holdsProtected(call.filePath, settings, places, paths)) {
    return refusal(call.filePath, 'which holds protected files', root, home);
  }
  return null;
}

export function checkProtectedPathBash(
  part: CommandPart,
  settings: GateSettings,
  root: string,
  home: string,
  paths: PathResolver,
  caseInsensitive = false,
  places: Places[] = placesOf(root, home, paths, caseInsensitive),
  tree: TreeFinder = createTreeFinder(),
): Refusal | null {
  for (const target of part.writeTargets) {
    if (isTooLong(target)) return TOO_LONG;
    if (isProtected(target, settings, places, paths)) return refusal(target, 'a protected file', root, home);
    if (holdsProtected(target, settings, places, paths)) {
      return refusal(target, 'which holds protected files', root, home);
    }
  }
  for (const pattern of part.writeGlobs) {
    if (isTooLong(pattern)) return TOO_LONG;
    if (patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob)) {
      return refusal(pattern, 'a wildcard the shell could expand to a protected path', root, home);
    }
  }
  const lost = part.lostDir === null ? null : lostPatternWrite(part, settings, places, paths, root, home) ?? lostTail(part, settings, places);
  return lost ?? nestedProtected(part, settings, paths, tree, caseInsensitive, root, home);
}

/**
 * After a `cd` the gate knows only as a pattern (a wildcard, or the one folder CDPATH names: K8),
 * a write relative to the folder lands below that pattern: refused when it could be a protected path.
 */
function lostPatternWrite(part: CommandPart, settings: GateSettings, places: Places[], paths: PathResolver, root: string, home: string): Refusal | null {
  const at = part.lostDir?.pattern ?? null;
  if (at === null) return null;
  const folder = `${part.cwd}/`;
  for (const target of part.writeTargets) {
    if (!target.startsWith(folder)) continue;
    const pattern = `${at}/${escapeGlob(target.slice(folder.length))}`;
    if (patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob)) {
      return refusal(pattern, `after \`${part.lostDir?.why}\`, a path that could be protected`, root, home);
    }
  }
  return null;
}

/** `rel` joined with `**`: everything below a folder (the folder itself when `rel` is empty). */
function everythingBelow(rel: string): string {
  return rel === '' ? '**' : `${rel}/**`;
}

/** The path below the folder, `''` for the folder itself, or null when it is not below it. */
function below(p: string, folder: string): string | null {
  if (p === folder) return '';
  return p.startsWith(`${folder}/`) ? p.slice(folder.length + 1) : null;
}

/** The folders from just below `start` down to `found`, itself included. */
function foldersDownTo(start: string, found: string): string[] {
  const rel = found.slice(start.length + 1).split('/');
  return rel.map((_, n) => `${start}/${rel.slice(0, n + 1).join('/')}`);
}

/** A shell pattern's text with its escapes removed (a plain folder). */
function unescapeGlob(pattern: string): string {
  return pattern.replace(/\\(.)/g, '$1');
}

/** A recursive write to a folder only known when it runs: the gate can't search it (fix part K13). */
function unreadableFolder(part: CommandPart): Refusal {
  return {
    rule: 'protected-path',
    reason: `Refused: \`${path.basename(part.program ?? '')}\` changes everything in a folder the gate can't read (a variable or command output). A recursive write must name its folder literally, so the gate can check it holds no .git or other protected file. Write the path out, for example \`/tmp/tmp.abc123\` instead of \`"$d"\`.`,
  };
}

function nestedRefusal(target: string, found: string, root: string, home: string): Refusal {
  return {
    rule: 'protected-path',
    reason: `Refused: removes or changes \`${displayPath(target, root, home)}\` with everything in it, including \`${displayPath(found, root, home)}\`, a protected path. Ask the user to run it with \`!\`.`,
  };
}

/**
 * A recursive delete or permission change (`rm -rf build`, `find build -delete`, `chmod -R`,
 * `rm -rf b*`) reaches everything below the folders it names, so it is refused when one of them
 * holds, on disk, a name a protected pattern matches at any depth (a nested `.git`), fix round 4, K3.
 * Folders under a `cd` the gate can't follow are left to lostTail. The search counts toward the
 * call's work limits.
 */
function nestedProtected(
  part: CommandPart,
  settings: GateSettings,
  paths: PathResolver,
  tree: TreeFinder,
  caseInsensitive: boolean,
  root: string,
  home: string,
): Refusal | null {
  const wanted = floatingNames(settings.protectedPaths, caseInsensitive);
  if (wanted === null) return null;
  const lostIn = (p: string): boolean => part.lostDir !== null && below(p, part.cwd) !== null;
  const realRoot = paths.realpath(root);
  const realHome = paths.realpath(home);
  for (const target of part.recursiveTargets) {
    if (lostIn(target)) continue;
    if (isTooLong(target)) return TOO_LONG;
    if (target.includes(UNKNOWN)) return unreadableFolder(part);
    const [found] = tree.namedBelow(paths.realpath(target), wanted);
    if (found !== undefined) return nestedRefusal(target, found, realRoot, realHome);
  }
  for (const pattern of part.recursiveGlobs) {
    const split = splitPattern(pattern);
    if (split === null || lostIn(unescapeGlob(split.prefix))) continue;
    if (isTooLong(pattern)) return TOO_LONG;
    if (pattern.includes(UNKNOWN)) return unreadableFolder(part);
    const start = paths.realpath(unescapeGlob(split.prefix));
    const real = `${escapeGlob(start)}/${split.rest}`;
    for (const found of tree.namedBelow(start, wanted)) {
      // removed when the wildcard expands to it or to a folder on the way down to it
      const reached = foldersDownTo(start, found).find((p) => shellPatternMatchesPath(real, p, { caseInsensitive }, part.dotGlob));
      if (reached !== undefined) return nestedRefusal(reached, found, realRoot, realHome);
    }
  }
  return null;
}

/**
 * After a `cd` the gate can't follow, a write written relative to the folder could land in any
 * folder, a protected one included: refused when its relative path could end a protected path
 * (`workflow-state.json`, `.claude/settings.local.json`), by a name the protected path is named by
 * (fix round 4, K2). A name only a folder's `/**` covers (`out.txt`) is not refused.
 */
function lostTail(part: CommandPart, settings: GateSettings, places: Places[]): Refusal | null {
  const folder = `${part.cwd}/`;
  const patternFolder = escapeGlob(part.cwd);
  const relative = (paths: string[], to: string): string[] => paths.flatMap((p) => {
    const rel = below(p, to);
    return rel === null ? [] : [rel];
  });
  /** Each tail, whether a protected folder's contents count (fix round 4, K3), and whether wildcards match dot entries. */
  const tails: [string, boolean, boolean][] = [
    ...part.writeTargets.filter((t) => t.startsWith(folder)).map((t): [string, boolean, boolean] => [escapeGlob(t.slice(folder.length)), false, part.dotGlob]),
    // a wildcard, or a whole folder, could cover what any protected folder holds; rm -r and find reach dot entries
    ...relative(part.writeGlobs, patternFolder).map((g): [string, boolean, boolean] => [g, true, part.dotGlob]),
    ...relative(part.recursiveTargets, part.cwd).map((t): [string, boolean, boolean] => [everythingBelow(escapeGlob(t)), true, true]),
    ...relative(part.recursiveGlobs, patternFolder).map((g): [string, boolean, boolean] => [everythingBelow(g), true, true]),
  ];
  const tail = tails.find(([t, contents, dots]) => places.some((at) => tailMayBeProtected(t, settings.protectedPaths, at, dots, contents)))?.[0];
  if (tail === undefined) return null;
  return {
    rule: 'protected-path',
    reason: `Refused: writes \`${tail}\` after \`${part.lostDir?.why}\`, in a folder the gate can't follow, where it could be a protected file. Run it after a \`cd\` to a plain path, or ask the user to run it with \`!\`.`,
  };
}
