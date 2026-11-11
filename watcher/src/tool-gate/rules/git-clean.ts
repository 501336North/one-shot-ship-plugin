/**
 * Git-clean rule (US-006): refuses a `git clean` only when it would really delete an untracked
 * protected path (or a folder holding one). The gate asks git for a dry run with the same options
 * that choose files (`-d`, `-x`, `-X`, `-e`) and the same pathspecs, from the folder the clean runs
 * in, so git decides what counts exactly as the real clean would. A dry run of the agent's own
 * (`-n`, `--dry-run`) deletes nothing and is allowed.
 *
 * When the gate can't ask (an option it doesn't know, git settings or variables that could change
 * the repository, a folder it can't follow) or git gives no answer, it falls back to refusing any
 * clean whose pathspecs (or folder) can reach a protected folder, the repo root included.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CommandPart } from '../command-reader.js';
import type { GitReader } from '../git-reader.js';
import type { PathResolver } from '../path-resolver.js';
import { joinRaw } from '../raw-path.js';
import type { GateSettings } from '../rule-file.js';
import { UNKNOWN } from '../tokenize.js';
import { floatingNames } from '../patterns.js';
import { longOption } from '../sed-awk.js';
import { createTreeFinder, type TreeFinder } from '../tree-finder.js';
import { displayPath, holdsProtected, isProtected, placesOf, type Places } from './protected-path.js';
import type { Refusal } from './refusal.js';

/** `git clean` options (git syntax): those passed on to the dry run because they choose what goes. */
const CHOOSING_LETTERS = new Set(['d', 'x', 'X']);
/** Letters that only prompt or quieten the clean: dropped from the dry run. `-f` is counted (twice also removes nested repos). */
const OTHER_LETTERS = new Set(['i', 'q']);
/**
 * The long options, each with the shortest prefix git takes for it (git's parse-options reads any
 * unambiguous prefix, fix part K11: `--forc --forc` is `-f -f`). `--no-force` sets the count back to
 * none; `--dry-run` / `-n` and `--no-dry-run`: the last one given wins.
 */
const FORCE_LONG = { full: '--force', shortest: 3 };
const NO_FORCE_LONG = { full: '--no-force', shortest: 6 };
const DRY_RUN_LONG = { full: '--dry-run', shortest: 3 };
const NO_DRY_RUN_LONG = { full: '--no-dry-run', shortest: 6 };
const EXCLUDE_LONG = { full: '--exclude', shortest: 3 };
const OTHER_LONG = [
  { full: '--interactive', shortest: 3 }, { full: '--quiet', shortest: 3 }, { full: '--no-interactive', shortest: 6 }, { full: '--no-quiet', shortest: 6 },
];

/** True when a long option word is `option` or a prefix of it git accepts (`=value` attached allowed). */
function isLong(word: string, option: { full: string; shortest: number }): boolean {
  return longOption(word, option.full, option.shortest);
}

/**
 * How a `git clean` was read: a dry run, an option the gate doesn't know, or what to ask git, and
 * whether `-f` came twice (`nested`: git then removes untracked nested repositories too).
 */
type CleanWords = 'dry-run' | 'unknown' | { options: string[]; pathspecs: string[]; nested: boolean };

function readCleanWords(args: string[]): CleanWords {
  const options: string[] = [];
  const pathspecs: string[] = [];
  let dryRun = false;
  let force = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      pathspecs.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('-') || a === '-') {
      pathspecs.push(a);
    } else if (a.startsWith('--')) {
      if (isLong(a, DRY_RUN_LONG) || isLong(a, NO_DRY_RUN_LONG)) dryRun = isLong(a, DRY_RUN_LONG);
      else if (isLong(a, FORCE_LONG)) force++;
      else if (isLong(a, NO_FORCE_LONG)) force = 0;
      else if (isLong(a, EXCLUDE_LONG) && a.includes('=')) options.push(a);
      else if (isLong(a, EXCLUDE_LONG)) {
        if (i + 1 >= args.length) return 'unknown';
        options.push('-e', args[++i]);
      } else if (!OTHER_LONG.some((o) => isLong(a, o))) return 'unknown';
    } else {
      for (let j = 1; j < a.length; j++) {
        const letter = a[j];
        if (letter === 'n') {
          dryRun = true;
        } else if (letter === 'f') {
          force++;
        } else if (letter === 'e') {
          // `-e` takes the rest of the word, or the next word
          const value = j + 1 < a.length ? a.slice(j + 1) : args[++i];
          if (value === undefined) return 'unknown';
          options.push('-e', value);
          break;
        } else if (CHOOSING_LETTERS.has(letter)) {
          options.push(`-${letter}`);
        } else if (!OTHER_LETTERS.has(letter)) {
          return 'unknown';
        }
      }
    }
  }
  if (dryRun) return 'dry-run';
  // `-f -f` also removes untracked nested repos: the dry run lists them only when given it too
  return { options: force >= 2 ? ['-f', '-f', ...options] : options, pathspecs, nested: force >= 2 };
}

