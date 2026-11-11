/**
 * Protected-path-mention rule (US-006): refuses a Bash part that names a protected path, or a
 * folder holding one, unless its program only reads. The protected-path rule lists the files a
 * part writes for the programs it knows (redirects, `rm`, `cp`, `sed -i` …); this rule covers every
 * other program (`ln`, `rsync`, `tar -C`, `curl -o`, `git rm`, `mkfifo` …) by what it names.
 *
 * - A word names a path when, resolved against the part's directory (`~` expanded; the value
 *   after `=` too, as in `of=x` or `--file=x`), it is protected or holds protected files. The
 *   repo root, home and their ancestors hold everything, so they don't count (`git add .`).
 * - A word only known when the command runs counts when its known start already lies in a
 *   protected folder (`.oss/tool-gates/$X`); otherwise it is skipped.
 * - Interpreters (`python3 -c`, `node -e` …) are read through the string literals of their
 *   script: a literal names a path as a word does, or when it ends with a protected path
 *   (`HOME + '/.claude/settings.json'`). The script file an interpreter or `source` runs is not
 *   written, so running a hook (`bash ~/.oss/hooks/x.sh`) stays allowed.
 * - `git clean` is left to the git-clean rule, which asks git what it would remove.
 */

import path from 'node:path';
import { cpOperands, findStarts, type CommandPart } from '../command-reader.js';
import type { PathResolver } from '../path-resolver.js';
import { escapeGlob, globPathOf, matchAnyPath, tailMayBeProtected } from '../patterns.js';
import { awkFacts, longOption, runsScriptFile } from '../sed-awk.js';
import { joinRaw } from '../raw-path.js';
import type { GateSettings } from '../rule-file.js';
import { MAX_CALL_CHARS, UNKNOWN } from '../tokenize.js';
import { tick } from '../deadline.js';
import {
  displayPath, holdsProtected, isProtected, isSameOrAncestor, isTooLong, patternReachesProtected, placesOf, TOO_LONG, type Places,
} from './protected-path.js';
import type { Refusal } from './refusal.js';

/**
 * Programs that only read the paths they name (a code constant, not a rule value: it is what
 * these programs do). Kept short on purpose: a program not listed is treated as one that may
 * write. `cd` / `pushd` / `popd` only move the shell; later parts are checked in the new folder.
 * `echo` / `printf` only print: a redirect of their output is a write target, which the
 * protected-path rule checks, so the words they print are text, not paths.
 */
const READ_ONLY = new Set([
  'cat', 'less', 'head', 'tail', 'grep', 'rg', 'ls', 'stat', 'file', 'wc', 'diff', 'cmp', 'md5', 'shasum',
  'test', '[', '[[', 'find', 'cd', 'pushd', 'popd', 'jq', 'echo', 'printf',
]);
/**
 * Programs that may run (without being read-only) in a folder holding protected paths, such as
 * `.oss`: every other program there could write a protected file without naming it (`tar xf`,
 * `unzip`, `curl -O`). `mkdir` only creates the folders it names, and those words are still checked.
 */
const SAFE_IN_PROTECTED_FOLDER: ReadonlySet<string> = new Set<string>(['mkdir']);
/** Programs that only create folders: they can't overwrite a file, so only a word that is itself a protected path counts. */
const FOLDER_MAKERS: ReadonlySet<string> = new Set<string>(['mkdir']);
/** git subcommands that only read. */
const GIT_READ_ONLY = new Set(['diff', 'log', 'show', 'status', 'blame', 'ls-files']);
/**
 * git subcommands that write only git's own files (the index), never a work-tree file, so they may
 * run in a folder holding protected paths; the paths they name are still checked.
 */
