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
import { HOME_UNKNOWN, plainWriterName, type CommandPart } from '../command-reader.js';
import type { EditCall } from '../edit-call.js';
import type { PathResolver } from '../path-resolver.js';
import { escapeGlob, floatingNames, matchAnyPath, shellGlobMayHold, shellGlobMayMatch, shellGlobTailMatcher, shellPatternMatchesPath, tailMayBeProtected, tailMayHoldProtected, type PathMatchOptions } from '../patterns.js';
import { createTreeFinder, type TreeFinder } from '../tree-finder.js';
import { withoutFirmlink } from '../review-places.js';
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
  reason: 'Refused: writes a path too long for the gate to check (over 4096 characters or 512 folders). To keep long text, write it to a short path with a heredoc (cat > /tmp/notes.md <<EOF … EOF).',
};
const WILDCARD = /[*?]/;

/**
 * The places a glob can be anchored at: as given and as resolved on disk; once when both are the same,
 * so each path is matched once there (round 14: the work per path stays within its budget).
 */
export function placesOf(root: string, home: string, paths: PathResolver, caseInsensitive: boolean): Places[] {
  const given = { home: unfirm(home), root: unfirm(root), caseInsensitive };
  const resolved = { home: unfirm(paths.realpath(home)), root: unfirm(paths.realpath(root)), caseInsensitive };
  return given.home === resolved.home && given.root === resolved.root ? [given] : [given, resolved];
}

/**
 * The path without macOS's data-volume firmlink, in any letter case: `/System/Volumes/Data<path>` is
 * `<path>` (R-266 round 11, SEC HIGH-1).
 */
export function unfirm(p: string): string {
  return withoutFirmlink(p, true);
}

/** The path as written (`..` collapsed as text) and as it really is on disk (from the raw path, `..` kept), firmlink taken off. */
function formsOf(absPath: string, paths: PathResolver): string[] {
  return [...new Set([path.normalize(absPath), paths.realpath(absPath)].map(unfirm))];
}

/**
 * Answers per anchoring, glob list and path form, kept for the call (the gate makes its anchorings
 * once per call): a path both rules check, or named twice, is matched once (round 10, PERF MEDIUM-1).
 */
type Answers = WeakMap<Places, WeakMap<readonly string[], Map<string, boolean>>>;
const protectedAnswers: Answers = new WeakMap();
const holdingAnswers: Answers = new WeakMap();

function answered(store: Answers, at: Places, globs: readonly string[], form: string, decide: () => boolean): boolean {
  let lists = store.get(at);
  if (lists === undefined) {
    lists = new WeakMap();
    store.set(at, lists);
  }
  let answers = lists.get(globs);
  if (answers === undefined) {
    answers = new Map();
    lists.set(globs, answers);
  }
  let answer = answers.get(form);
  if (answer === undefined) {
    answer = decide();
    answers.set(form, answer);
  }
  return answer;
}

export function isProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  const globs = settings.protectedPaths;
  return formsOf(absPath, paths).some((p) => places.some((at) => answered(protectedAnswers, at, globs, p, () => matchAnyPath(globs, p, at))));
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

/** The path made absolute and normalized as path.relative does, lowercased first when case is ignored. */
function comparable(p: string, caseInsensitive: boolean): string {
  return path.resolve(caseInsensitive ? p.toLowerCase() : p);
}