/**
 * git subcommands that leave the index, HEAD and the ignore rules as they are (git syntax): after
 * any other, earlier in the same call, the dry run (asked before the call runs) may be stale.
 */
const LEAVES_INDEX = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'cat-file', 'describe', 'fetch',
  'grep', 'shortlog', 'rev-list', 'for-each-ref', 'show-ref', 'version', 'help',
]);
/** Files that decide what git ignores or tracks (git layout): a write to one makes the dry run stale. */
const IGNORE_FILES = new Set(['.gitignore', 'exclude', 'index']);

/** The earlier part (of the first `count`) that may change what is tracked or ignored, or null. */
function staleningPart(earlier: readonly CommandPart[], count: number): CommandPart | null {
  for (let i = 0; i < count; i++) {
    const part = earlier[i];
    if (part.git !== null && !LEAVES_INDEX.has(part.git.subcommand)) return part;
    if (part.writeTargets.some((t) => IGNORE_FILES.has(path.posix.basename(t)) || t.includes('/.git/'))) return part;
    if (part.writeGlobs.some((g) => g.includes('gitignore') || g.includes('/.git/'))) return part;
  }
  return null;
}

/**
 * The rest of the call around a clean, how to tell a folder holds a repo (for a nested repo `-ff`
 * removes), and the call's folder search, which finds one deeper below a folder git lists (K11).
 */
export interface CleanContext {
  earlier?: readonly CommandPart[];
  count?: number;
  isRepo?: (dir: string) => boolean;
  /** Whether a path git lists is a real folder (not a link): the fs reader. */
  isFolder?: (p: string) => boolean;
  tree?: TreeFinder;
}