const GIT_INDEX_ONLY = new Set(['add']);
/** Options that make a read-only program write a file or run a command. */
const WRITING_OPTIONS = new Map<string, string[]>([
  ['find', ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']],
  ['rg', ['--pre']],
  ['file', ['-C', '--compile']],
  ['git', ['--output']],
]);

/** sed reads its files unless it edits them in place (`-i`, BSD `-I`, `--in-place`); the script options take a value. */
const SED_NAMES = new Set(['sed', 'gsed']);
const SED_VALUE_LETTERS = new Set(['e', 'f', 'l']);
const SED_VALUE_LONG = new Set(['--expression', '--file', '--line-length']);
/**
 * awk reads its files unless gawk loads a library (`-i inplace`, `--inc=inplace`, `-l`, `@include`),
 * which can edit them in place.
 */
const AWK_NAMES = new Set(['awk', 'gawk', 'mawk', 'nawk']);

/** True when the sed words switch on in-place editing. */
function sedEditsInPlace(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return false;
    if (a.startsWith('--')) {
      // GNU getopt takes any unambiguous prefix (`--in`, `--in-pl`) for `--in-place`
      if (longOption(a, '--in-place', 3)) return true;
      if (SED_VALUE_LONG.has(a)) i++;
    } else if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (a[j] === 'i' || a[j] === 'I') return true;
        if (SED_VALUE_LETTERS.has(a[j])) {
          if (j === a.length - 1) i++;
          break;
        }
      }
    }
  }
  return false;
}

/**
 * Programs that write files into their working folder without naming them (archive extractors,
 * downloaders): after a `cd` the gate can't follow, they could be writing into a protected folder.
 */
const CWD_WRITERS = new Set(['tar', 'bsdtar', 'gtar', 'unzip', 'cpio', 'pax', '7z', '7za', 'ar', 'wget']);
/** curl options that save the download under its own name in the working folder. */
const CURL_SAVES_HERE = /^(?:--remote-name(?:-all)?|--remote-header-name|--output-dir(?:=.*)?|-(?=[A-Za-z]*[OJ])[A-Za-z]+)$/;

function writesIntoCwd(part: CommandPart, name: string): boolean {
  if (CWD_WRITERS.has(name)) return true;
  return name === 'curl' && part.words.slice(1).some((w) => CURL_SAVES_HERE.test(w));
}

/** Programs that run a script given as a string (`-c` / `-e`) or as a file. */
const INTERPRETERS = new Set(['python', 'python3', 'node', 'perl', 'ruby', 'sh', 'bash', 'zsh', 'osascript', 'deno', 'bun']);
/** Any python (`python3.12`, `python2`). */
const PYTHON = /^python[0-9.]*$/;

function isInterpreter(name: string): boolean {
  return INTERPRETERS.has(name) || PYTHON.test(name);
}
/** Shell builtins that run the file they are given. */
const SCRIPT_RUNNERS = new Set(['source', '.']);
/** An interpreter option whose next word is the script: `-c`, `-e`, `-E`, `--eval`, `-p`, a cluster ending in `c` or `e` (`-lc`, `-ne`). */
const SCRIPT_FLAG = /^(?:-[A-Za-z]*[ceE]|--eval|-p|--print)$/;
/** The quotes a script string literal starts with: '…', "…" (backslash escapes inside) or `…`. */
const QUOTES = new Set(["'", '"', '`']);

/**
 * The start folder of a `find` that deletes, writes or runs a command (`-delete`, `-exec` …), when it
 * is protected or holds protected paths, else null. The repo root and home count here: from them
 * `find . -name tool-gates.json -delete` reaches the protected files without naming them.
 */
function foundPath(part: CommandPart, ctx: Context, dir: string): string | null {
  if (part.name !== 'find') return null;
  const writing = WRITING_OPTIONS.get('find') ?? [];
  if (!part.words.slice(1).some((w) => writing.includes(w))) return null;
  const starts = findStarts(part.words.slice(1)).map((start) => joinRaw(dir, expandTilde(start, ctx.home)));
  return starts.find((p) => isProtected(p, ctx.settings, ctx.places, ctx.paths) || holdsProtected(p, ctx.settings, ctx.places, ctx.paths)) ?? null;
}

interface Context {
  settings: GateSettings;
  places: Places[];
  paths: PathResolver;
  home: string;
}