/** Both comparable: `of` is `dir` or lies below it (a prefix test: round 10, PERF MEDIUM-1). */
function atOrBelow(dir: string, of: string): boolean {
  return of === dir || of.startsWith(dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`);
}

/** True when `of` is `dir` or lies below it, as path.relative(dir, of) climbing no `..` says. */
export function isSameOrAncestor(dir: string, of: string, caseInsensitive: boolean): boolean {
  return atOrBelow(comparable(dir, caseInsensitive), comparable(of, caseInsensitive));
}

/** Fixed folders per anchoring and glob list, comparable, made once per call (the gate makes its places once). */
const fixedFolders = new WeakMap<Places, WeakMap<readonly string[], string[]>>();

function fixedFoldersOf(globs: readonly string[], at: Places): string[] {
  let lists = fixedFolders.get(at);
  if (lists === undefined) {
    lists = new WeakMap();
    fixedFolders.set(at, lists);
  }
  let folders = lists.get(globs);
  if (folders === undefined) {
    folders = globs.map((glob) => comparable(fixedFolder(glob, at), at.caseInsensitive === true));
    lists.set(globs, folders);
  }
  return folders;
}

export function holdsProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  const globs = settings.protectedPaths;
  const heads = folderHeadsOf(globs);
  return formsOf(absPath, paths).some((p) =>
    places.some((at) =>
      answered(holdingAnswers, at, globs, p, () => {
        const dir = comparable(p, at.caseInsensitive === true);
        return fixedFoldersOf(globs, at).some((folder) => atOrBelow(dir, folder)) || matchAnyPath(heads, p, at);
      }),
    ),
  );
}

/** The folder heads of each glob list, made once per list. */
const folderHeads = new WeakMap<readonly string[], string[]>();

/**
 * Each glob cut before one of its later segments, where the cut names something (`**\/.git/hooks` and `**\/.git` of
 * `**\/.git/hooks/**`; not `**` alone): a folder one of them matches holds paths the glob matches, even when the
 * glob floats at any depth (R-266 round 21, SEC HIGH-2: `find .git/hooks -exec …`, `rm -rf .git/hooks`).
 */
function folderHeadsOf(globs: readonly string[]): string[] {
  let heads = folderHeads.get(globs);
  if (heads === undefined) {
    heads = [];
    for (const glob of globs) {
      const segments = glob.split('/');
      for (let k = 1; k < segments.length; k++) {
        const head = segments.slice(0, k);
        if (head.some((segment) => !/^\**$/.test(segment))) heads.push(head.join('/'));
      }
    }
    heads = [...new Set(heads)];
    folderHeads.set(globs, heads);
  }
  return heads;
}

/** A shell pattern's folder part before its first wildcard segment, and the rest (null when it has none). */
const PATTERN_SEGMENT = /(?:^|[^\\])[*?[]/;

function splitPattern(pattern: string): { prefix: string; rest: string } | null {
  const segments = pattern.split('/');
  const first = segments.findIndex((segment) => PATTERN_SEGMENT.test(segment));
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
  return prefixForms(pattern, paths).some((form) => places.some((at) => shellGlobMayMatch(form, settings.protectedPaths, at, exemptAnchor, dots)));
}

/** A shell pattern as written and with its fixed folder part resolved on disk, firmlink taken off. */
function prefixForms(pattern: string, paths: PathResolver): string[] {
  const forms = [unfirm(pattern)];
  const split = splitPattern(pattern);
  if (split !== null && !split.prefix.includes('\\')) forms.push(`${escapeGlob(unfirm(paths.realpath(split.prefix)))}/${split.rest}`);
  return [...new Set(forms)];
}

/** Programs that write into a folder named as their destination (cp, mv, ln, install, ditto, rsync syntax). */
const INTO_FOLDER = new Set(['cp', 'mv', 'ln', 'install', 'ditto', 'rsync']);

/** Programs whose write targets are folders they write into or move (INTO_FOLDER, `tar -C`, `unzip -d`): round 18, SEC MEDIUM-3. */
const DESTINATION_FOLDER_WRITERS = new Set([...INTO_FOLDER, 'tar', 'bsdtar', 'unzip', 'mktemp']);


/**
 * True when a write target (a shell pattern) could be a folder whose files are protected, such as
 * `.git/hooks` under `**\/.git/hooks/**`, whose fixed folder is the repo itself: `cp x .git/hooks` and
 * `mv x .gi?/hooks` write into it (R-266 round 14, SEC HIGH-3). Names starting with `.` are left out,
 * or every folder could hold a `.git`.
 */
function mayBeProtectedFolder(pattern: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  return patternReachesProtected(`${pattern}/*`, settings, places, paths, true, false);
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
  const underSetHome = [...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs].find((t) => t.includes(HOME_UNKNOWN));
  if (underSetHome !== undefined) return homeSetRefusal(part);
  const into = INTO_FOLDER.has(plainWriterName(path.basename(part.program ?? '')));
  for (const target of part.writeTargets) {
    if (isTooLong(target)) return TOO_LONG;
    if (isProtected(target, settings, places, paths)) return refusal(target, 'a protected file', root, home);
    if (holdsProtected(target, settings, places, paths) || (into && mayBeProtectedFolder(escapeGlob(target), settings, places, paths))) {
      return refusal(target, 'which holds protected files', root, home);
    }
  }
  for (const pattern of part.writeGlobs) {
    if (isTooLong(pattern)) return TOO_LONG;
    if (patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob) || (into && mayBeProtectedFolder(pattern, settings, places, paths))) {
      return refusal(pattern, 'a wildcard the shell could expand to a protected path', root, home);
    }
  }
  const unknown = unknownWrite(part, settings, places, paths);
  if (unknown !== null) return unknown;
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
  let matchers: ((tail: string) => boolean)[] | null = null;
  for (const target of part.writeTargets) {
    if (!target.startsWith(folder)) continue;
    const tail = escapeGlob(target.slice(folder.length));
    const pattern = `${at}/${tail}`;
    // the folder pattern is matched once and only each written tail after it (round 11, PERF LOW-1);
    // a tail splitPattern could read as a wildcard takes the full check
    let reaches: boolean;
    if (tail.split('/').some((segment) => PATTERN_SEGMENT.test(segment))) {
      reaches = patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob);
    } else {
      matchers ??= prefixForms(at, paths).flatMap((form) => places.map((place) => shellGlobTailMatcher(form, settings.protectedPaths, place, false, part.dotGlob)));
      reaches = matchers.some((reach) => reach(tail));
    }
    if (reaches) {
      return refusal(pattern, `after \`${part.lostDir?.why}\`, a path that could be protected`, root, home);
    }
  }
  return null;
}

/**
 * A write target with a part only known when the command runs (`> "$(x)/y.json"`, `> "$X/config"`) is
 * a path the gate can't know (R-266 round 11, SEC MEDIUM-1; round 12, D-R12-1 "follow or refuse"):
 * refused when what follows the last unknown part could end a protected path (`config`,
 * `.git/config`, `*.json` after `"$X.json"`), or when nothing follows a command substitution.
 * What follows must reach a name a protected path is named by: `"$X/notes.txt"` is allowed, though X
 * itself could name a protected folder (the accepted limit of D-R12-1). A bare variable nothing
 * follows (`> "$X"`) is not refused yet: OSS's own served blocks write that way (round 12, held for
 * the user's call). For a program that writes into, or moves, a folder (cp, mv, ln, install, ditto,
 * rsync, `tar -C`, `unzip -d`), a target whose literal end could be a folder holding protected files
 * is refused too (`"$D"/.claude`, `mv "$X"/.oss …`: round 18, SEC MEDIUM-3; only the end, D-R18-2).
 * A target whose last part names a protected branch or a git pointer file (`"$x/main"`, `"$d/ORIG_HEAD"`)
 * is refused as well, since the unknown part could be `.git/refs/heads` or `.git` (hook-env-refs Task 3).
 */
function unknownWrite(part: CommandPart, settings: GateSettings, places: Places[], paths: PathResolver): Refusal | null {
  const substituted = part.substitutedWrites ?? [];
  // round 18, SEC MEDIUM-3: a destination folder, or a moved source, after an unknown start could be a folder holding protected files
  const into = DESTINATION_FOLDER_WRITERS.has(plainWriterName(part.name ?? ''));
  // round 19, SEC MEDIUM-2: a folder attached to its option (`-C"$D"/.oss`, `-d"$D"/.claude`) is a write target with an unknown part too
  const attached = into ? part.writeTargets.filter((t) => t.includes(UNKNOWN)) : [];
  for (const target of new Set([...substituted, ...(part.unknownWrites ?? []), ...attached])) {
    // a folder changed as a whole is left to nestedProtected and lostTail, which refuse it with their own reasons
    if (part.recursiveTargets.includes(target)) continue;
    // a target written with a wildcard is read as its pattern: `$X?n` ends any name ending in one character and `n` (round 15)
    const pattern = part.writePatterns?.get(target) ?? escapeGlob(target);
    if (part.recursiveGlobs.includes(pattern)) continue;
    const tail = unknownTailOf(pattern);
    if ((part.cleanupWrites ?? []).includes(target) && cleanupMayHold(pattern, tail, part.cwd, settings, places, paths)) {
      return {
        rule: 'protected-path',
        reason: `Refused: a script run later (a \`trap\`, \`emulate -c\` or \`sched\`) removes a folder with a part only known when it runs (a variable), which could hold protected files. Name the folder in full, or keep the unknown part at the start (\`rm -rf "$dir"\`).`,
      };
    }
    // D-R18-2: only the literal end counts for a destination (`"$D"/.claude`); a literal start (`../"$X"`, `~/"$X"/y`) does not
    if (into && tail !== null && places.some((at) => tailMayHoldProtected(tail.replace(/\/+$/, ''), settings.protectedPaths, at, true))) {
      return {
        rule: 'protected-path',
        reason: `Refused: \`${path.basename(part.program ?? '')}\` writes into, or moves, a folder with a part only known when it runs (a variable or \`$(…)\`), which could hold protected files. Write the folder out in full.`,
      };
    }
    if (tail === null) {
      if (!substituted.includes(target) && !literalHeadReaches(pattern, part.cwd, settings, places, paths)) continue;
    } else if (!endsInGitRef(tail, settings) && !places.some((at) => tailMayBeProtected(tail, settings.protectedPaths, at, true, false))) {
      continue;
    }
    return {
      rule: 'protected-path',
      reason: `Refused: \`${path.basename(part.program ?? '')}\` writes a path with a part only known when it runs (a variable or \`$(…)\`), which could be a protected file. Write the path out in full, or set the variable to a plain value earlier in the same command.`,
    };
  }
  return null;
}

/** Git's pointer files: a write to one moves a branch or the repo's HEAD (hook-env-refs Task 3). */
const GIT_POINTER_FILES = ['head', 'orig_head', 'fetch_head', 'packed-refs', 'commondir', 'gitdir'];

/**
 * True when the readable last part after an unknown part (`"$x/main"`, `"$d/HEAD"`) is, in any case, a
 * protected branch's name or a git pointer file: the unknown part could be `.git/refs/heads` or `.git`
 * (hook-env-refs Task 3). A branch named with slashes (`release/x`) counts by its last part only.
 */
function endsInGitRef(tail: string, settings: GateSettings): boolean {
  const last = unescapeGlob(tail.slice(tail.lastIndexOf('/') + 1)).toLowerCase();
  const branches = settings.protectedBranches.map((b) => b.slice(b.lastIndexOf('/') + 1).toLowerCase());
  return GIT_POINTER_FILES.includes(last) || branches.includes(last);
}

/**
 * The part of a write target's pattern after its last unknown part (a tail that starts mid-name, as in
 * `$X.json` or `$X?/x`, may end any name, a dot name included: `*.json`, `*?/x`); null when nothing follows it.
 */
function unknownTailOf(pattern: string): string | null {
  const after = pattern.slice(pattern.lastIndexOf(UNKNOWN) + UNKNOWN.length);
  const rest = after.replace(/^\/+/, '');
  // only wildcards (`"$d"*`, `"$d"/*`) say no more than the bare unknown part (ADR-036)
  if (/^[*?/]*$/.test(rest)) return null;
  return after.startsWith('/') ? rest : `*${rest}`;
}

/**
 * True when a write target that ends in an unknown part after a literal start written in the command
 * (`.oss/tool-gates.$(x)`, `.oss/$X`, `.oss/$X$Y`) could be a protected path: the start before the first
 * unknown part plus `*` could match one (round 15, SEC MEDIUM-A; round 16, CR MEDIUM-1, however many
 * unknown parts follow). A bare unknown start (`"$X"`, `"$X$Y"`: the accepted limit of ADR-036) is not.
 */
function literalHeadReaches(pattern: string, cwd: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  const first = pattern.indexOf(UNKNOWN);
  const folder = `${escapeGlob(cwd)}/`;
  const head = pattern.slice(0, first);
  if (head === folder || head === '/') return false;
  return patternReachesProtected(`${head}*`, settings, places, paths, true, false);
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
/** A write through `~` or `$HOME` in a call that sets HOME: HOME could name a protected folder (R-266 round 3, C). */
function homeSetRefusal(part: CommandPart): Refusal {
  return {
    rule: 'protected-path',
    reason: `Refused: \`${path.basename(part.program ?? '')}\` writes through \`~\` or \`$HOME\` in a call that also sets HOME, so the gate can't tell which folder it writes, a protected one included. Leave HOME alone and write the path out in full.`,
  };
}

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
  const lostIn = (p: string): boolean => part.lostDir !== null && !plainUnderOption(part, p) && below(p, part.cwd) !== null;
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
 * (fix round 4, K2). When the folder is known by no pattern it could itself be a protected folder,
 * so a name only a protected folder's `/**` covers (`out.txt`) is refused too (R-266 round 10).
 */
/** What to do instead of a relative write after a `cd` the gate can't follow (R-266 round 10). */
export const LOST_CD_HINT = 'use the full path, or cd to a plain folder in the same command (`cd src && …`)';

/**
 * True when a recursive delete in a script run later, of a folder with an unknown part (ADR-054), could
 * remove a folder holding protected files (round 17, SEC LOW-1): its literal start + `*` (`~/*`, `../*`;
 * a bare unknown start in the current folder is the ADR-054 carve-out), or `*` + its literal end
 * (`*\/.oss`, `*\/.git/hooks`), could be one. A literal start of `/` alone (`/"$X"`) is exempt like the
 * current folder: it is as strong as a bare `"$X"` (ADR-054), since `"$X"` could hold an absolute path anyway.
 */
function cleanupMayHold(pattern: string, tail: string | null, cwd: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  const head = pattern.slice(0, pattern.indexOf(UNKNOWN));
  if (head !== `${escapeGlob(cwd)}/` && head !== '/' && prefixForms(`${head}*`, paths).some((form) => places.some((at) => shellGlobMayHold(form, settings.protectedPaths, at, true)))) return true;
  return tail !== null && places.some((at) => tailMayHoldProtected(tail, settings.protectedPaths, at, true));
}

/**
 * True for a plain literal write target (no unknown part, no wildcard) after a shell option that can't
 * move the folder by itself (R-266 round 15, D-R14-4): the folder is still known for it.
 */
function plainUnderOption(part: CommandPart, target: string): boolean {
  return part.lostDir?.plainKnown === true && !target.includes(UNKNOWN) && part.writePatterns?.has(target) !== true;
}

function lostTail(part: CommandPart, settings: GateSettings, places: Places[]): Refusal | null {
  const folder = `${part.cwd}/`;
  const patternFolder = escapeGlob(part.cwd);
  // a folder known as a pattern is checked exactly by lostPatternWrite
  const unknownFolder = part.lostDir?.pattern === null;
  const relative = (paths: string[], to: string): string[] => paths.flatMap((p) => {
    const rel = below(p, to);
    return rel === null ? [] : [rel];
  });
  /** Each tail, whether a protected folder's contents count (fix round 4, K3), and whether wildcards match dot entries. */
  const tails: [string, boolean, boolean][] = [
    // a folder known by no pattern could itself be any protected folder, so what its `/**` covers counts too (round 10)
    ...part.writeTargets.filter((t) => t.startsWith(folder) && !plainUnderOption(part, t)).map((t): [string, boolean, boolean] => [escapeGlob(t.slice(folder.length)), unknownFolder, true]),
    // a wildcard, or a whole folder, could cover what any protected folder holds; rm -r and find reach dot entries
    ...relative(part.writeGlobs, patternFolder).map((g): [string, boolean, boolean] => [g, true, part.dotGlob]),
    ...relative(part.recursiveTargets.filter((t) => !plainUnderOption(part, t)), part.cwd).map((t): [string, boolean, boolean] => [everythingBelow(escapeGlob(t)), true, true]),
    ...relative(part.recursiveGlobs, patternFolder).map((g): [string, boolean, boolean] => [everythingBelow(g), true, true]),
  ];
  const tail = tails.find(([t, contents, dots]) => places.some((at) => tailMayBeProtected(t, settings.protectedPaths, at, dots, contents)))?.[0];
  if (tail === undefined) return null;
  return {
    rule: 'protected-path',
    reason: `Refused: writes \`${tail}\` after \`${part.lostDir?.why}\`, in a folder the gate can't follow, where it could be a protected file. Instead, ${LOST_CD_HINT}, or ask the user to run it with \`!\`.`,
  };
}