/** A real folder on disk, read without following a link (git removes a link itself, not what it points to). */
function onDiskFolder(p: string): boolean {
  try {
    return fs.lstatSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

function holdsRepo(dir: string): boolean {
  try {
    return fs.lstatSync(path.join(dir, '.git'), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/** git pathspec wildcards (git syntax, fnmatch): `*` also crosses `/`. */
const PATHSPEC_WILDCARD = /[*?[\\]/;

/**
 * The folder a pathspec can reach, as far as the gate can tell from its text: the repo root for one
 * only known when it runs or one with magic (`:(glob)…`, `:/`, `:!…`, `:^…`, which can name the
 * top of the repo or everything but a path), else the part before its first wildcard.
 */
function reachOf(pathspec: string, dir: string, root: string, home: string): string {
  if (pathspec.includes(UNKNOWN) || pathspec.startsWith(':')) return root;
  const segments = pathspec.split('/');
  const wild = segments.findIndex((s) => PATHSPEC_WILDCARD.test(s));
  const fixed = wild === -1 ? pathspec : segments.slice(0, wild).join('/');
  return joinRaw(dir, expandTilde(fixed, home));
}

/** git global options before `clean` other than `-C`, or `GIT_*` variables: they may change the repository or run a command. */
function carriesSetup(part: CommandPart, git: NonNullable<CommandPart['git']>): boolean {
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  const other = globals.filter((w, n) => w !== '-C' && globals[n - 1] !== '-C');
  return other.length > 0 || part.assignments.some((name) => name.startsWith('GIT_'));
}

function expandTilde(p: string, home: string): string {
  if (p === '~') return home;
  return p.startsWith('~/') ? home + p.slice(1) : p;
}

export async function checkGitClean(
  part: CommandPart,
  settings: GateSettings,
  root: string,
  home: string,
  paths: PathResolver,
  gitReader: GitReader,
  caseInsensitive = false,
  places: Places[] = placesOf(root, home, paths, caseInsensitive),
  context: CleanContext = {},
): Promise<Refusal | null> {
  const git = part.git;
  if (git === null || git.subcommand !== 'clean') return null;
  const words = readCleanWords(git.args);
  if (words === 'dry-run') return null;
  if (part.lostDir !== null) {
    return {
      rule: 'protected-path',
      reason: `Refused: \`git clean\` runs after \`${part.lostDir.why}\`, in a folder the gate can't follow, so it can't tell what it would remove. Run it after a \`cd\` to a plain path.`,
    };
  }
  const isRepo = context.isRepo ?? holdsRepo;
  const isFolder = context.isFolder ?? onDiskFolder;
  // a nested repo git would remove (`-ff`) takes its protected `.git/config` with it
  const reaches = (p: string): boolean => isProtected(p, settings, places, paths) || holdsProtected(p, settings, places, paths);
  // with `-ff` git lists only the top folder it removes (`t7/`), not a repo deeper in it (`t7/sub/.git`):
  // search below it as for `rm -rf` (K11), within the call's work limits
  const wanted = floatingNames(settings.protectedPaths, caseInsensitive) ?? ((name: string) => name === '.git');
  const tree = context.tree ?? createTreeFinder();
  const nestedBelow = (p: string): boolean => tree.namedBelow(paths.realpath(p.replace(/\/+$/, '')), wanted).length > 0;
  // A word only known when the clean runs can't be handed to git (and could be any path); an
  // earlier part that changes what is tracked or ignored makes the dry run (asked now) stale.
  const stale = staleningPart(context.earlier ?? [], context.count ?? 0) !== null;
  const askable =
    words !== 'unknown' && !stale && ![...words.options, ...words.pathspecs].some((w) => w.includes(UNKNOWN)) && !carriesSetup(part, git);
  const removed = askable ? await gitReader.wouldClean(git.dir, words.options, words.pathspecs) : null;
  if (removed !== null) {
    const nested = words !== 'unknown' && words.nested;
    // a folder is read from the disk: run from a subfolder, git lists one as `./sub`, with no `/` (K12)
    const hit = removed
      .map((p) => ({ p: joinRaw(git.dir, p), listedFolder: p.endsWith('/') }))
      .find(({ p, listedFolder }) => reaches(p) || ((listedFolder || isFolder(p)) && (isRepo(p) || (nested && nestedBelow(p)))))?.p;
    if (hit === undefined) return null;
    return {
      rule: 'protected-path',
      reason: `Refused: \`git clean\` would remove \`${displayPath(hit, root, home)}\`, a protected path or a folder holding one. Ask the user to run it with \`!\`.`,
    };
  }
  const pathspecs = words === 'unknown' ? git.args.filter((a) => !a.startsWith('-')) : words.pathspecs;
  // pathspecs read from a file could name any path
  const fromFile = git.args.some((a) => a.startsWith('--pathspec-from-file'));
  const targets = [
    ...(pathspecs.length === 0 ? [git.dir] : pathspecs.map((p) => reachOf(p, git.dir, root, home))),
    ...(fromFile ? [root] : []),
  ];
  // a clean that may remove nested repos (`-ff`, or options the gate doesn't know) reaches one anywhere below its targets (K11)
  const mayNest = words === 'unknown' || words.nested;
  const reached = targets.find((t) => holdsProtected(t, settings, places, paths) || (mayNest && nestedBelow(t)));
  if (reached === undefined) return null;
  return {
    rule: 'protected-path',
    reason: `Refused: \`git clean\` can reach \`${displayPath(reached, root, home)}\`, which holds protected paths, and the gate can't tell what it would remove. Clean a narrower folder (\`git clean -fd build/\`), or ask the user to run it with \`!\`.`,
  };
}