/** git global options and variables that can make git run a command (`-c diff.external=…`, `GIT_EXTERNAL_DIFF=…`). */
const GIT_COMMAND_SETTINGS = ['-c', '--config-env'];
const GIT_VARIABLE = /^GIT_/;

/** True when this git part carries settings that can make even a read run a command. */
function carriesGitSettings(part: CommandPart): boolean {
  const git = part.git;
  if (git === null) return false;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  return (
    globals.some((w) => GIT_COMMAND_SETTINGS.some((o) => w === o || w.startsWith(`${o}=`))) ||
    part.assignments.some((n) => GIT_VARIABLE.test(n))
  );
}

function isReadOnly(part: CommandPart, name: string): boolean {
  const writing = WRITING_OPTIONS.get(name) ?? [];
  const args = part.words.slice(1);
  if (args.some((w) => writing.some((o) => w === o || w.startsWith(`${o}=`)))) return false;
  if (name === 'git') return part.git !== null && GIT_READ_ONLY.has(part.git.subcommand) && !carriesGitSettings(part);
  // a sed or awk script file is not read, and can edit the files it is given in place (K8)
  if (SED_NAMES.has(name)) return !sedEditsInPlace(args) && !runsScriptFile(name, args);
  if (AWK_NAMES.has(name)) return !awkFacts(args).loads && !runsScriptFile(name, args);
  return READ_ONLY.has(name);
}

/** True when the part may run in a folder holding protected paths: it creates folders or writes only git's index. */
function safeInProtectedFolder(part: CommandPart, name: string): boolean {
  return SAFE_IN_PROTECTED_FOLDER.has(name) || (name === 'git' && part.git !== null && GIT_INDEX_ONLY.has(part.git.subcommand) && !carriesGitSettings(part));
}

function expandTilde(p: string, home: string): string {
  if (p === '~') return home;
  return p.startsWith('~/') ? home + p.slice(1) : p;
}

function isRootOrAbove(absPath: string, places: Places[]): boolean {
  return places.some((at) => {
    const ci = at.caseInsensitive === true;
    return isSameOrAncestor(absPath, at.root, ci) || isSameOrAncestor(absPath, at.home, ci);
  });
}

/**
 * The word's shell pattern (for a word written with an unquoted wildcard), when it could expand to a
 * protected path or a folder holding one, below the repo root and home; else null.
 */
function namedPattern(part: CommandPart, word: string, dir: string, ctx: Context): string | null {
  const glob = part.globs.get(word);
  if (glob === undefined) return null;
  for (const value of valuesOf(glob)) {
    const pattern = globPathOf(value, escapeGlob(dir), ctx.home);
    if (patternReachesProtected(pattern, ctx.settings, ctx.places, ctx.paths, true, part.dotGlob)) return pattern;
  }
  return null;
}

/**
 * The absolute path a word names, when it names a protected one (or, when `folders` is set, a
 * folder holding one); else null.
 */
function namedPath(word: string, dir: string, ctx: Context, folders = true): string | null {
  const unknownAt = word.indexOf(UNKNOWN);
  if (unknownAt !== -1) {
    // Only the known start counts: the unknown text is one name inside the folder it names.
    const known = word.slice(0, unknownAt);
    if (known === '') return null;
    const absPath = joinRaw(dir, expandTilde(known + UNKNOWN, ctx.home));
    return isProtected(absPath, ctx.settings, ctx.places, ctx.paths) ? absPath : null;
  }
  const absPath = joinRaw(dir, expandTilde(word, ctx.home));
  if (isProtected(absPath, ctx.settings, ctx.places, ctx.paths)) return absPath;
  if (!folders) return null;
  const holds = holdsProtected(absPath, ctx.settings, ctx.places, ctx.paths);
  return holds && !isRootOrAbove(path.normalize(absPath), ctx.places) ? absPath : null;
}

/**
 * The path a word (or its value after `=`) names when it is protected or holds protected files,
 * else null; `paths` decides how links are followed (the unreadable rule passes one that reads
 * the text only).
 */
export function protectedPathNamed(
  word: string,
  dir: string,
  settings: GateSettings,
  places: Places[],
  paths: PathResolver,
  home: string,
): string | null {
  const ctx: Context = { settings, places, paths, home };
  for (const value of valuesOf(word)) {
    if (isTooLong(value)) continue;
    const named = namedPath(value, dir, ctx);
    if (named !== null) return named;
  }
  return null;
}

/** The word itself and, for `name=value` / `--option=value`, the value. */
function valuesOf(word: string): string[] {
  const eq = word.indexOf('=');
  return eq === -1 ? [word] : [word, word.slice(eq + 1)];
}

/** The words a part names paths with, and the script strings it runs (interpreters only). */
function wordsOf(part: CommandPart, name: string): { words: string[]; scripts: string[] } {
  const args = part.words.slice(1);
  if (name === 'cp') {
    // cp only reads its sources, and the protected-path rule checks the file it writes
    const { sources, dest } = cpOperands(args);
    const files = new Set([...sources, ...(dest === null ? [] : [dest])]);
    return { words: args.filter((a) => !files.has(a)), scripts: [] };
  }
  const interpreter = isInterpreter(name);
  // `source` and `.` are builtins: the shell finds them by exact name only
  if (!interpreter && !SCRIPT_RUNNERS.has(path.posix.basename(part.program ?? ''))) return { words: args, scripts: [] };
  const words: string[] = [];
  const scripts: string[] = [];
  let scriptSeen = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (interpreter && SCRIPT_FLAG.test(a) && i + 1 < args.length) {
      scripts.push(args[++i]);
      scriptSeen = true;
    } else if (!scriptSeen && !a.startsWith('-')) {
      // the script file it runs, which it reads, not writes; the words after it are arguments
      scriptSeen = true;
    } else {
      words.push(a);
    }
  }
  return { words, scripts };
}

/**
 * The string literals of a script, as written, in one pass (fix part K11): no input makes the scan
 * go over the text more than a few times (a regular expression retried at every later quote was
 * quadratic). A quote with no closing match (an apostrophe in a comment: `# don't`) is an ordinary
 * character, so the literals after it are still read (fix part K12); once one quote of a kind is
 * found unclosed, no later quote of that kind can close, so that kind is not looked for again. Each
 * character is a step of the call's deadline.
 */
function stringLiterals(script: string): string[] {
  const literals: string[] = [];
  const unclosed = new Set<string>();
  let i = 0;
  while (i < script.length) {
    tick();
    const quote = script[i];
    if (!QUOTES.has(quote) || unclosed.has(quote)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < script.length && script[j] !== quote) {
      tick();
      j += quote === '"' && script[j] === '\\' ? 2 : 1;
    }
    if (j >= script.length) {
      unclosed.add(quote);
      i++;
      continue;
    }
    literals.push(script.slice(i + 1, j));
    i = j + 1;
  }
  return literals;
}

/** Each part's script literals, scanned once per call: the size check and the rule both read them. */
const LITERALS = new WeakMap<CommandPart, string[]>();

/** The string literals of an interpreter part's scripts (its `-c` / `-e` text and the scripts fed on stdin); none for other programs. */
function partLiterals(part: CommandPart): string[] {
  const known = LITERALS.get(part);
  if (known !== undefined) return known;
  const literals = part.name === null || !isInterpreter(part.name) ? [] : scriptsOf(part, part.name).flatMap(stringLiterals);
  LITERALS.set(part, literals);
  return literals;
}

/** The scripts an interpreter part runs: from its options, and a heredoc or here-string fed to it (`python3 - <<EOF`, `node <<< …`). */
function scriptsOf(part: CommandPart, name: string): string[] {
  return [...wordsOf(part, name).scripts, ...part.stdinScripts];
}

/** The distinct non-empty string literals of the part's scripts, each once. */
function literalsOf(part: CommandPart): string[] {
  return [...new Set(partLiterals(part).filter((literal) => literal !== ''))];
}

/**
 * True for a glob that can match outside the project root (`~/…`, `**\/…`, an absolute path); a
 * repo-relative glob (`.oss/<file>`) names a path only under the project root.
 */
function matchesOutsideRoot(glob: string): boolean {
  return glob.startsWith('~/') || glob.startsWith('**/') || path.isAbsolute(glob);
}

/**
 * A literal in a script that names a protected path: as a word does, or by ending with one that can
 * lie outside the repo (`HOME + '/.claude/settings.json'`). A repo-relative glob is not matched by its
 * tail, so `HOME + '/.oss/<file>'` (the home folder's own file) is not the repo's.
 */
function namedInScript(literals: string[], dir: string, ctx: Context): string | null {
  const tails = ctx.settings.protectedPaths.filter(matchesOutsideRoot).map((glob) => `**/${glob.startsWith('~/') ? glob.slice(2) : glob}`);
  for (const literal of literals) {
    const named = namedPath(literal, dir, ctx);
    if (named !== null) return named;
    const tail = path.posix.normalize(`/${literal}`);
    if (ctx.places.some((at) => matchAnyPath(tails, tail, at))) return literal;
  }
  return null;
}

/**
 * Most words one Bash call may hold (a reading limit, not a rule value). Each word a path rule
 * checks is looked up on disk, so a longer call could run past the gate's 2 s limit, which allows
 * it; refusing it instead keeps a long list of words from hiding a write. Real commands stay far below.
 */
const MAX_CALL_WORDS = 2048;

/** The characters of the scripts fed to interpreters on stdin (heredocs, here-strings, piped text), which the tokenizer's word count doesn't see. */
function stdinScriptChars(part: CommandPart): number {
  return part.name === null || !isInterpreter(part.name) ? 0 : part.stdinScripts.reduce((n, script) => n + script.length, 0);
}

/**
 * Refuses a call whose parts hold more words than the path rules can check in time. Each part
 * counts at least once (`x=1;` has no words but is still a part), and an interpreter's script
 * literals count as words. The scripts fed to interpreters on stdin count toward the call's text
 * cap (fix part K11), checked first so an oversized one is never scanned; a heredoc another
 * program writes (`cat > notes.txt <<EOF`) is not scanned, so it doesn't count.
 */
export function checkCallSize(parts: CommandPart[]): Refusal | null {
  const chars = parts.reduce((n, part) => n + stdinScriptChars(part), 0);
  if (chars > MAX_CALL_CHARS) {
    return {
      rule: 'protected-path-mention',
      reason: `Refused: this command is too complex for the gate to check (scripts fed on stdin longer than ${MAX_CALL_CHARS / 1024} KB in all); split it into simpler commands.`,
    };
  }
  const words = parts.reduce((n, part) => n + Math.max(1, part.words.length + part.writeTargets.length + partLiterals(part).length), 0);
  if (words <= MAX_CALL_WORDS) return null;
  return {
    rule: 'protected-path-mention',
    reason: `Refused: this command has too many words for the gate to check (over ${MAX_CALL_WORDS}). Split it into shorter commands.`,
  };
}

/**
 * After a `cd` the gate can't follow, a relative word or literal could name a file in any folder, a
 * protected one included: the first one whose relative path could end a protected path (by a name
 * the protected path is named by, as the protected-path rule's tail check does), else null (fix round 4, K2).
 * Programs that may run in a protected folder (`mkdir`, `git add`) are left out, as there.
 */
function lostTailNamed(part: CommandPart, words: string[], ctx: Context): string | null {
  if (part.lostDir === null || part.name === null || safeInProtectedFolder(part, part.name)) return null;
  // A bare name with no `.` or `/` (`config`, `HEAD`) is far more often a word than a file (`git
  // config`, `make config`); the protected-path rule still checks the files a part writes by any name.
  const relative = words.filter(
    (w) => /[./]/.test(w) && !w.startsWith('-') && !w.startsWith('~') && !path.isAbsolute(w) && !w.includes(UNKNOWN),
  );
  const globOf = (w: string): string => part.globs.get(w) ?? escapeGlob(w);
  return relative.find((w) => ctx.places.some((at) => tailMayBeProtected(globOf(w), ctx.settings.protectedPaths, at, part.dotGlob))) ?? null;
}

export function checkProtectedPathMention(
  part: CommandPart,
  settings: GateSettings,
  root: string,
  home: string,
  paths: PathResolver,
  caseInsensitive = false,
  places?: Places[],
): Refusal | null {
  if (part.program === null || part.name === null) return null;
  const { name } = part;
  // sed and awk only read the files they name, but their script can write a file (`w x`, `print > "x"`)
  const readOnly = isReadOnly(part, name);
  if ((readOnly && !SED_NAMES.has(name) && !AWK_NAMES.has(name)) || part.git?.subcommand === 'clean') return null;
  const ctx: Context = { settings, places: places ?? placesOf(root, home, paths, caseInsensitive), paths, home };
  const dir = part.git?.dir ?? part.cwd;
  // A program that writes may write a protected file without naming it when it runs inside a protected folder.
  const here = safeInProtectedFolder(part, name) ? null : namedPath(dir, '/', ctx);
  if (here !== null) {
    return {
      rule: 'protected-path-mention',
      reason: `Refused: \`${name}\` runs in \`${displayPath(here, root, home)}\`, which holds protected paths, and only read-only programs may run there. Ask the user to run it with \`!\`.`,
    };
  }
  const lost = part.lostDir?.pattern ?? null;
  if (lost !== null && patternReachesProtected(lost, settings, ctx.places, paths, true, part.dotGlob)) {
    return {
      rule: 'protected-path-mention',
      reason: `Refused: \`${name}\` runs after \`${part.lostDir?.why}\`, which could be a protected folder, and only read-only programs may run there. Ask the user to run it with \`!\`.`,
    };
  }
  if (readOnly) return null;
  const given = wordsOf(part, name);
  // the values of the variables set for it (`X=.oss/tool-gates.json foo`) count as words it names
  const words = [...given.words, ...part.assignmentValues];
  // a heredoc or here-string fed to an interpreter is its script (`python3 - <<EOF`, `node <<< …`)
  const literals = literalsOf(part);
  // A word or literal too long to check is refused before it is looked up: a long one would be slow.
  if (words.flatMap(valuesOf).some(isTooLong) || literals.some(isTooLong)) return TOO_LONG;
  if (part.lostDir !== null && part.lostDir.pattern === null && writesIntoCwd(part, name)) {
    return {
      rule: 'protected-path-mention',
      reason: `Refused: \`${name}\` writes into its folder after \`${part.lostDir.why}\`, a folder the gate can't follow. Run it after a \`cd\` to a plain path.`,
    };
  }
  const found = foundPath(part, ctx, dir);
  if (found !== null) {
    return {
      rule: 'protected-path-mention',
      reason: `Refused: this \`find\` deletes, writes or runs a command from \`${displayPath(found, root, home)}\`, which holds protected paths. Start it from a folder that holds none, or ask the user to run it with \`!\`.`,
    };
  }
  const named =
    words.flatMap(valuesOf).map((w) => namedPath(w, dir, ctx, !FOLDER_MAKERS.has(name))).find((p) => p !== null) ??
    words.map((w) => namedPattern(part, w, dir, ctx)).find((p) => p !== null) ??
    namedInScript(literals, dir, ctx) ??
    lostTailNamed(part, [...words.flatMap(valuesOf), ...literals], ctx);
  if (named === null) return null;
  const shown = path.isAbsolute(named) ? displayPath(named, root, home) : named;
  return {
    rule: 'protected-path-mention',
    reason: `Refused: \`${name}\` names \`${shown}\`, a protected path, and only read-only programs may. To read it, use the Read tool or \`cat ${shown} | ${name}\`. Ask the user to run it with \`!\`.`,
  };
}
