/**
 * Command reader for the tool gate.
 *
 * Turns a tokenized shell command into one set of facts per part: the program and its words,
 * the directory it runs in (after `cd`, `( … )` and `git -C`), the files it writes or removes,
 * the hosts it talks to, and whether its result is hidden by a pipe or `|| true`.
 * It looks through wrappers (`sudo`, `env`, `timeout` …) and reads literal `sh -c` / `eval`
 * scripts recursively (ADR-009). The commands a `$( … )`, backtick or `<( … )` substitution runs
 * are parts too, read before the part that uses them; their output is captured, so they count
 * as piped. A `cd`, `git -C` or wrapper directory whose value is unknown leaves the directory
 * as it was. Pure: it never touches the filesystem.
 *
 * What it can't read (ADR-010): a reading limit (nesting, wrappers, the call's word and size
 * budget) stops the read, and the call is refused. Any other piece (a `-c` / `eval` script that
 * is not literal, a syntax error) marks the command unreadable, but every part around it is
 * still read and returned, so the rules still check it.
 */

import { expansionSet } from './expansion-scan.js';
import os from 'node:os';
import path from 'node:path';
import { mayFollow, mayReadEnvironment, neverFollowed, plainMentions, plainMentionsIn, unchangedAfter } from './call-variables.js';
import { escapeGlob, globPathOf } from './patterns.js';
import { joinRaw } from './raw-path.js';
import { tick } from './deadline.js';
import { longOption, scriptFactsOf, type ScriptFacts } from './sed-awk.js';
import { dotsOf, extendedGlobOf, globOf, heredocBodyOf, ReadBudget, sourceOf, tokenize, UNKNOWN, type Token } from './tokenize.js';

/**
 * The reader lost track of the shell's directory before a part (`cd -`, `cd "$D"`, `popd` …): why,
 * as the agent wrote it, and the directory as an absolute shell pattern when it was a wildcard
 * (`cd .oss/tool-gate?`), else null. The part's `cwd` is then the last directory it knew.
 */
export interface LostDir {
  why: string;
  pattern: string | null;
  /**
   * Lost only through a shell option the reader doesn't model that can't move the shell by itself
   * (`set -o vi`, R-266 round 15, D-R14-4): `cwd` is still right for a write target that is a plain
   * literal (no variable, substitution or wildcard); anything else stays as unknown as when lost.
   */
  plainKnown?: boolean;
}

export interface CommandPart {
  /** After stripping leading VAR=value assignments; words[0] is the program. */
  words: string[];
  /** Names of the variables set for this command: `GIT_DIR=x git …`, `env GIT_DIR=x git …`, or `GIT_DIR=x` alone. */
  assignments: string[];
  /** The values of those variables, in the same order (set for this part only, not inherited). */
  assignmentValues: string[];
  /** Exactly words[0], or null when the part has no words. */
  program: string | null;
  /**
   * The program's base name for matching program lists: lowercased on a case-insensitive file
   * system, where `GIT` runs git. Shell builtins (`cd`, `eval`, `export` …) are found by exact name
   * whatever the file system, so the rules compare those with `program`.
   */
  name: string | null;
  /** Absolute directory this part runs in. */
  cwd: string;
  /** Absolute paths this part writes or removes, joined as text: a `..` after a folder name is kept for the disk to resolve. */
  writeTargets: string[];
  /** The heredoc bodies and here-strings fed to this part's stdin: a script, for an interpreter that reads one there. */
  stdinScripts: string[];
  /**
   * The write targets that hold a command substitution (`> "$(x)/y.json"`), joined as text: unknown paths
   * (R-266 round 11, SEC MEDIUM-1). Absent from parts built elsewhere.
   */
  substitutedWrites?: string[];
  /**
   * The write targets that hold any part only known when the command runs, a variable the reader
   * doesn't follow included (`> "$X/config"`), joined as text; only for a command whose variables are
   * followed (the main agent and builders: round 12, D-R12-1). Absent from parts built elsewhere.
   */
  unknownWrites?: string[];
  /** The recursive deletes of a folder with an unknown part in a script run later (ADR-054), also in unknownWrites (round 17). */
  cleanupWrites?: string[];
  /** Absolute shell patterns of the write targets written with an unquoted wildcard (`rm .oss/*`). */
  writeGlobs: string[];
  /**
   * The absolute shell pattern of each write target (as in `writeTargets`) written with an unquoted
   * wildcard, by target: the unknown-tail check reads `$X?n` as a pattern (round 15). Absent from parts built elsewhere.
   */
  writePatterns?: ReadonlyMap<string, string>;
  /**
   * Absolute paths this part removes or changes as a whole, everything below included (`rm -r`,
   * `chmod -R`, `find … -delete`), joined as text; those written with a wildcard are in recursiveGlobs.
   */
  recursiveTargets: string[];
  /** Absolute shell patterns of the folders removed or changed as a whole, written with an unquoted wildcard. */
  recursiveGlobs: string[];
  /** The shell pattern of each word written with an unquoted wildcard, by the word's text. */
  globs: ReadonlyMap<string, string>;
  /** Set when the directory this part runs in is not known for sure. */
  lostDir: LostDir | null;
  /** Lowercased hostnames, without ports. */
  hosts: string[];
  /** `unknownOption`: a global option before the subcommand that the reader doesn't know (read as taking no value). */
  git: { subcommand: string; args: string[]; dir: string; unknownOption?: string } | null;
  /** This part's stdout goes into `|` or `|&`. */
  pipedOut: boolean;
  /** This part is followed by `|| true` or `|| :`. */
  orTrue: boolean;
  /** The operator right after this part's own command is `&&`: what follows runs only if it succeeded. */
  followedByAnd: boolean;
  /** This part runs in the background: a single `&` follows its own command or the `( … )` group holding it. */
  backgrounded: boolean;
  /** The wrappers read through to reach the program (`nohup`, `env` …), by base name, outermost first. */
  wrappers: string[];
  /** Each wrapper's own option words (and env's assignments), in the same order as `wrappers`. */
  wrapperOptions: string[][];
  /** This part's wildcards also match names starting with `.` (dotglob / GLOB_DOTS set earlier in the call, or a `(D)` qualifier). */
  dotGlob: boolean;
  /** It runs with a terminal of its own (under `script`, `unbuffer` or an `expect` spawn), so git starts its pager. */
  terminal: boolean;
  /**
   * Why this part runs or defines a script the gate can't read in full, in this shell or later: a trap,
   * `emulate -c` or `sched` script, or a zsh function defined from text (round 16, SEC HIGH-1). Such a part
   * is risky next to an unreadable piece, as an interpreter is.
   */
  hiddenScript?: string;
}

export interface CommandFacts {
  parts: CommandPart[];
}

/**
 * Unreadable: `limit` when a reading limit stopped the read (`parts` is then empty); otherwise
 * `parts` holds every part that could be read, and `reason` names the first piece that couldn't.
 */
export type ReadResult = CommandFacts | { unreadable: true; reason: string; limit: boolean; parts: CommandPart[] };

/** One call's read: the home folder, the shared word budget, the first piece read past, and the letter-case setting. */
interface Reading {
  home: string;
  budget: ReadBudget;
  unreadable: string | null;
  caseInsensitive: boolean;
  toplevel: ToplevelOf | null;
  /** Reads a script file a program runs (an expect file), or null when it can't be read (K7). */
  readFile: ScriptFileReader | null;
  /** Absolute paths the parts read so far write: a script file written in the same call is not read yet. */
  written: Set<string>;
  /** Script files read this call, by absolute path, and the tokens of each expect text: each read and tokenized once (K8). */
  files: Map<string, string | null>;
  scriptCommands: Map<string, string[][] | null>;
  /** Characters and command separators of expect text scanned so far this call, against MAX_SCRIPT_SCAN (K8). */
  scanned: number;
  /** The folders `cd` searches (the CDPATH the shell starts with), or null when it has none (K8). */
  cdpath: string[] | null;
  /**
   * The call may set CDPATH in a way the reader doesn't follow (`${CDPATH:=x}`, `$((CDPATH=1))`,
   * round 6, sec M-B): every relative `cd` or `pushd` is then read as lost.
   */
  cdpathSetUnseen: boolean;
  /** The call may set TMPDIR (any `TMPDIR` word that is not `$TMPDIR`): then `mktemp` may write anywhere. */
  tmpdirSet: boolean;
  /** The files a `source` / `.` may run without the folder becoming unknown (OSS's own hook folders). */
  trustedSources: TrustedSources;
  /** The text each word was read from, for the words of the texts read here. */
  raw: WeakMap<Token, string>;
  /** The words and redirect targets read through a zsh modifier, subscript or flag (R-266 round 13, CR H-1). */
  opaque: WeakSet<Token>;
  /** The names the call assigns as arrays (`arr=(…)`, `arr+=(…)`, `typeset -a arr=(…)`): their words are only known when it runs (Task 24, ADR-069). */
  arrays: Set<string>;
  /** The words written in the temp folder (`"$TMPDIR"`, `"${TMPDIR:-/tmp}/x"`, no `..`), when the call sets no TMPDIR: a mktemp `-p` folder there (round 22, Task 21). */
  tempHead: WeakSet<Token>;
  /** The environment the gate sees (D-R12-1 item 3). */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * The command's variables are followed (the main agent and builders): then a write target with any
   * unknown part, a variable's included, is an unknown write; else only one a `$(…)` builds (D-R12-1).
   */
  follow: boolean;
}

/**
 * The folders whose files a `source` / `.` may run and still leave the folder known: OSS's own hook
 * folders (`~/.oss/hooks` in each home, the plugin's `hooks`), and whether `$CLAUDE_PLUGIN_ROOT`
 * names the plugin, so `. "$CLAUDE_PLUGIN_ROOT/hooks/x.sh"` is one of them (R-266 round 11).
 */
export interface TrustedSources {
  folders: readonly string[];
  pluginRootVariable: boolean;
}

const NO_TRUSTED_SOURCES: TrustedSources = { folders: [], pluginRootVariable: false };

/** Reads a script file from disk: its text, or null when it is missing, not a regular file or too large. */
export type ScriptFileReader = (absPath: string) => string | null;

/** A program's base name as the file system finds it: lowercased when letter case doesn't matter there. */
function programName(word: string, reading: Reading): string {
  const base = path.posix.basename(word);
  return reading.caseInsensitive ? base.toLowerCase() : base;
}

/** An operator that ends a segment (or a `( … )` group holding it), and the index of the segment after it. */
interface Exit {
  op: string | null;
  following: number;
}

interface Segment {
  words: string[];
  /** Names of the leading `VAR=value` words, which `words` no longer holds, and their values. */
  assignments: string[];
  assignmentValues: string[];
  /** `body`: what a heredoc feeds on stdin. */
  redirects: { op: string; target: string; body?: string }[];
  /** The shell pattern of each word or redirect target written with an unquoted wildcard. */
  globs: Map<string, string>;
  /**
   * Where the segment's words hold a command substitution (other than the repo's top folder or a new
   * temp file), by index in `words`, and the redirect targets that do: unknown paths (round 11).
   */
  substituted: Marked;
  /** As `substituted`, for any unknown part, a variable's included: only when the command's variables are followed (round 12). */
  unknown: Marked;
  cwd: string;
  lostDir: LostDir | null;
  /** The segment's own exit first, then those of the `( … )` groups it sits in. */
  exits: Exit[];
  /** The tokens of each command or process substitution in the segment's words and redirects. */
  scripts: Token[][];
  /** Its patterns may also match dot entries (`shopt -s dotglob` earlier, or a `*(D)` qualifier). */
  dotGlob: boolean;
  /** What a pipe feeds its stdin: the segment before it, 'unknown' (a group), or null (no pipe). */
  pipedFrom: Segment | 'unknown' | null;
  /** The token of each word in `words`. */
  wordTokens: Token[];
}

/** How a wrapper program's options are read before the program it runs. */
interface WrapperSpec {
  /** Options that take a value (`-u root`, `-uroot`, `--user=root`). */
  values: string[];
  /** Options whose value is the directory the program runs in. */
  dir?: string[];
  /** Options whose value is split into the program's words (`env -S`). */
  split?: string[];
  /** `VAR=value` words are skipped. */
  assignments?: boolean;
  /** Words to skip after the options (`timeout 10`). */
  operands?: number;
  /** Options whose value is a shell command it runs, read like `sh -c` (`script -c 'cmd'`). */
  shell?: string[];
  /** It gives the program a terminal of its own (`script`, `unbuffer`). */
  terminal?: boolean;
  /** Its skipped operands are files it writes (`script`'s log, `flock`'s lock file: K7). */
  writesOperands?: boolean;
  /** The file it writes in its folder when given none (`script`: `typescript`). */
  defaultWrite?: string;
  /** Its words after the file are not a command it runs (util-linux `script` takes one file only). */
  noCommandOperands?: boolean;
  /**
   * Another platform's reading of the same program (`script`: macOS and util-linux take different
   * options, fix round 4, K8). Both readings are read, so a command either one runs is checked.
   */
  alternate?: WrapperSpec;
}

/**
 * `script` as util-linux reads it: `script [options] [file]`, a command only through `-c`; `-t`
 * and `--timing` take a file only attached (`-tfile`, `--timing=file`), so alone they take no value.
 */
const UTIL_LINUX_SCRIPT: WrapperSpec = {
  values: ['-c', '--command', '-E', '--echo', '-I', '--log-in', '-O', '--log-out', '-B', '--log-io', '-T', '--log-timing',
    '-m', '--logging-format'],
  shell: ['-c', '--command'], operands: 1, terminal: true, writesOperands: true, defaultWrite: 'typescript', noCommandOperands: true,
};

const WRAPPERS = new Map<string, WrapperSpec>([
  ['env', {
    values: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
    dir: ['-C', '--chdir'], split: ['-S', '--split-string'], assignments: true,
  }],
  ['sudo', {
    values: ['-u', '--user', '-g', '--group', '-C', '--close-from', '-D', '--chdir', '-h', '--host', '-p', '--prompt',
      '-r', '--role', '-t', '--type', '-T', '--command-timeout', '-U', '--other-user'],
    dir: ['-D', '--chdir'], assignments: true,
  }],
  ['command', { values: [] }],
  ['builtin', { values: [] }],
  // zsh precommand modifiers: they run the command that follows
  ['noglob', { values: [] }],
  ['nocorrect', { values: [] }],
  ['-', { values: [] }],
  ['nice', { values: ['-n', '--adjustment'] }],
  ['nohup', { values: [] }],
  // zsh's `repeat N cmd` runs cmd N times (round 16, CR LOW-1)
  ['repeat', { values: [], operands: 1 }],
  ['time', { values: ['-f', '--format', '-o', '--output'] }],
  ['xargs', { values: ['-a', '--arg-file', '-d', '--delimiter', '-E', '-I', '-L', '--max-lines', '-n', '--max-args',
    '-P', '--max-procs', '-s', '--max-chars'] }],
  ['exec', { values: ['-a'] }],
  ['doas', { values: ['-u', '-C'] }],
  ['stdbuf', { values: ['-i', '--input', '-o', '--output', '-e', '--error'] }],
  ['timeout', { values: ['-s', '--signal', '-k', '--kill-after'], operands: 1 }],
  // fix round 4, K6/K8: `script [-aeFkqr] [-t time] [file [cmd…]]` (macOS, BSD), read as util-linux too
  ['script', {
    values: ['-t', '-T'], operands: 1, terminal: true, writesOperands: true, defaultWrite: 'typescript', alternate: UTIL_LINUX_SCRIPT,
  }],
  ['unbuffer', { values: [], terminal: true }],
  ['faketime', { values: ['--date-prog'], operands: 1 }],
  ['caffeinate', { values: ['-t', '-w'] }],
  ['ionice', { values: ['-c', '--class', '-n', '--classdata', '-p', '--pid', '-P', '--pgid', '-u', '--uid'] }],
  ['chrt', { values: ['-T', '--sched-runtime', '-P', '--sched-period', '-D', '--sched-deadline'], operands: 1 }],
  ['flock', {
    values: ['-w', '--wait', '--timeout', '-E', '--conflict-exit-code', '-c', '--command'], shell: ['-c', '--command'], operands: 1, writesOperands: true,
  }],
]);

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
/** Shell options that take the next word as their value; in a cluster (`-eo`), each such letter takes one. */
const SHELL_VALUE_OPTIONS = new Set(['-o', '-O', '--rcfile', '--init-file']);
const SHORT_OPTION_CLUSTER = /^[-+][A-Za-z0-9]+$/;
/** `-o` / `-O` with an option name attached (`-oglobdots`, zsh): at least two letters after it. */
const ATTACHED_OPTION_NAME = /^[-+][oO][A-Za-z_]{2,}$/;
/** A shell flag cluster that includes `c` (`-c`, `-lc`, `-ec`; a digit flag too, zsh's `-4c`: fix part K11). */
const COMMAND_STRING_FLAG = /^-[A-Za-z0-9]*c/;
/** A script that substitutes a command or expands a variable or a positional or special parameter is not literal. */
const DYNAMIC_SCRIPT = /\$\(|`|\$[A-Za-z_{0-9@*#?!$-]/;
const MAX_NESTED_DEPTH = 5;
/**
 * Reading limits (not rule values): `{ … }` / `( … )` groups nested deeper, or more wrappers in a
 * row, are unreadable. Real commands never come close, and the caps keep reading linear.
 */
const MAX_GROUP_DEPTH = 64;
const MAX_WRAPPERS = 64;
const PIPES = ['|', '|&'];
/** Reserved words that start or end a compound command; skipped where a command starts. */
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', '!']);
/** Words before `cd` (or `setopt` …) that still run the shell's own builtin: zsh's precommand modifiers too (round 15, CR HIGH-1). */
const CD_PREFIXES = new Set(['command', 'builtin', 'time', 'noglob', 'nocorrect', '-']);

/** A reading limit: the read stops and the call is refused as too complex to check. */
class ReadingLimit extends Error {}

/** Redirects that write their target: `>`, `>>`, `<>`, the clobber forms (`>|`, `>!` …) and `&>`, `>&!` … (bash and zsh). */
const OUTPUT_REDIRECT = /^[0-9]*(?:>>?[|!]?|<>)$|^&>>?[|!]?$|^>>?&[|!]$/;
/** `&1`, `&2-`, `&-`: duplicates or closes another output; not a file. */
const FD_DUPLICATION = /^&(?:[0-9]+-?|-)$/;
/**
 * A shell assignment word (bash and zsh syntax): `NAME=v`, an append `NAME+=v`, an array element
 * `NAME[i]=v` / `NAME[i]+=v` (fix part K11: these are assignments too, not a program).
 */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\n]{0,256}?\](?=\+?=))?\+?=/;
/** The index may itself hold `[ ]` (`CDPATH[X[0]]=x`): it ends at the first `]` an `=` or `+=` follows (round 11, CR HIGH-B). */
const ASSIGNMENT_PARTS = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\n]{0,256}?)\](?=\+?=))?(\+?)=/;

/** An assignment word's variable name, the array index it sets (or null), whether it appends, and its value. */
function assignmentOf(word: string): { name: string; index: string | null; append: boolean; value: string } | null {
  const match = ASSIGNMENT_PARTS.exec(word);
  if (match === null) return null;
  return { name: match[1], index: match[2] ?? null, append: match[3] === '+', value: word.slice(match[0].length) };
}
const URL_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;
const USER_AT_HOST = /^[^@/\s]+@([^:/\s]+)/;
/** A bare dotted hostname, alone or followed by a path (`api.example.com/x`, as HTTPie takes it). */
const BARE_HOST = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?:\/|$)/;
/** git subcommands that send refs to a remote as `git push` does (git syntax): read as a push. */
const PUSH_LIKE = new Set(['send-pack', 'http-push']);
/** The programs git runs for a push (in its exec path), run directly: read as `git push`. */
const PUSH_PROGRAMS = new Set(['git-push', 'git-send-pack', 'git-http-push']);
/** `git subtree` options that take the next word as their value (git-subtree syntax). */
const SUBTREE_VALUE_OPTIONS = new Set(['-P', '--prefix', '-m', '--message', '-b', '--branch', '--onto']);
/**
 * git global options that take the next word as their value (git 2.54 `git --help`, checked by
 * running them). `--exec-path`, `--list-cmds` and `--super-prefix` take theirs only after `=`;
 * alone, git prints or stops, so skipping a word after them never hides a command that runs.
 */
const GIT_VALUE_OPTIONS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--attr-source', '--shallow-file',
  '--exec-path', '--list-cmds', '--super-prefix',
]);
/** git global options that take no value (git 2.54 `git --help`). Any other option is unknown to the reader. */
const GIT_FLAG_OPTIONS = new Set([
  '-v', '--version', '-h', '--help', '-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--no-lazy-fetch',
  '--no-optional-locks', '--no-advice', '--bare', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
  '--icase-pathspecs', '--html-path', '--man-path', '--info-path',
]);

/**
 * Where `git rev-parse --show-toplevel` leads from a folder (the top of the repo holding it), or
 * null when it isn't known. The reader itself never touches the disk, so the gate passes this in.
 */
export type ToplevelOf = (dir: string) => string | null;

/**
 * `caseInsensitive`: the file system ignores letter case (macOS, Windows), so `GIT` runs git.
 * `toplevel`: lets a word that is exactly `$(git rev-parse --show-toplevel)` be read as that folder.
 * `cdpath`: the CDPATH the shell starts with (the gate's own), which `cd` searches.
 */
/**
 * The home folder of a call that sets HOME (R-266 round 3, C): only known when it runs, so `~` and
 * `$HOME` in it never read as the real home. Holds UNKNOWN, so every rule treats it as unknown.
 */
export const HOME_UNKNOWN = `${UNKNOWN}~`;

/**
 * True when the command may set HOME anywhere (`HOME=x`, `export HOME`, `read HOME`, `for HOME in` …):
 * any `HOME` word that is not an expansion of it (`$HOME`, `${HOME}`).
 */
function setsHome(cmd: string): boolean {
  return /(^|[^$\w{])HOME\b/.test(cmd);
}

/**
 * True when CDPATH (or zsh's cdpath) is set by an expansion (`${CDPATH:=x}`, `${CDPATH=x}`,
 * `${CDPATH::=x}`) or in arithmetic (`$((CDPATH=1))`, `((CDPATH=1))`): a linear search (round 8),
 * only when the text names it at all.
 */
function cdpathSetUnseen(cmd: string): boolean {
  return /cdpath/i.test(cmd) && expansionSet(cmd, (name) => name === 'CDPATH' || name === 'cdpath') !== null;
}

export function readCommand(
  cmd: string,
  cwd: string,
  home: string,
  caseInsensitive = false,
  toplevel?: ToplevelOf,
  readFile?: ScriptFileReader,
  cdpath?: string,
  /** Follow the command's own variables (D-R11-1): only when the caller says so, never for a review agent (round 12, CR L4). */
  follow = false,
  trustedSources: TrustedSources = NO_TRUSTED_SOURCES,
  /** The environment the gate sees: a variable the command never sets is read here when followed (D-R12-1 item 3). */
  env: Readonly<Record<string, string | undefined>> = {},
): ReadResult {
  const reading: Reading = {
    home: setsHome(cmd) ? HOME_UNKNOWN : home, budget: new ReadBudget(), unreadable: null, caseInsensitive, toplevel: toplevel ?? null, readFile: readFile ?? null, written: new Set(),
    files: new Map(), scriptCommands: new Map(), scanned: 0,
    cdpath: cdpath === undefined ? null : compactCdpath(cdpath.split(':')),
    cdpathSetUnseen: cdpathSetUnseen(cmd),
    tmpdirSet: /(^|[^$\w{])TMPDIR\b/.test(cmd),
    trustedSources: sourcesFor(cmd, trustedSources),
    raw: new WeakMap(),
    opaque: new WeakSet(),
    arrays: new Set(),
    tempHead: new WeakSet(),
    env,
    follow,
  };
  try {
    const parts = readTokens(tokensOf(cmd, reading), cwd, reading, 0, false, follow ? cmd : null);
    return reading.unreadable === null ? { parts } : { unreadable: true, reason: reading.unreadable, limit: false, parts };
  } catch (err) {
    if (err instanceof ReadingLimit) return { unreadable: true, reason: err.message, limit: true, parts: [] };
    throw err;
  }
}

/** The tokens of a script; a reading limit stops the read, anything else unreadable is read past. */
function tokensOf(cmd: string, reading: Reading): Token[] {
  const result = tokenize(cmd, reading.home, reading.budget);
  if ('unreadable' in result) {
    if (result.limit) throw new ReadingLimit(result.reason);
    reading.unreadable ??= result.reason;
  }
  for (const token of result.tokens) {
    const at = token.kind === 'word' ? sourceOf(token) : undefined;
    if (at !== undefined) reading.raw.set(token, cmd.slice(at.start, at.end));
  }
  addArrayNames(result.tokens, reading.arrays);
  if (modifiedVariable(cmd) || readsArray(cmd, reading.arrays)) markOpaque(result.tokens, cmd, reading.opaque, reading.arrays);
  if (!reading.tmpdirSet) markTempHeads(result.tokens, cmd, reading.tempHead);
  return result.tokens;
}

/** Marks each word, in any substitution too, written in the temp folder with no `..` (round 22, Task 21). */
function markTempHeads(tokens: Token[], cmd: string, tempHead: WeakSet<Token>): void {
  for (const token of tokens) {
    if (token.kind !== 'word') continue;
    if (token.scripts !== undefined) for (const script of token.scripts) markTempHeads(script, cmd, tempHead);
    const at = sourceOf(token);
    const raw = at === undefined ? '' : cmd.slice(at.start, at.end).replaceAll('"', '');
    if (MKTEMP_IN_TMPDIR.test(raw) && !raw.includes('..')) tempHead.add(token);
  }
}

/**
 * A variable read through more than its value (R-266 round 13, CR H-1), outside single quotes: zsh's
 * `$X:h` / `$X[…]` (a modifier or subscript), `$~X` / `$=X` / `$^X` / `$+X` / `$#X` (flags), and
 * `${X:…}` / `${X[…]}` in either shell, and the colon-less `${X-…}` / `${X=…}` / `${X?…}` / `${X+…}` (Task 24, ADR-069). Its value is not modelled: the word is unknown from there on.
 */
const MODIFIED_VARIABLE = /\$(?:[~=^+#]+\{?[A-Za-z_0-9@*#?!$-]|(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?!$-])[:[]|\{[~=^+#]*(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?!$-])[:[=?+-])/;
/** Exactly one variable with one subscript (`"$X[1,-1]"`): a bare variable, the accepted limit of ADR-036. */
const BARE_SUBSCRIPT = /^"?\$([A-Za-z_][A-Za-z0-9_]*)\[[^\]"$`\\]*\]"?$/;

/** The text with its single-quoted pieces (outside double quotes) and backslash escapes left out. */
function expandedText(text: string): string {
  let out = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') {
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else {
      if (c === '"') quote = quote === '"' ? null : '"';
      out += c;
    }
  }
  return out;
}

/** True when the text reads a variable through a zsh modifier, subscript or flag, or `${X:…}` / `${X[…]}`. */
function modifiedVariable(text: string): boolean {
  return MODIFIED_VARIABLE.test(expandedText(text));
}

/** A variable read as `$NAME` or `${NAME…`. */
const VARIABLE_READ = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;
/** A word `name=` or `name+=`, which the tokenizer ends right before an array's `(`. */
const ARRAY_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=$/;

/** Adds each name a word `name=` or `name+=` right before `(` assigns as an array, in any substitution too (Task 24, ADR-069). */
function addArrayNames(tokens: Token[], arrays: Set<string>): void {
  tokens.forEach((token, n) => {
    if (token.kind !== 'word') return;
    if (token.scripts !== undefined) for (const script of token.scripts) addArrayNames(script, arrays);
    const next = tokens[n + 1];
    const name = ARRAY_ASSIGNMENT.exec(token.value)?.[1];
    if (name !== undefined && next?.kind === 'op' && next.value === '(') arrays.add(name);
  });
}

/** True when the text reads, outside single quotes, a variable the call assigns as an array. */
function readsArray(text: string, arrays: Set<string>): boolean {
  if (arrays.size === 0) return false;
  return [...expandedText(text).matchAll(VARIABLE_READ)].some((m) => arrays.has(m[1]));
}

/**
 * Marks each word and redirect target written with a modified variable (a bare subscript of a variable
 * the shell doesn't keep excepted), or reading an array the call assigns (Task 24, ADR-069). One read without its own text (a brace expansion's words) is
 * marked when the text holds one anywhere: fail closed.
 */
function markOpaque(tokens: Token[], cmd: string, opaque: WeakSet<Token>, arrays: Set<string>): void {
  for (const token of tokens) {
    tick();
    if (token.kind === 'op') continue;
    if (token.scripts !== undefined) for (const script of token.scripts) markOpaque(script, cmd, opaque, arrays);
    if (token.kind === 'redirect' && (token.op === '<<' || token.op === '<<-')) continue;
    const at = sourceOf(token);
    const raw = at === undefined ? null : cmd.slice(at.start, at.end);
    if (raw === null) {
      opaque.add(token);
      continue;
    }
    const bare = BARE_SUBSCRIPT.exec(raw);
    if ((modifiedVariable(raw) && (bare === null || neverFollowed(bare[1]))) || readsArray(raw, arrays)) opaque.add(token);
  }
}

/** What stays known of a word read through a modified variable: its plain start, then the unknown rest. */
function opaqueValue(value: string, raw: string | undefined): string {
  if (value.includes(UNKNOWN)) return value.slice(0, value.indexOf(UNKNOWN)) + UNKNOWN;
  const start = (raw ?? '').split('$')[0].replaceAll('"', '');
  return (/^[A-Za-z0-9_./@+,=-]*$/.test(start) ? start : '') + UNKNOWN;
}

/** Any way a call could set CLAUDE_PLUGIN_ROOT: the bare name (an assignment, export, read …), `${CLAUDE_PLUGIN_ROOT:=…}`, or eval. */
const PLUGIN_ROOT_SET = /(?:^|[^${\w])CLAUDE_PLUGIN_ROOT\b|\$\{CLAUDE_PLUGIN_ROOT:?[=?]|\beval\b/;
/** `"$CLAUDE_PLUGIN_ROOT/hooks/<file>"` as written, braces and quotes optional. */
const PLUGIN_HOOK_WORD = /^(["']?)\$(?:CLAUDE_PLUGIN_ROOT|\{CLAUDE_PLUGIN_ROOT\})\/hooks\/([A-Za-z0-9_][A-Za-z0-9._-]*)\1$/;

/**
 * True when a `source` / `.` of this word runs one of OSS's own hook files: a full or `~/` path with
 * no `.` or `..` part and no pattern under a trusted hook folder, or `$CLAUDE_PLUGIN_ROOT/hooks/<file>`
 * when the call can't set that variable. Any other sourced file may move the shell.
 */
function trustedSource(token: Token | undefined, reading: Reading): boolean {
  if (token === undefined || token.kind !== 'word') return false;
  return trustedSourceWord(token.value, reading.raw.get(token), reading.home, reading.trustedSources);
}

/** `trustedSource` for a word read elsewhere: its value, the text it was read from, the call's home and trusted sources (as `sourcesFor` gives them). */
export function trustedSourceWord(word: string, raw: string | undefined, home: string, trustedSources: TrustedSources): boolean {
  if (word.includes(UNKNOWN)) return trustedSources.pluginRootVariable && raw !== undefined && PLUGIN_HOOK_WORD.test(raw);
  if (!(word.startsWith('/') || word.startsWith('~/')) || /[*?[]/.test(word) || word.split('/').some((p) => p === '.' || p === '..')) return false;
  if (word.startsWith('~/') && home === HOME_UNKNOWN) return false;
  const file = expandTilde(word, home);
  return trustedSources.folders.some((folder) => file.startsWith(`${folder}/`) && file.length > folder.length + 1);
}

/** The trusted sources for one call: `$CLAUDE_PLUGIN_ROOT` only when nothing in the call could set it (a bare name, `${…:=…}`, eval). */
export function sourcesFor(cmd: string, trustedSources: TrustedSources): TrustedSources {
  return { ...trustedSources, pluginRootVariable: trustedSources.pluginRootVariable && !PLUGIN_ROOT_SET.test(cmd) };
}

/** `dots`: the shell's patterns already match dot entries (the script runs where `dotglob` is on). */
/** `optionSet`: the script's shell was started with an option the reader doesn't model (why, and whether plain writes stay known), else null (round 14). */
function readScript(cmd: string, cwd: string, reading: Reading, depth: number, dots = false, optionSet: LostDir | null = null): CommandPart[] {
  return readTokens(tokensOf(cmd, reading), cwd, reading, depth, dots, null, optionSet);
}

/** `text`: the command the tokens were read from, when its variables may be followed (the call itself, not a script inside it). */
function readTokens(tokens: Token[], cwd: string, reading: Reading, depth: number, dots = false, text: string | null = null, optionSet: LostDir | null = null): CommandPart[] {
  const opaque = (token: Extract<Token, { kind: 'word' | 'redirect' }>): string | null =>
    reading.opaque.has(token) ? opaqueValue(token.kind === 'word' ? token.value : token.target, reading.raw.get(token)) : null;
  const segments = split(tokens, cwd, reading.home, reading.toplevel, dots, reading.cdpath, reading.cdpathSetUnseen, text, reading.tmpdirSet, (token) => trustedSource(token, reading), reading.env, reading.follow, opaque, optionSet);
  return segments.flatMap((segment) => toParts(segment, segments, reading, depth));
}

/**
 * Splits tokens into segments on control operators, tracking the directory through `cd`,
 * `pushd`/`popd` and `( … )`. A `cd` that is piped or backgrounded runs apart, so it does not
 * move later segments. Shell keywords where a command starts (`if`, `do`, `{`, `case … in a)`,
 * `for … ;`, `function f`) are skipped, so the commands inside them are read as segments.
 */
/** The words of `git rev-parse --show-toplevel` (git syntax): it prints the top folder of the repo it runs in. */
const TOPLEVEL_WORDS = ['git', 'rev-parse', '--show-toplevel'];

/** True for a word that is exactly one `$( … )` or backtick substitution of `git rev-parse --show-toplevel`. */
function isToplevelWord(token: Extract<Token, { kind: 'word' }>): boolean {
  const script = token.scripts?.length === 1 ? token.scripts[0] : null;
  return (
    token.value === UNKNOWN &&
    script !== null &&
    script.length === TOPLEVEL_WORDS.length &&
    script.every((t, n) => t.kind === 'word' && t.value === TOPLEVEL_WORDS[n])
  );
}

/** Shell builtins that set or export the variables named in their words (shell syntax). */
const VARIABLE_BUILTINS = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);

/** `GIT_*` variables that never change where git finds the repo (git's own docs): the served commands set GIT_NO_REPLACE_OBJECTS. */
const DISCOVERY_SAFE_GIT = /^(?:GIT_NO_REPLACE_OBJECTS|GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)|GIT_TRACE[A-Za-z0-9_]*)(?:=|$)/;

/** True for a word that sets a `GIT_*` variable that may change where git finds the repo. */
function gitDiscoveryWord(w: string): boolean {
  return w.startsWith('GIT_') && !DISCOVERY_SAFE_GIT.test(w);
}

/** True when a command sets a `GIT_*` variable for the rest of the shell (`GIT_DIR=x;` alone, `export GIT_DIR=x`). */
function setsGitVariable(commandWords: string[], assigned: string[]): boolean {
  if (commandWords.length === 0 && assigned.some(gitDiscoveryWord)) return true;
  return VARIABLE_BUILTINS.has(commandWords[0] ?? '') && commandWords.slice(1).some(gitDiscoveryWord);
}

/** The shell option that makes patterns match dot entries, as zsh names it (case and `_` ignored): `GLOB_DOTS`. */
const GLOB_DOTS = 'globdots';
/** bash's option for it, and the variable that also switches it on when set (bash manual: GLOBIGNORE). */
const DOTGLOB = 'dotglob';
const GLOBIGNORE = 'GLOBIGNORE';
/** zsh's one-letter flag for GLOB_DOTS (`set -4`). */
const GLOB_DOTS_LETTER = '4';

/** A zsh option name as zsh compares them: letter case, `_` and `-` ignored. */
function zshOption(word: string): string {
  return word.toLowerCase().replaceAll('_', '').replaceAll('-', '');
}

/** True for an option name that turns dot matching on: zsh's GLOB_DOTS, or its alias (and bash's name) dotglob. */
function dotsOption(name: string): boolean {
  const option = zshOption(name);
  return option === GLOB_DOTS || option === DOTGLOB;
}

/** True for an option name that turns dot matching off (`noglobdots`, `nodotglob`). */
function noDotsOption(name: string): boolean {
  const option = zshOption(name);
  return option.startsWith('no') && dotsOption(option.slice(2));
}

/** The variable bash reads its `shopt` options from at startup (bash manual: BASHOPTS). */
const BASHOPTS = 'BASHOPTS';

/** True when a BASHOPTS value turns dotglob on (or may: a value only known when it runs). */
function bashoptsDots(value: string): boolean {
  return value.includes(UNKNOWN) || value.split(':').includes(DOTGLOB);
}

/** One shell option a word turns on or off: an option name (`globdots`, `dotglob`) or a one-letter flag (`4`). */
interface OptionChange {
  on: boolean;
  name: string;
}

/**
 * The options a run of shell option words turns on or off, in order (bash and zsh syntax, fix part
 * K11), read as getopt reads them: each `o` / `O` in a cluster takes the next word (`-eO dotglob`,
 * `-fo globdots`), every other letter is a flag (`-4c`), `-oname` also carries its name attached
 * (zsh), `--name` names one (zsh), and `--rcfile` / `--init-file` take a value. `toEnd` reads past
 * operands (`emulate zsh -o globdots`); otherwise the first operand ends the options.
 */
function optionChanges(args: string[], toEnd = false): OptionChange[] {
  const changes: OptionChange[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--' || a === '-' || (!a.startsWith('-') && !a.startsWith('+'))) {
      if (toEnd) continue;
      break;
    }
    const on = a.startsWith('-');
    if (a.startsWith('--')) {
      if (SHELL_VALUE_OPTIONS.has(a)) i++;
      else changes.push({ on, name: a.slice(2) });
      continue;
    }
    if (ATTACHED_OPTION_NAME.test(a)) changes.push({ on, name: a.slice(2) });
    for (const letter of a.slice(1)) changes.push({ on, name: letter === 'o' || letter === 'O' ? args[++i] ?? '' : letter });
  }
  return changes;
}

/** Whether patterns match dot entries after this change: on, off, or null when it doesn't touch them. A name only known when it runs may switch them on. */
function dotsAfterChange({ on, name }: OptionChange): boolean | null {
  if (name.includes(UNKNOWN)) return true;
  if (name === GLOB_DOTS_LETTER || dotsOption(name)) return on;
  if (noDotsOption(name)) return !on;
  return null;
}

/**
 * True when a shell started with these words matches dot entries in its script (fix round 4, K8;
 * every option spelling, fix part K11): bash `-O dotglob` (also in a cluster, `-eO dotglob`), zsh
 * `-o globdots` / `-oglobdots` / `--globdots` / `+o noglobdots` / `-4`, BASHOPTS holding dotglob, or
 * a GLOBIGNORE that is not empty, set for it (bash turns dotglob on whenever GLOBIGNORE is set).
 */
function shellDots(name: string | null, args: string[], assignments: string[], values: string[]): boolean {
  if (name === null || !SHELLS.has(name)) return false;
  if (assignments.some((a, n) => a === BASHOPTS && bashoptsDots(values[n] ?? ''))) return true;
  if (assignments.some((a, n) => a === GLOBIGNORE && (values[n] ?? '') !== '')) return true;
  return optionChanges(args).some((change) => dotsAfterChange(change) === true);
}

/** zsh's `options` array (zsh syntax): `options[globdots]=on` sets the option. */
const ZSH_OPTIONS = 'options';

/** Whether patterns match dot entries after an `options[name]=on|off` assignment (zsh), or null when it is none. */
function optionsArrayDots(word: string): boolean | null {
  const assignment = assignmentOf(word);
  if (assignment === null || assignment.name !== ZSH_OPTIONS || assignment.index === null) return null;
  const value = assignment.value.toLowerCase();
  if (value.includes(UNKNOWN)) return true;
  if (value !== 'on' && value !== 'off') return null;
  return dotsAfterChange({ on: value === 'on', name: assignment.index });
}

/**
 * Whether patterns match dot entries after a command that may change it (fix round 4, K2): `shopt
 * -s|-u dotglob`, `setopt`/`unsetopt [no]globdots`, `set -o|+o globdots`, `set -4|+4`, or setting
 * `GLOBIGNORE`. An option name only known when the command runs may switch it on.
 */
function dotGlobAfter(commandWords: string[], assigned: string[], on: boolean): boolean {
  let p = 0;
  // `builtin shopt …`, `command setopt …` run the same builtin (K8)
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  // the variables set for the rest of the shell, alone or by `export` and the like, in any assignment form (K11)
  const set = [...(program === undefined ? assigned : []), ...(VARIABLE_BUILTINS.has(program ?? '') ? args : [])].flatMap((w) => {
    const assignment = assignmentOf(w);
    return assignment === null ? [] : [{ word: w, ...assignment }];
  });
  if (set.some((a) => a.name === GLOBIGNORE)) return true;
  // BASHOPTS set or exported with dotglob: a bash started later reads it (K8)
  if (set.some((a) => a.name === BASHOPTS && bashoptsDots(a.value))) return true;
  // zsh's `options[globdots]=on` (K11)
  for (const a of set) on = optionsArrayDots(a.word) ?? on;
  // an `eval` whose text may set it (K8): naming the option, or only known when it runs
  if (program === 'eval') {
    const text = args.join(' ');
    if (text.includes(UNKNOWN) || /dot_?glob|glob_?dots/i.test(text)) return true;
  }
  const names = args.filter((w) => !/^[-+]/.test(w));
  if (program === 'shopt') {
    const mode = args.includes('-s') ? true : args.includes('-u') ? false : null;
    if (mode === null) return on;
    // an option only known when it runs may be dotglob: `-s` may switch it on, `-u` is not trusted to switch it off
    if (names.some((w) => w.includes(UNKNOWN))) return on || mode;
    return names.includes(DOTGLOB) ? mode : on;
  }
  if (program === 'setopt' || program === 'unsetopt') {
    const setting = program === 'setopt';
    if (args.some((w) => w.startsWith('-') && w.includes(GLOB_DOTS_LETTER))) return true;
    for (const name of names) {
      if (name.includes(UNKNOWN)) return true;
      if (dotsOption(name)) on = setting;
      else if (noDotsOption(name)) on = !setting;
    }
    return on;
  }
  // `set -o globdots`, `set -eo globdots`, `set -4`; zsh's `emulate … -o globdots` takes options around its mode (K11)
  if (program === 'set' || program === 'emulate') {
    for (const change of optionChanges(args, program === 'emulate')) on = dotsAfterChange(change) ?? on;
  }
  return on;
}

/**
 * Shell options the gate knows leave folders, variables and words as it reads them (R-266 round 14,
 * SEC HIGH-2), as zsh compares names (`no` taken off first): exit and trace settings, NOMATCH and
 * NULL_GLOB, GLOB / NO_GLOB, CLOBBER, and the dot-matching options the reader models (fix round 4, K2).
 */
const SAFE_OPTIONS = new Set([
  'errexit', 'unset', 'pipefail', 'xtrace', 'verbose', 'errtrace', 'functrace', 'glob', 'clobber', 'nomatch', 'nullglob',
  'failglob', 'braceexpand', 'localoptions', 'localtraps', GLOB_DOTS, DOTGLOB,
  // round 15, D-R14-4: options that change no path the gate reads; extendedglob's `#^~` are read as wildcards
  'allexport', 'globstar', 'errreturn', 'interactivecomments', 'vi', 'emacs', 'extendedglob',
]);
/** zsh's EXTENDED_GLOB, as zsh compares names: once set, `#`, `^` and `~` are read as wildcards. */
const EXTENDED_GLOB = 'extendedglob';
/** One-letter options of `set` that are safe in bash and zsh alike (`-e`, `-u`, `-x`, `-v`, `-f`, `-C`, `-E`, `-B`, `-a`), and zsh's `-4`. */
const SAFE_OPTION_LETTERS = new Set(['e', 'u', 'x', 'v', 'f', 'C', 'E', 'B', 'a', GLOB_DOTS_LETTER]);
/** bash `shopt` options that are safe: the dot and empty-match ones, extglob, which the reader reads, and globstar and interactive_comments. */
const SAFE_SHOPT = new Set([DOTGLOB, 'nullglob', 'failglob', 'extglob', 'globstar', 'interactive_comments']);
/**
 * Options that change how a plain literal path or a `cd` is read (zsh 5.9, found by running every
 * option against plain writes; round 15, D-R14-4): `cd NAME` goes to a variable's value (cdablevars), a
 * command naming a folder goes there (autocd), a value is a pattern (globsubst), `{ab}` expands
 * (braceccl), `of=~/x` is under home (magicequalsubst). The folder stays unknown from there on.
 */
const FULL_OPTIONS = new Set(['cdablevars', 'globsubst', 'braceccl', 'magicequalsubst', 'autocd']);
/** zsh's letters for CDABLE_VARS (`-T`) and AUTO_CD (`-J`). */
const FULL_OPTION_LETTERS = new Set(['T', 'J']);

/** True for an option name the gate knows is safe; one only known when it runs never is. */
function safeOption(name: string): boolean {
  if (name.includes(UNKNOWN)) return false;
  const option = zshOption(name);
  return option === '' || SAFE_OPTIONS.has(option) || (option.startsWith('no') && SAFE_OPTIONS.has(option.slice(2)));
}

/**
 * How far a shell option the gate doesn't model reaches (round 15, D-R14-4): `partial` leaves the folder
 * known for a plain literal write (variables, wildcards and a later `cd` stay unknown); `full` makes the
 * folder unknown from there on, as every unmodelled option did in round 14.
 */
type OptionKind = 'partial' | 'full';

function worse(a: OptionKind | null, b: OptionKind | null): OptionKind | null {
  return a === 'full' || b === 'full' ? 'full' : a ?? b;
}

/** The reach of an option set by name: null when safe; a name only known when it runs is full. */
function nameKind(name: string): OptionKind | null {
  if (name.includes(UNKNOWN)) return 'full';
  const option = zshOption(name);
  if (FULL_OPTIONS.has(option) || (option.startsWith('no') && FULL_OPTIONS.has(option.slice(2)))) return 'full';
  return safeOption(name) ? null : 'partial';
}

/** The reach of an option set by its letter (zsh's and bash's letters). */
function letterKind(letter: string): OptionKind | null {
  if (FULL_OPTION_LETTERS.has(letter)) return 'full';
  return SAFE_OPTION_LETTERS.has(letter) ? null : 'partial';
}

/** The reach of a bash `shopt` name: cdable_vars as zsh's cdablevars. */
function shoptKind(name: string): OptionKind | null {
  if (name.includes(UNKNOWN)) return 'full';
  if (SAFE_SHOPT.has(name)) return null;
  return nameKind(name) === 'full' ? 'full' : 'partial';
}

/** What a command does to the shell's options: the reach of any it sets the gate doesn't model, and whether it may turn extendedglob on. */
interface OptionEffect {
  kind: OptionKind | null;
  extended: boolean;
}

/** `emulate`'s words without its `-c script` (the script runs under the emulation, which is then put back). */
function emulateMode(args: string[]): { mode: string[]; script: string | null } {
  const mode: string[] = [];
  let script: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (/^-[A-Za-z]*c$/.test(args[i]) && i + 1 < args.length) {
      mode.push(...(args[i].length > 2 ? [args[i].slice(0, -1)] : []));
      script = args[++i];
    } else {
      mode.push(args[i]);
    }
  }
  return { mode, script };
}

/** `emulate zsh` (and `-L` / `-R`) puts zsh's own defaults back, which the reader models; `sh`, `ksh`, `-o` don't. */
function emulateKind(mode: string[]): OptionKind | null {
  return mode.length > 0 && mode.every((w) => w === 'zsh' || w === '-L' || w === '-R' || w === '-LR') ? null : 'full';
}

/**
 * The shell options a command sets that the gate doesn't model (R-266 round 14, SEC HIGH-2; round 15,
 * D-R14-4): zsh's `setopt` / `unsetopt` (`-o NAME` read as a name, `-m` as patterns) / `options[…]=` /
 * `emulate`, `set -o|+o name` or a flag letter, bash's `shopt -s|-u`, beyond the safe ones.
 */
function optionEffect(commandWords: string[], assigned: string[]): OptionEffect {
  let p = 0;
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  let kind: OptionKind | null = null;
  const names: string[] = [];
  const set = [...(program === undefined ? assigned : []), ...(VARIABLE_BUILTINS.has(program ?? '') ? args : [])];
  for (const word of set) {
    const assignment = assignmentOf(word);
    if (assignment?.name !== ZSH_OPTIONS) continue;
    if (assignment.index === null) kind = 'full';
    else names.push(assignment.index);
  }
  if (program === 'setopt' || program === 'unsetopt') {
    for (let i = 0; i < args.length; i++) {
      const w = args[i];
      if (w === '-o' || w === '+o') names.push(args[++i] ?? '');
      else if (!/^[-+]/.test(w)) names.push(w);
      // `-m`: the names are patterns, which may match any option
      else for (const letter of w.slice(1)) kind = worse(kind, letter === 'm' ? 'full' : letterKind(letter));
    }
  } else if (program === 'shopt') {
    if (args.some((w) => w === '-s' || w === '-u' || /^-[A-Za-z]*[su]/.test(w))) {
      const shellOptions = args.some((w) => /^-[A-Za-z]*o/.test(w));
      for (const w of args.filter((a) => !a.startsWith('-'))) {
        if (shellOptions) names.push(w);
        else kind = worse(kind, shoptKind(w));
      }
    }
  } else if (program === 'emulate') {
    const { mode, script } = emulateMode(args);
    // with `-c`, the emulation lasts only while its script runs (read with it there)
    if (script === null) kind = worse(kind, emulateKind(mode));
    if (mode.some((w) => zshOption(w).includes(EXTENDED_GLOB))) names.push(EXTENDED_GLOB);
  } else if (program === 'set') {
    for (const { name } of optionChanges(args)) {
      if (name.length === 1) kind = worse(kind, letterKind(name));
      else names.push(name);
    }
  }
  for (const name of names) kind = worse(kind, nameKind(name));
  return { kind, extended: names.some((name) => name.includes(UNKNOWN) || zshOption(name).endsWith(EXTENDED_GLOB)) };
}

/** Letters a shell takes when started that set no option (`-c`, `-i`, `-l`, `-s`, `-r`): bash and zsh syntax. */
const SHELL_START_LETTERS = new Set(['c', 'i', 'l', 's', 'r']);
/** bash's long start options that set no shell option. */
const SAFE_SHELL_LONG = new Set(['norc', 'noprofile', 'login', 'noediting', 'restricted', 'verbose']);

/**
 * The reach of the options a shell is started with that the reader doesn't model (round 14, SEC HIGH-2,
 * the nested form; round 15, D-R14-4), or null: `zsh -o cdablevars`, `+o name`, `-oname`, `--name`, a
 * letter (`zsh -y`), bash `-O shopt_name` or `-o name`; the same allowlist as setopt. Its `-c` script is
 * read as after `setopt` of them.
 */
function shellSetsUnknownOption(name: string | null, args: string[]): OptionKind | null {
  if (name === null || !SHELLS.has(name)) return null;
  let kind: OptionKind | null = null;
  // a nested shell's script is read once, from its start: extendedglob there counts as an unmodelled option, so its `#^~` are wildcards
  const named = (option: string): OptionKind | null => (zshOption(option).endsWith(EXTENDED_GLOB) ? 'partial' : nameKind(option));
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--' || a === '-' || !/^[-+]/.test(a)) break;
    if (a.startsWith('--')) {
      if (SHELL_VALUE_OPTIONS.has(a)) i++;
      else if (!SAFE_SHELL_LONG.has(a.slice(2))) kind = worse(kind, named(a.slice(2)));
      continue;
    }
    if (ATTACHED_OPTION_NAME.test(a)) {
      kind = worse(kind, a[1] === 'O' ? shoptKind(a.slice(2)) : named(a.slice(2)));
      continue;
    }
    for (const letter of a.slice(1)) {
      if (letter === 'o' || letter === 'O') {
        const option = args[++i] ?? '';
        kind = worse(kind, letter === 'O' ? shoptKind(option) : named(option));
      } else if (!SHELL_START_LETTERS.has(letter)) {
        kind = worse(kind, letterKind(letter));
      }
    }
  }
  return kind;
}

/** Where the shell was when a compound command or group opened, and whether it opened after a pipe. */
interface Opened {
  dir: string;
  lost: LostDir | null;
  afterPipe: boolean;
}

/** A variable the reader may follow (D-R11-1): its value, where its set ends, and whether only `&&` may come between. */
interface Followed {
  value: string;
  setEnd: number;
  andOnly: boolean;
  /** The value holds wildcard characters: used unquoted, it is a pattern (round 14, SEC HIGH-3). */
  wild?: boolean;
}

/** Characters that make a value a pattern when used unquoted: bash's `*?[` and extglob `(`, zsh's `#^<` (`~` is never followed). */
const WILD_VALUE = /[*?[#^(<]/;

/**
 * A followed value with wildcard characters as a shell pattern the protected-path checks can read:
 * `*?[…]` as written, and each zsh or extglob form (`(…)`, `<…>`, `#`, `^`), which could match any
 * name, as `*` (round 14, SEC HIGH-3).
 */
function valuePattern(value: string): string {
  return value.replace(/[!@+*?]?\([^)]*\)?/g, '*').replace(/<[^>]*>?/g, '*').replace(/[#^]/g, '*');
}

/** The words before a `{` that times it as a group: `time`, and bash's `-p`. */
const TIMED_GROUP = /^time(?: -p+)*$/;

/** Keyword compounds the shell runs as one command (shell grammar): what opens and what closes them. */
const COMPOUND_OPEN = new Set(['if', 'while', 'until']);
const COMPOUND_CLOSE = new Set(['fi', 'done']);
/** Keywords after which a variable set before may not have been set, or may be set again (a branch, a loop). */
const FORGET_AT = new Set(['else', 'elif', 'fi', 'do', 'done', 'while', 'until']);
/** Operators after which a variable set before may not have been set in this shell. */
const FORGET_OPS = new Set(['||', '|', '|&', '&', ';;', ';&', ';;&', '(', ')']);

/** Special parameters a trap string may read (`$$`, `$!`, `$?`, `$#`): numbers, never text that runs. */
const SPECIAL_PARAMETERS = new Set(['$', '!', '?', '#']);

/** Words before a `trap` or `emulate` that still run it as the builtin (bash and zsh). */
const SCRIPT_PREFIXES = new Set(['builtin', 'command', 'noglob', 'nocorrect', '-']);

/**
 * True when the next word of a command is the text `trap` (after `-l` / `-p` and `--`) or
 * `emulate … -c` runs (round 15, SEC HIGH-A/B), or a word of the command zsh's `sched` runs (round 16).
 */
function scriptOperandNext(words: string[]): boolean {
  const command = stripAssignments(words);
  let i = 0;
  while (SCRIPT_PREFIXES.has(command[i])) i++;
  const rest = command.slice(i + 1);
  if (command[i] === 'sched') return rest.some((w) => !/^-[A-Za-z]+$/.test(w));
  if (command[i] === 'trap') {
    let j = 0;
    while (j < rest.length && /^-[lp]+$/.test(rest[j])) j++;
    if (rest[j] === '--') j++;
    return j === rest.length;
  }
  return command[i] === 'emulate' && emulateMode(rest).script === null && /^-[A-Za-z]*c$/.test(rest.at(-1) ?? '');
}

/** Why a `trap` or `emulate -c` string is refused as too complex. */
const CANNOT_EXPAND = 'a `trap` or `emulate -c` string that holds a value only known when it runs';
/** Each name a script reads with `$`, however (`$F`, `${F}`, `${F:-x}`, `${#F}`, `${(P)F}`), quoted or not: fail closed. */
const REFERENCED_NAME = /\$\{?(?:\([^)]*\))?[#!=~^+]*([A-Za-z_][A-Za-z0-9_]*)/g;
/** A value filled into a later script: plain text, the same wherever it sits in the script (no space, quote or wildcard). */
const LATER_VALUE = /^[A-Za-z0-9_./@+:,-]+$/;
/**
 * A plain assignment's value as written, up to where the word ends (D-R19-1): plain text (quoted or not), empty,
 * `$?` or `$!`. Group 1, 2 or 3 holds the plain text.
 */
const SETTLED_VALUE = /(?:([A-Za-z0-9_./@+:,-]+)|"([A-Za-z0-9_./@+:,-]*)"|'([A-Za-z0-9_./@+:,-]*)'|\$[?!]|)(?=$|[\s;&|)])/y;
/** A new temp file or folder as an assignment's value, quoted or not: `$(mktemp …)` or `` `mktemp …` ``; group 2 or 3 holds its words. */
const MKTEMP_VALUE = /("?)(?:\$\(mktemp((?:[ \t]+[^\s()`;&|]+)*)[ \t]*\)|`mktemp((?:[ \t]+[^\s()`;&|]+)*)[ \t]*`)\1(?=$|[\s;&|)])/y;
/** A mktemp folder or template written out: plain text, maybe after `~/`. */
const MKTEMP_LITERAL = /^(?:~(?=\/|$))?[A-Za-z0-9_./@+:,-]*$/;
/** A mktemp folder or template in the temp folder: `$TMPDIR`, `${TMPDIR}`, `${TMPDIR:-/tmp}`, then plain text. */
const MKTEMP_IN_TMPDIR = /^\$(?:TMPDIR|\{TMPDIR(?::?-[A-Za-z0-9_./-]*)?\})(?:\/[A-Za-z0-9_./@+:,-]*)?$/;
/** mktemp's own template when none is given (GNU coreutils; BSD uses fewer X's, a name the pattern covers too). */
const MKTEMP_DEFAULT = 'tmp.XXXXXXXXXX';

/** mktemp's GNU long options, by full name: the short option each stands for (`--tmpdir` takes an optional value). */
const MKTEMP_LONG: ReadonlyMap<string, string> = new Map([
  ['directory', 'd'],
  ['dry-run', 'u'],
  ['quiet', 'q'],
  ['tmpdir', 'p'],
  ['suffix', 's'],
]);

/** What a mktemp's words ask for, as written; null for an option it doesn't know or a value it can't read. */
interface MktempWords {
  /** The folder given (`-p DIR`, `--tmpdir=DIR`). */
  dir?: string;
  template?: string;
  /** In the temp folder: `-t`, or `--tmpdir` with no value. */
  inTemp: boolean;
  /** `--suffix=S`, added after the template's X's. */
  suffix?: string;
  /** `-d` / `--directory`: makes a folder. */
  folder: boolean;
}

/**
 * Reads a mktemp's words (R-266 round 21, CR LOW-1): the short options `-d -q -u -t [PREFIX] -p DIR` (any cluster,
 * a value attached or the next word), GNU's long options or a unique prefix of one (`--directory`, `--dry-run`,
 * `--quiet`, `--tmpdir[=DIR]`, `--suffix=S`), and at most one template. A `-t` prefix holding `/` climbs out of the
 * temp folder (`-t ../../.claude/x`): null, as unknown (round 21, CR L-c).
 */
function mktempWords(words: string[]): MktempWords | null {
  const read: MktempWords = { inTemp: false, folder: false };
  const unquoted = (w: string): string => (/^(["']).*\1$/s.test(w) ? w.slice(1, -1) : w);
  for (let i = 0; i < words.length; i++) {
    const w = unquoted(words[i]);
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const given = eq === -1 ? w.slice(2) : w.slice(2, eq);
      const matches = [...MKTEMP_LONG.keys()].filter((full) => given !== '' && full.startsWith(given));
      if (matches.length !== 1) return null;
      const option = MKTEMP_LONG.get(matches[0]);
      const value = eq === -1 ? undefined : w.slice(eq + 1);
      if (option === 'p') {
        if (value === undefined) read.inTemp = true;
        else read.dir = value;
      } else if (option === 's') {
        const suffix = value ?? (words[i + 1] === undefined ? undefined : unquoted(words[++i]));
        if (suffix === undefined || suffix.includes('/') || read.suffix !== undefined) return null;
        read.suffix = suffix;
      } else if (value !== undefined) {
        return null;
      } else if (option === 'd') {
        read.folder = true;
      }
      continue;
    }
    if (!/^-./.test(w)) {
      if (read.template !== undefined) return null;
      read.template = w;
      continue;
    }
    for (let n = 1; n < w.length; n++) {
      const c = w[n];
      if (c === 'd') read.folder = true;
      if ('dqu'.includes(c)) continue;
      if (c !== 't' && c !== 'p') return null;
      let value: string | undefined = w.slice(n + 1);
      if (value === '') value = words[i + 1] !== undefined && !words[i + 1].startsWith('-') ? unquoted(words[++i]) : undefined;
      if (c === 'p') {
        if (value === undefined) return null;
        read.dir = value;
      } else {
        read.inTemp = true;
        if (value !== undefined) {
          if (read.template !== undefined || value.includes('/')) return null;
          read.template = value;
        }
      }
      break;
    }
  }
  return read;
}

/**
 * The paths a `mktemp` with these words may print, as a pattern (each run of X a `*`), R-266 round 20, CR MEDIUM-2:
 * the options `-d -q -u` (any cluster), `-t [PREFIX]` (in the temp folder) and `-p DIR`, and at most one template,
 * written out or under `$TMPDIR`. '' for a path in the temp folder (`$TMPDIR` unknown: the value only known when it
 * runs, as before); null for anything else, or a temp-folder path while the command sets TMPDIR.
 */
function mktempPattern(words: string[], home: string, tmpdirSet: boolean): string | null {
  const read = mktempWords(words);
  if (read === null) return null;
  const { dir, inTemp, suffix } = read;
  let { template } = read;
  if (suffix !== undefined) template = (template ?? MKTEMP_DEFAULT) + suffix;
  const temp = (w: string | undefined): boolean => w !== undefined && MKTEMP_IN_TMPDIR.test(w);
  const inTempFolder = dir === undefined ? inTemp : temp(dir);
  // a template holding `/` in the temp folder can climb out of it to any path (round 22, CR MEDIUM-1)
  if (inTempFolder && template?.includes('/') === true) return null;
  if (temp(template) || inTempFolder || (dir === undefined && template === undefined)) return tmpdirSet ? null : '';
  for (const w of [dir, template]) if (w !== undefined && !MKTEMP_LITERAL.test(w)) return null;
  const expand = (w: string): string | null => (!w.startsWith('~') ? w : home.includes(UNKNOWN) ? null : home + w.slice(1));
  const name = expand(template ?? MKTEMP_DEFAULT);
  const folder = dir === undefined ? undefined : expand(dir);
  if (name === null || folder === null) return null;
  const full = folder === undefined || name.startsWith('/') ? name : path.posix.join(folder, name);
  return full.replace(/X+/g, MKTEMP_ANY);
}

/**
 * What a mktemp writes outside the temp folder (R-266 round 21, SEC INFO-1): the path it makes in the folder its
 * words give, however written (`-dp~/.claude/plugins`, `-qp .git/hooks`), and that folder when it has a part only
 * known when it runs and a written end (`-p "$D"/.claude`), which may be a folder holding protected files.
 */
function mktempWrites(args: string[], tempArgs: boolean[]): string[] {
  const read = mktempWords(args);
  if (read === null) return [];
  const { dir } = read;
  const writtenInTemp = (w: string): boolean => tempArgs[args.lastIndexOf(w)];
  const template = (read.template ?? MKTEMP_DEFAULT) + (read.suffix ?? '');
  // a template holding `/` in the temp folder can climb out of it to any path: unknown (round 22, CR MEDIUM-1)
  if ((dir === undefined ? read.inTemp : writtenInTemp(dir)) && template.includes('/')) return [UNKNOWN];
  if (dir === undefined && (read.template === undefined || read.inTemp)) return [];
  const made = dir === undefined || template.startsWith('/') ? template : path.posix.join(dir, template);
  const folder = dir !== undefined && dir.includes(UNKNOWN) && !/^[/]*$/.test(dir.slice(dir.lastIndexOf(UNKNOWN) + UNKNOWN.length)) ? [dir] : [];
  return [made, ...folder];
}

/** Where a mktemp value holds a run of X: any text, a wildcard wherever the value is filled in (`".oss/x."*""`). */
const MKTEMP_ANY = '\u0001';

/** Variants of a script judged at most, one per combination of followed later values (D-R19-1). */
const MAX_SCRIPT_VARIANTS = 16;

/**
 * The plain values a variable read by a later script may hold when it runs (R-266 round 19, D-R19-1, "follow later
 * values"), when every word in the command that names it (outside `$…`, and outside the script itself: `span`, whose
 * own `rc=$?` is no later change, round 20) is a plain assignment where a command starts (`F=x`, `;F=x`, `& F=x`,
 * `( F=x`, `{ F=x`), set to plain text, empty, `$?`, `$!` or `$(mktemp …)`; else null. The values only known when it
 * runs (empty, unset, a status, a pid, a new path in the temp folder) are left out: the script read with the variable
 * unknown stands for them. A new temp path elsewhere is its template's pattern (`.oss/x.*`: round 20, CR MEDIUM-2).
 */
function settledValues(text: string, name: string, span: { start: number; end: number }, home: string): string[] | null {
  if (neverFollowed(name)) return null;
  const values = new Set<string>();
  let found = 0;
  /** The name's mentions inside the values themselves (`tmp=$(mktemp -d /tmp/x.XXXXXX)`): words, not sets. */
  let inValues = 0;
  for (const m of text.matchAll(new RegExp(`(?<![A-Za-z0-9_])${name}=`, 'g'))) {
    tick();
    // in the script itself (its own `rc=$?`): judged with the value it sets there, not counted as a later change
    const inside = m.index >= span.start && m.index < span.end;
    let at = m.index - 1;
    while (at >= 0 && (text[at] === ' ' || text[at] === '\t')) at--;
    // where a command starts; not `${F=x}`, which assigns only when F is unset (a parameter expansion)
    const start = at < 0 || at === span.start || (';&|({\n'.includes(text[at]) && !(text[at] === '{' && text[at - 1] === '$'));
    if (!start) {
      // a word of the script's own (`echo "rc=$rc"`): its sets are read with the script's commands
      if (inside) continue;
      return null;
    }
    const from = m.index + m[0].length;
    MKTEMP_VALUE.lastIndex = from;
    const made = MKTEMP_VALUE.exec(text);
    if (made !== null) {
      if (!inside) inValues += plainMentionsIn(text, name, from, from + made[0].length);
      const pattern = mktempPattern((made[2] ?? made[3]).trim().split(/[ \t]+/).filter(Boolean), home, plainMentions(text, 'TMPDIR') > 0);
      if (pattern === null) return null;
      if (pattern !== '') values.add(pattern);
      if (!inside) found++;
      continue;
    }
    SETTLED_VALUE.lastIndex = from;
    const value = SETTLED_VALUE.exec(text);
    if (value === null) return null;
    const plain = value[1] ?? value[2] ?? value[3];
    if (plain !== undefined && plain !== '') values.add(plain);
    if (inside) continue;
    inValues += plainMentionsIn(text, name, from, from + value[0].length);
    found++;
  }
  return found + inValues === plainMentions(text, name) - plainMentionsIn(text, name, span.start, span.end) ? [...values] : null;
}

/**
 * The script with each `$NAME` / `${NAME}` of a variable in `values` (outside single quotes) replaced by its
 * value; null when one of them is still read some other way after that (round 16, SEC HIGH-1).
 */
function filledReferences(script: string, values: ReadonlyMap<string, string>): string | null {
  let out = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') {
      out += script.slice(i, i + 2);
      i++;
      continue;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === '$') {
      VARIABLE_REFERENCE.lastIndex = i + 1;
      const match = VARIABLE_REFERENCE.exec(script);
      const value = match === null ? undefined : values.get(match[1] ?? match[2]);
      if (match !== null && value !== undefined) {
        out += value.split(MKTEMP_ANY).join(quote === '"' ? '"*"' : '*');
        i += match[0].length;
        continue;
      }
    }
    out += c;
  }
  return [...out.matchAll(REFERENCED_NAME)].some(([, name]) => values.has(name)) ? null : out;
}

/** A variable as written after its `$`: `{NAME}` or `NAME`; what follows may not index it or take a zsh modifier (`[0]`, `:h`). */
const VARIABLE_REFERENCE = /\{([A-Za-z_][A-Za-z0-9_]*)\}(?![[:{])|([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_[:{])/y;

/**
 * The variables a word reads, in order, as written (`$NAME`, `${NAME}`), and whether each sits in double
 * quotes; `$HOME`, which the tokenizer fills in, is left out when the home folder is known. Null when the
 * word holds any other expansion (`$(…)`, `$1`, `${X:-…}`, a backtick), a subscript or modifier, or reads
 * HOME in a call that sets it (round 15, SEC MEDIUM-A).
 */
function variableReferences(raw: string, home: string, specials = false): { name: string; quoted: boolean }[] | null {
  const refs: { name: string; quoted: boolean }[] = [];
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') {
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === '`') {
      return null;
    } else if (c === '$' && specials && SPECIAL_PARAMETERS.has(raw[i + 1] ?? '')) {
      refs.push({ name: raw[i + 1], quoted: quote === '"' });
      i++;
    } else if (c === '$') {
      VARIABLE_REFERENCE.lastIndex = i + 1;
      const match = VARIABLE_REFERENCE.exec(raw);
      if (match === null) return null;
      const name = match[1] ?? match[2];
      if (name === 'HOME') {
        if (home.includes(UNKNOWN)) return null;
      } else {
        refs.push({ name, quoted: quote === '"' });
      }
      i += match[0].length;
    }
  }
  return refs;
}
/** The value `$(git rev-parse --show-toplevel)`, quoted or not, as written. */
const TOPLEVEL_VALUE = /^("?)\$\(git rev-parse --show-toplevel\)\1$/;
/** The value `$(mktemp)`, `$(mktemp -d)`, or either with `-t name`, quoted or not: a new file or folder in the temp folder. */
const NEW_TEMP_VALUE = /^("?)\$\(mktemp( -d)?(?: -t [A-Za-z0-9._-]+)?\)\1$/;
/** A plain value as written: unquoted plain text, or quoted text with nothing the shell expands but the home folder. */
const PLAIN_VALUE = /^(?:[A-Za-z0-9_./@+:,-]+|'[^'\n]*'|"(?:[^"$`\\\n]|\$HOME\b|\$\{HOME\})*")$/;
/** A value as written that starts with the home folder: `$HOME`, `${HOME}` or `~`, alone or before `/`. */
const HOME_HEAD = /^(?:\$HOME|\$\{HOME\}|~)(?=\/|$)/;
/** The name the reader gives a folder `mktemp -d` makes: only known when it runs, but new and in the temp folder. */
export const NEW_TEMP_FOLDER = 'oss-tool-gate-mktemp-folder';
/** The name the reader gives a file `mktemp` makes (round 12, D-R12-1). */
export const NEW_TEMP_FILE = 'oss-tool-gate-mktemp-file';

/**
 * True for a word or redirect target that is exactly `$(mktemp)` or `$(mktemp -t name)`: a new file in
 * the temp folder, unless the call sets TMPDIR.
 */
function isNewTempFile(token: Extract<Token, { kind: 'word' | 'redirect' }>, tmpdirSet: boolean): boolean {
  const value = token.kind === 'word' ? token.value : token.target;
  const script = token.scripts?.length === 1 ? token.scripts[0] : null;
  if (tmpdirSet || value !== UNKNOWN || script === null) return false;
  const words = script.map((t) => (t.kind === 'word' ? t.value : null));
  return (words.length === 1 && words[0] === 'mktemp') || (words.length === 3 && words[0] === 'mktemp' && words[1] === '-t' && /^[A-Za-z0-9._-]+$/.test(words[2] ?? ''));
}

/** Programs whose only operand write is their destination, the last operand (cp, ln, install, ditto, rsync syntax). */
const DESTINATION_WRITERS = new Set(['cp', 'ln', 'install', 'ditto', 'rsync']);

/** Words (by index in `words`) and redirect targets of a segment that hold an unknown part. */
interface Marked {
  words: Set<number>;
  redirects: Set<string>;
}

/**
 * The write targets that hold a marked part (a command substitution; any unknown part): redirect targets by their text; an operand by
 * where it stands among the program's words (its last occurrence for a program that writes only its
 * destination, any occurrence otherwise). Words a wrapper reshaped (not the segment's own last words)
 * count by text alone (fail closed).
 */
function markedWrites(marked: Marked, segment: Segment, words: string[], name: string | null, redirected: string[], operandsWritten: string[]): string[] {
  const { words: at, redirects } = marked;
  const offset = segment.words.length - words.length;
  const suffix = offset >= 0 && words.every((w, n) => segment.words[offset + n] === w);
  const substitutedAt = (n: number): boolean => at.has(offset + n);
  const operands = operandsWritten.filter((p) => {
    // the word itself, or an option's value (`of=…`)
    const places = words.flatMap((w, n) => (n > 0 && (w === p || w.endsWith(`=${p}`)) ? [n] : []));
    if (places.length === 0) return false;
    if (!suffix) return at.size > 0 && p.includes(UNKNOWN);
    return name !== null && DESTINATION_WRITERS.has(name) ? substitutedAt(places[places.length - 1]) : places.some(substitutedAt);
  });
  return [...redirected.filter((p) => redirects.has(p)), ...operands];
}

/** Programs that run another program named in their words: a word there may name what runs. */
/** Builtins that change the shell's folder, or what a later `cd` or command does. */
const SHELL_STATE_BUILTINS = new Set([
  'cd', 'pushd', 'popd', 'source', '.', 'alias', 'unalias', 'eval', 'shopt', 'setopt', 'unsetopt', 'set', 'trap', 'enable',
  'disable', 'exec', 'builtin', 'command', 'export', 'declare', 'typeset', 'local', 'readonly', 'unset', 'emulate', 'hash',
  'autoload', 'zmodload', 'function', 'functions',
]);

/**
 * False only for an `eval` whose text is one plain simple command (letters, digits, `_.,:/@%+=-`
 * and spaces) that starts with neither an assignment nor a builtin that changes the shell's state
 * (`eval 'echo hi'`): any other text could move the shell (R-266 round 11, SEC MEDIUM-1).
 */
function evalMayMove(commandWords: string[]): boolean {
  const at = commandWords.indexOf('eval');
  const text = commandWords.slice(at + 1).join(' ');
  if (text.includes(UNKNOWN) || !/^[A-Za-z0-9_.,:/@%+= -]*$/.test(text)) return true;
  const first = text.trim().split(/ +/)[0] ?? '';
  return first === '' || first.includes('=') || SHELL_STATE_BUILTINS.has(first.toLowerCase());
}

const LAUNCHERS = new Set(['eval', 'source', '.', 'exec', 'command', 'builtin', 'xargs', 'trap', 'emulate', 'sched']);

/** The text `trap` runs: its first operand after `-l` / `-p` and `--` (bash and zsh `trap [--] text sig…`), or null. */
function trapScript(args: string[]): string | null {
  let i = 0;
  while (i < args.length && /^-[lp]+$/.test(args[i])) i++;
  if (args[i] === '--') i++;
  const script = args[i];
  return script === undefined || script === '-' ? null : script;
}

/** The command zsh's `sched [-o] [+]hh:mm[:ss] command…` runs later in this shell, or null (`sched`, `sched -N`). */
function schedScript(args: string[]): string | null {
  let i = 0;
  while (i < args.length && /^-[A-Za-z]+$/.test(args[i])) i++;
  const command = args.slice(i + 1);
  return command.length === 0 ? null : command.join(' ');
}

/** zsh's `functions` array: setting an element defines a function from its text (`functions[f]='…'`). */
const ZSH_FUNCTIONS = 'functions';

/**
 * The function bodies a command defines through zsh's `functions` array (round 15, SEC HIGH-A/B), set
 * alone or by `typeset` and the like: each element's text, or UNKNOWN for the whole array (`functions=(…)`).
 */
function functionsBodies(commandWords: string[], assigned: string[]): string[] {
  let p = 0;
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  const set = program === undefined ? assigned : VARIABLE_BUILTINS.has(program) ? args : [];
  return set.flatMap((word) => {
    const assignment = assignmentOf(word);
    if (assignment?.name !== ZSH_FUNCTIONS) return [];
    return [assignment.index === null ? UNKNOWN : assignment.value];
  });
}

/**
 * True when a script run later or in this shell may move it (round 15): text only known when it runs,
 * or a command that changes the folder or what a later `cd` does, where a command starts.
 */
const MOVING_COMMAND =
  /(?:^|[;&|(){}\n]|\b(?:then|do|else)\b)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:cd|pushd|popd|source|\.|eval|alias|unalias|enable|disable|unfunction|builtin|command|exec|setopt|unsetopt|shopt|set|emulate|trap|repeat|noglob|nocorrect|-|autoload|hash|functions(?:\[[^\]]*\])?\+?=)(?=$|[\s;&|(){}])/;

/** A command whose name is only known when it runs (`$c src`, `"$c" src`, `` `x` src``, `$(x) src`). */
const DYNAMIC_COMMAND = /(?:^|[;&|(){}\n]|\b(?:then|do|else)\b)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*["']?[$`]/;

/**
 * True when a script a trap, `emulate -c` or `functions[…]=` runs could move the shell: a command that
 * changes the folder or how it is read, or one whose name is only known when it runs. A variable in an
 * argument (`trap 'rm -f "$tmp"' EXIT`) can't move it.
 */
function scriptMayMove(script: string): boolean {
  return script.includes(UNKNOWN) || DYNAMIC_COMMAND.test(script) || MOVING_COMMAND.test(script);
}

/** Builtins that, given `cd` (or `pushd`, `popd`, `builtin`, `command`), stop it moving the shell (bash and zsh). */
const FOLDER_BUILTINS = new Set(['cd', 'pushd', 'popd', 'builtin', 'command']);

/**
 * True when a command switches off or replaces a folder builtin (round 15, CR HIGH-1): `enable -n cd`
 * (bash), `disable cd`, `unfunction cd`, `unalias cd`; with a name only known when it runs, a pattern
 * (`disable -m 'c*'`) too.
 */
function switchesOffFolderBuiltin(commandWords: string[]): boolean {
  let p = 0;
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  if (program !== 'enable' && program !== 'disable' && program !== 'unfunction' && program !== 'unalias') return false;
  const flags = args.filter((a) => a.startsWith('-'));
  if (program === 'enable' && !flags.some((f) => f.includes('n'))) return false;
  if (flags.some((f) => f.includes('m'))) return true;
  return args.some((a) => !a.startsWith('-') && (a.includes(UNKNOWN) || /[*?[]/.test(a) || FOLDER_BUILTINS.has(a)));
}

/**
 * True when the next word may take a followed variable's value (D-R11-1): never a program's name or
 * a word a wrapper, shell or launcher may run (`$G commit`, `nohup "$P"`), which must stay named in
 * full for review agents (ADR-014); a `cd` target or an ordinary argument may.
 */
function followedHere(words: string[]): boolean {
  const command = stripAssignments(words);
  const first = command[0];
  if (first === undefined) return false;
  const name = plainWriterName(path.posix.basename(first));
  // find runs a program only after -exec / -ok: its start folders and tests may take a value
  if (name === 'find' && command.some((w) => /^-(?:exec|execdir|ok|okdir)$/.test(w))) return false;
  return !WRAPPERS.has(name) && !SHELLS.has(name) && !LAUNCHERS.has(name);
}

/** The first word of a command after `command` / `builtin` / `time`. */
function verbOf(words: string[]): string | undefined {
  return words.find((w) => !CD_PREFIXES.has(w));
}

/**
 * Commands that never set a shell variable (D-R12-1 item 1): an allowlist, so a builtin the reader
 * doesn't know fails closed. Matched only when written plain (not `\\printf` or `"read"`).
 */
const HARMLESS_COMMANDS = new Set(['cd', 'git', 'ls', 'echo', 'test', '[', 'mkdir', 'cp', 'mv', 'rm', 'cat', 'grep', 'true', 'false', ':', 'chmod', 'find', 'touch']);
/*
 * After a script that runs later had a variable filled in (a trap, `emulate -c`, `sched`), a later command
 * that could change that variable unseen makes the call too complex (R-266 round 18, user decision D-R18-1,
 * "refuse only risky setters"): a denylist, everything else is allowed. Read anywhere after the trap: in
 * `{ }`, compound bodies, subshells, `$(…)`, pipelines, and the scripts of later traps, `emulate -c` and
 * `sched` (read with the tokenizer, command by command, past leading assignments and redirects).
 */

/**
 * The variables filled into scripts run later; whether one of those scripts reads the positional
 * parameters, and whether one reads a filled variable unquoted (bash splits it on IFS).
 */
/**
 * What later commands may not change unseen: the variables filled in, whether one is split or the positional
 * parameters read, the names followed through plain assignments (D-R19-1), and of those the ones no value of which
 * starts with `-` (round 20: `wait $pid` waits for it, never reads it as `-p NAME`).
 */
type FilledScripts = { names: Set<string>; positional: boolean; splits: boolean; settled: Set<string>; plainOperands: Set<string> };

/** A positional parameter read in a script: `$1`, `${2}`, `$@`, `$*`, `$#`, zsh's `$argv` / `${argv}` (round 18, SEC INFO-1). */
const POSITIONAL = /\$\{?(?:[0-9@*#]|argv(?![A-Za-z0-9_]))/;

/** A command's word as read (UNKNOWN for what only the run knows) and as written, when known. */
interface LaterWord {
  value: string;
  raw: string | null;
}

/** Commands that run text as commands, define aliases, name variables indirectly or load setters (D-R18-1 item 3). */
const HIDDEN_RUNNERS = new Set(['eval', 'source', '.', 'alias', 'unalias', 'nameref', 'enable', 'disable', 'zle', 'zmodload']);
/** Builtins that declare the names they are given (`export F=…`, `typeset -n R=F`). */
const DECLARING_BUILTINS = new Set(['export', 'local', 'typeset', 'declare', 'readonly', 'integer', 'float', 'private']);
/** Builtins whose words, past their options, are each a name they may set (`read F`, `unset F`, zparseopts' `a=F`). */
const NAME_SETTERS = new Set([
  'read', 'vared', 'unset', 'mapfile', 'readarray', 'getln', 'zparseopts', 'zstyle', 'zformat', 'sysread', 'zregexparse',
  'zselect', 'zsocket', 'ztcp', 'zpty', 'compgen',
]);
/** Builtins that set the variable named by an option's value: `printf -v F`, `print -v F`, `strftime -s F`, bash's `wait -p F`. */
const OPTION_SETTERS: ReadonlyMap<string, string> = new Map([['printf', 'v'], ['print', 'v'], ['strftime', 's'], ['wait', 'p']]);
/** Words before a command that leave it a builtin (`builtin printf`, `command read`, `noglob let`). */
const LATER_PREFIXES = new Set(['builtin', 'noglob', 'nocorrect', '-', 'exec', 'time', 'coproc']);
/** Words that open or join a compound command where a command starts. */
const LATER_KEYWORDS = new Set([...KEYWORDS, '{', '}', 'esac']);
/** Words that start what is no simple command: a test, a case or loop header, a function's name (their setters are read in the text). */
const LATER_HEADERS = new Set(['[[', 'case', 'for', 'select', 'foreach', 'function']);

/** Why a call is refused after a filled script: the first variable filled, and the way out (double quotes expand it when the trap is set). */
function laterChange(filled: FilledScripts): ReadingLimit {
  const name = [...filled.names][0] ?? 'F';
  return new ReadingLimit(`a later command could change \`$${name}\`; or write the trap with double quotes, e.g. \`trap "rm -rf $${name}" EXIT\``);
}

/** True when a word is written out: nothing in it only known when it runs (no `$`, backtick or substitution). */
function writtenOut(word: LaterWord): boolean {
  return !word.value.includes(UNKNOWN) && (word.raw === null || !/[$`]/.test(word.raw));
}

/** True for a name whose change reaches a filled script: a filled variable, IFS when one is split, argv when one reads the positional parameters, a function table. */
function reachesFilled(name: string, filled: FilledScripts): boolean {
  return filled.names.has(name) || (name === 'IFS' && filled.splits) || (name === 'argv' && filled.positional) || name === ZSH_FUNCTIONS || name === 'dis_functions';
}

/** True when a word a builtin sets by (`F`, `F?prompt`, `F[1]`, `a=F`) is not written out or reaches a filled script. */
function setsRisky(word: LaterWord | undefined, filled: FilledScripts, afterEquals = false): boolean {
  if (word === undefined) return false;
  if (!writtenOut(word)) return true;
  const text = afterEquals ? word.value.slice(word.value.lastIndexOf('=') + 1) : word.value;
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text)?.[0];
  return name !== undefined && reachesFilled(name, filled);
}

/**
 * True when an assignment word changes a variable that reaches a filled script; not for a plain assignment of one
 * whose every set was followed and whose values the script was judged with (D-R19-1).
 */
function assignmentRisky(word: string, filled: FilledScripts): boolean {
  const assignment = assignmentOf(word);
  if (assignment === null || !reachesFilled(assignment.name, filled)) return false;
  return !(filled.settled.has(assignment.name) && assignment.index === null && !assignment.append);
}

/** The names an arithmetic text assigns (`F=1`, `F+=1`, `F++`, `--F`). */
const ARITHMETIC_ASSIGNED = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\*\*|<<|>>|[-+*/%&|^])?=(?!=)|(?:\+\+|--)\s*([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+\+|--)/g;

/** True for arithmetic holding a value only known when it runs (`$x = 1`), or assigning a name that reaches a filled script. */
function arithmeticRisky(inside: string, filled: FilledScripts): boolean {
  if (/[$`]/.test(inside) || inside.includes(UNKNOWN)) return true;
  return [...inside.matchAll(ARITHMETIC_ASSIGNED)].some((m) => reachesFilled(m[1] ?? m[2] ?? m[3], filled));
}

/** Where arithmetic starts in a text: `((` (also `$((`), `$[`, and a subscript (`a[…]`, `$H[…]`, `${a[…]}`). */
const ARITHMETIC_START = /\(\(|\$\[|[A-Za-z0-9_}]\[/g;
/** A loop's variable (`for F in`, `select F`, `foreach F`): the name written, or the start of one only known when it runs. */
const LOOP_NAME = /(?:^|[\s;&|(){}])(?:for|select|foreach)\s+([A-Za-z_][A-Za-z0-9_]*|[$`"'])/g;

/**
 * True when text after a filled script, as written (quoted parts included: a later script runs them), sets
 * a variable in a way no command word shows: arithmetic or a subscript with a value only known when it runs
 * or assigning a name that reaches a filled script, a `${…}` that assigns or reads indirectly, a loop over one.
 */
function laterTextRisky(text: string, filled: FilledScripts): boolean {
  if (text.length > MAX_LATER_TEXT) throw new ReadingLimit(`more than ${MAX_LATER_TEXT / 1024} KB after a trap with a variable filled in`);
  if (parameterRisky(text)) return true;
  for (const [, name] of text.matchAll(LOOP_NAME)) if (!/^[A-Za-z_]/.test(name) || reachesFilled(name, filled)) return true;
  const closes = matchingCloses(text);
  /** Where the arithmetic read last ends: one starting before it is inside it, and was read with it. */
  let readTo = -1;
  for (const m of text.matchAll(ARITHMETIC_START)) {
    tick();
    const open = m.index + m[0].length - 1;
    if (open < readTo) continue;
    readTo = closes[open];
    if (arithmeticRisky(text.slice(open + 1, readTo), filled)) return true;
    // an unclosed one runs to the end: nothing after it is left to read
    if (readTo === text.length) break;
  }
  return false;
}

/**
 * True when a text holds a `${…}` that assigns (`${F:=x}`, `${F=x}`, zsh's `${F::=x}`, flags included: what
 * `/\$\{(?:\([^)]*\))?[^}:=]*:{0,2}=/` matches) or reads a variable named by another's value (`${!x}`, zsh's
 * `${(P)x}`: `/\$\{(?:!|\([^)]*P)/`), found in one pass (round 19, PERF MEDIUM-1: those regexes rescan to the
 * end from each unclosed `${(`).
 */
function parameterRisky(text: string): boolean {
  const n = text.length;
  /** From each place, where the next `}`, `:` or `=` is; the next `)`; the next `P` (n when none). */
  const nextStop = new Int32Array(n + 1).fill(n);
  const nextParen = new Int32Array(n + 1).fill(n);
  const nextP = new Int32Array(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i--) {
    const c = text[i];
    nextStop[i] = c === '}' || c === ':' || c === '=' ? i : nextStop[i + 1];
    nextParen[i] = c === ')' ? i : nextParen[i + 1];
    nextP[i] = c === 'P' ? i : nextP[i + 1];
  }
  /** `:{0,2}=` at `at`. */
  const assigns = (at: number): boolean => /^:{0,2}=/.test(text.slice(at, at + 3));
  for (let i = text.indexOf('${'); i !== -1; i = text.indexOf('${', i + 1)) {
    tick();
    const after = i + 2;
    if (text[after] === '!') return true;
    if (assigns(nextStop[after])) return true;
    if (text[after] === '(') {
      const close = nextParen[after + 1];
      if (nextP[after + 1] < close) return true;
      if (close < n && assigns(nextStop[close + 1])) return true;
    }
  }
  return false;
}

/** The most text after a filled script read for setters (round 19, PERF MEDIUM-1): past it the call is too complex. */
const MAX_LATER_TEXT = 64 * 1024;

/**
 * For each `(` and `[` in a text, where its matching `)` or `]` is (each kind counted on its own), or the text's
 * length when it has none: one pass with a stack per kind (round 19, PERF MEDIUM-1).
 */
function matchingCloses(text: string): number[] {
  const closes: number[] = [];
  const stacks: Record<string, number[]> = { '(': [], '[': [] };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') stacks[c].push(i);
    else if (c === ')' || c === ']') {
      const opened = stacks[c === ')' ? '(' : '['].pop();
      if (opened !== undefined) closes[opened] = i;
    }
  }
  for (const stack of Object.values(stacks)) for (const opened of stack) closes[opened] = text.length;
  return closes;
}

/** The options of a name-setting builtin whose value is a name it sets: `read -a F` / `-A F`, zparseopts' `-a`/`-A`/`-F`, `compgen -V F`. */
const NAME_OPTION_LETTERS: ReadonlyMap<string, string> = new Map([['read', 'aA'], ['zparseopts', 'aAF'], ['compgen', 'V']]);

/**
 * True when a builtin that sets the names it is given (`read F`, `mapfile F`, zparseopts' `a=F`) may set a filled
 * variable: a word past the options that names one or is not written out, an option only known when it runs, or
 * an option's value that names one (`read -aF`, `zparseopts -AF`, `compgen -V F`: round 19, SEC MEDIUM-1).
 */
function nameSetterRisky(name: string, args: LaterWord[], filled: FilledScripts): boolean {
  const letters = NAME_OPTION_LETTERS.get(name) ?? '';
  return args.some((a, n) => {
    if (!/^[-+]/.test(a.value)) return setsRisky(a, filled, name === 'zparseopts');
    if (!writtenOut(a)) return true;
    const at = [...a.value.slice(1)].findIndex((c) => letters.includes(c));
    if (at === -1) return false;
    const value = a.value.slice(at + 2);
    return value === '' ? setsRisky(args[n + 1], filled) : setsRisky({ value, raw: null }, filled);
  });
}

/** True when a `set` changes the positional parameters a filled script reads, names an array (`-A F`) that reaches one, or takes a word only known when it runs. */
function setRisky(args: LaterWord[], filled: FilledScripts): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].value;
    if (a.includes(UNKNOWN)) return true;
    if (a === '--' || !/^[-+]/.test(a)) return filled.positional;
    if (/^[-+][A-Za-z]*A/.test(a)) return setsRisky(args[i + 1], filled);
    if (/o$/.test(a)) i++;
  }
  return false;
}

/** True when a declaration (`export`, `typeset` …) makes a nameref, or declares a name not written out or that reaches a filled script. */
function declarationRisky(args: LaterWord[], filled: FilledScripts): boolean {
  return args.some((word) => {
    if (/^[-+]/.test(word.value)) return word.value.includes(UNKNOWN) || word.value.slice(1).includes('n');
    const name = /^[A-Za-z_][A-Za-z0-9_]*(?=$|\+?=|\[)/.exec(word.raw ?? word.value)?.[0];
    return name === undefined || reachesFilled(name, filled);
  });
}

/** True when an option of `printf`/`print`/`strftime`/`wait` (`letter`) names a variable that is not written out or reaches a filled script, or an option is only known when it runs. */
function optionSetterRisky(args: LaterWord[], letter: string, filled: FilledScripts): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].value;
    if (a.includes(UNKNOWN)) return true;
    if (a === '--' || !/^-[A-Za-z]+$/.test(a)) return false;
    const at = a.indexOf(letter);
    if (at === -1) continue;
    return at === a.length - 1 ? setsRisky(args[i + 1], filled) : setsRisky({ value: a.slice(at + 1), raw: null }, filled);
  }
  return false;
}

/** A word that is one variable read as a whole, quoted or not (`$pid`, `"${pid}"`): group 1 is its name. */
const WHOLE_VARIABLE = /^("?)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))\1$/;

/**
 * True when a `wait` may set a filled variable: bash's `-p NAME` naming one (or not written out), or a word only known
 * when it runs that could be read as that option; not an operand that is a followed variable no value of which starts
 * with `-` (`wait $pid` after `pid=$!`: the job it waits for, round 20, CR MEDIUM-2).
 */
function waitRisky(args: LaterWord[], filled: FilledScripts): boolean {
  const operand = (a: LaterWord): boolean => {
    const whole = WHOLE_VARIABLE.exec(a.raw ?? '');
    return whole !== null && filled.plainOperands.has(whole[2] ?? whole[3]);
  };
  // with an option written, every word is read as before
  if (args.some((a) => a.value.startsWith('-'))) return optionSetterRisky(args, 'p', filled);
  return args.some((a) => a.value.includes(UNKNOWN) && !operand(a));
}

/** True when the command after its assignments and prefixes may change a filled variable unseen (D-R18-1 items 1-5). */
function commandRisky(words: LaterWord[], filled: FilledScripts, home: string, depth: number): boolean {
  let i = 0;
  const assigned: string[] = [];
  for (;;) {
    // keywords, after a prefix word too (`time { read F; }`: round 20, CR I-2)
    while (i < words.length && LATER_KEYWORDS.has(words[i].value)) i++;
    if (LATER_HEADERS.has(words[i]?.value ?? '')) return false;
    if (words[i]?.value === 'repeat') i += 2;
    // round 19, CR L-A: assignments after a prefix word too (`time F=.oss`)
    for (; i < words.length && ASSIGNMENT.test(words[i].value); i++) {
      if (assignmentRisky(words[i].value, filled)) return true;
      assigned.push(words[i].value);
    }
    const w = words[i]?.value;
    if (w !== undefined && LATER_PREFIXES.has(w)) {
      i++;
      while (/^-[A-Za-z]*$/.test(words[i]?.value ?? '') && (w === 'time' || w === 'exec')) i++;
    } else if (w === 'command') {
      i++;
      while (/^-[pvV]+$/.test(words[i]?.value ?? '')) {
        // `command -v` / `-V` only looks a name up
        if (/[vV]/.test(words[i].value)) return false;
        i++;
      }
    } else {
      break;
    }
  }
  const rest = words.slice(i);
  const option = optionEffect(rest.map((w) => w.value), assigned);
  if (option.kind !== null || option.extended) return true;
  if (rest.length === 0) return false;
  const [first, ...args] = rest;
  const name = first.value;
  if (name.includes(UNKNOWN)) return true;
  if (HIDDEN_RUNNERS.has(name)) return true;
  if (DECLARING_BUILTINS.has(name)) return declarationRisky(args, filled);
  if (NAME_SETTERS.has(name)) return nameSetterRisky(name, args, filled);
  if (name === 'wait') return waitRisky(args, filled);
  const letter = OPTION_SETTERS.get(name);
  if (letter !== undefined) return optionSetterRisky(args, letter, filled);
  // round 19, SEC MEDIUM-1: `getopts -- optstring name`
  if (name === 'getopts') return setsRisky(args[args[0]?.value === '--' ? 2 : 1], filled);
  if (name === 'let') return args.some((a) => !writtenOut(a) || arithmeticRisky(a.value, filled));
  if (name === 'set') return setRisky(args, filled);
  const values = args.map((a) => a.value);
  const script = name === 'trap' ? trapScript(values) : name === 'sched' ? schedScript(values) : name === 'emulate' ? emulateMode(values).script : null;
  return script !== null && laterScriptRisky(script, filled, home, depth + 1);
}

/** True when a tokenized script holds a command that may change a filled variable unseen; `text`: what it was read from, when known. */
function laterTokensRisky(tokens: Token[], text: string | null, filled: FilledScripts, home: string, depth: number): boolean {
  if (depth > MAX_NESTED_DEPTH) throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  let words: LaterWord[] = [];
  for (const token of tokens) {
    if (token.kind === 'op') {
      if (commandRisky(words, filled, home, depth)) return true;
      words = [];
      continue;
    }
    if (token.scripts?.some((script) => laterTokensRisky(script, null, filled, home, depth + 1))) return true;
    const at = sourceOf(token);
    if (token.kind === 'word') words.push({ value: token.value, raw: text !== null && at !== undefined ? text.slice(at.start, at.end) : null });
  }
  return commandRisky(words, filled, home, depth);
}

/** True when a script run later (a trap's, `emulate -c`'s, `sched`'s) may change a filled variable unseen; an unreadable one may. */
function laterScriptRisky(script: string, filled: FilledScripts, home: string, depth: number): boolean {
  // a piece only known when it runs stays one: a variable's value
  const text = script.split(UNKNOWN).join('$_oss_unknown_');
  if (laterTextRisky(text, filled)) return true;
  const result = tokenize(text, home);
  if ('unreadable' in result) {
    if (result.limit) throw new ReadingLimit(result.reason);
    return true;
  }
  return laterTokensRisky(result.tokens, text, filled, home, depth);
}

/** True when a script reads one of `names` unquoted, so bash splits its value on IFS. */
function readsUnquoted(script: string, names: ReadonlyMap<string, string>): boolean {
  const read = unquotedReads(script);
  return [...names.keys()].some((name) => read.has(name));
}

/** The names a script reads unquoted (`$F`, `${F}`), in one pass (R-266 round 21, PERF MEDIUM-1). */
function unquotedReads(script: string): Set<string> {
  const read = new Set<string>();
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < script.length; i++) {
    tick();
    const c = script[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') {
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === '$' && quote === null) {
      UNQUOTED_NAME.lastIndex = i + 1;
      const match = UNQUOTED_NAME.exec(script);
      if (match !== null) read.add(match[1]);
    }
  }
  return read;
}
/** A name read after `$`, as `NAME` or `{NAME`. */
const UNQUOTED_NAME = /\{?([A-Za-z_][A-Za-z0-9_]*)/y;
/**
 * `test` / `[` operators that read their operand as a variable, subscript included: bash evaluates the
 * subscript as arithmetic and runs a `$(…)` in it (R-266 round 13, CR M-1). printf is not harmless at
 * all: zsh evaluates each numeric argument as arithmetic (`printf %d F=7` sets F).
 */
const TEST_VARIABLE_OPERATORS = new Set(['-v', '-R']);

/** Text that may set a variable through another's value: arithmetic, `[[`, a `${…}` other than `${NAME}`, or `$'…'`. */
const MAY_ASSIGN = /\(\(|\$\[|\[\[|\$\{(?![A-Za-z_][A-Za-z0-9_]*\})|\$'/;
/** A trap script that can set nothing: plain words only, no `=`, `$`, quote, bracket or wildcard. */
const QUIET_SCRIPT = /^[A-Za-z0-9_./@%+,:\s;&|-]*$/;

/**
 * True for a `trap` written plain whose script (as expanded) sets nothing when it runs (round 16, PERF
 * LOW-1): each of its commands is a harmless one, in plain words (`trap "rm -rf build" INT`).
 */
function setsNothing(commandWords: string[], first: Token | undefined, text: string, start: number, end: number): boolean {
  const at = first === undefined ? undefined : sourceOf(first);
  if (commandWords[0] !== 'trap' || at === undefined || text.slice(at.start, at.end) !== 'trap' || MAY_ASSIGN.test(text.slice(start, end))) return false;
  const script = trapScript(commandWords.slice(1));
  if (script === null || !QUIET_SCRIPT.test(script) || scriptMayMove(script)) return false;
  return script.split(/[;&|\n]+/).every((command) => {
    const program = command.trim().split(/\s+/)[0];
    return program === '' || HARMLESS_COMMANDS.has(program);
  });
}

/** The signals a trap's script runs on are only the shell's exit (`EXIT`, `0`, bash's `SIGEXIT`), round 16, CR LOW-1. */
function exitOnly(args: string[]): boolean {
  let i = 0;
  while (i < args.length && /^-[lp]+$/.test(args[i])) i++;
  if (args[i] === '--') i++;
  const signals = args.slice(i + 1);
  return signals.length > 0 && signals.every((signal) => /^(?:(?:SIG)?EXIT|0)$/.test(signal));
}

/**
 * True when the segment just read can't set a variable: assignments alone, or a harmless command
 * written plain (`test` without `-v`, a `cd` to a known folder), with no arithmetic, `[[`, `${…}`
 * that could assign, or `$'…'` anywhere in it.
 */
function harmlessCommand(commandWords: string[], first: Token | undefined, text: string, start: number, end: number, globs: ReadonlyMap<string, string>): boolean {
  if (start !== -1 && MAY_ASSIGN.test(text.slice(start, end))) return false;
  const name = commandWords[0];
  if (name === undefined) return true;
  const at = first === undefined ? undefined : sourceOf(first);
  if (at === undefined || text.slice(at.start, at.end) !== name || !HARMLESS_COMMANDS.has(name)) return false;
  const args = commandWords.slice(1);
  // an operand only known when it runs, or a wildcard, could be `-v`
  if (name === 'test' || name === '[') return !args.some((w) => TEST_VARIABLE_OPERATORS.has(w) || w.includes(UNKNOWN) || globs.has(w));
  if (name === 'cd') return args.length === 1 && !args[0].includes(UNKNOWN) && !args[0].startsWith('-');
  return true;
}

function split(
  tokens: Token[],
  cwd: string,
  home: string,
  toplevel: ToplevelOf | null = null,
  dots = false,
  startCdpath: string[] | null = null,
  cdpathSetUnseen = false,
  text: string | null = null,
  tmpdirSet = true,
  trusted: (token: Token | undefined) => boolean = () => false,
  env: Readonly<Record<string, string | undefined>> = {},
  anyUnknownWrites = false,
  /** The value of a word or redirect target read through a modified variable (`$X:h`), unknown from there on; else null (round 13). */
  opaqueOf: (token: Extract<Token, { kind: 'word' | 'redirect' }>) => string | null = () => null,
  /** The shell was started with an option the reader doesn't model (why), else null: as after `setopt` of one (round 14). */
  optionSet: LostDir | null = null,
): Segment[] {
  const segments: Segment[] = [];
  /**
   * `( … )` groups restore the directory (and glob options) they started in; `{ … }` groups (dir null) do
   * not, unless they run apart (piped, backgrounded) or are a function's body, which runs only when called.
   */
  const groups: { dir: string | null; lost: LostDir | null; dotGlob: boolean; start: number; at: Opened; body: boolean }[] = [];
  /** Keyword compounds open (`if`, `while`, `until`, `for`, `select`, `case`), innermost last. */
  const compounds: Opened[] = [];
  /** The compound or `{ … }` group that just closed: run apart when a pipe or `&` follows it (round 11). */
  let closedCompound: Opened | null = null;
  /** The variables set earlier in the call that may be followed (D-R11-1), by name. */
  const known = new Map<string, Followed>();
  /** The operators of the and-or list being read so far: none, only `&&`, or a `||`. */
  let listOps: 'none' | 'and' | 'or' = 'none';
  /** A function was defined: it could run anywhere after, so no variable is followed from then on. */
  let functionDefined = false;
  /**
   * Only harmless commands have run so far in this shell (D-R12-1): a variable the command never sets
   * may still be read from the environment.
   */
  let envClean = true;
  /** Where in `text` a script that runs later had a variable filled in, else -1: every command after it must set none (round 17). */
  let filledAfter = -1;
  /** The variables filled into those scripts, and whether one reads the positional parameters or splits one (D-R18-1). */
  const filled: FilledScripts = { names: new Set(), positional: false, splits: false, settled: new Set(), plainOperands: new Set() };
  /** Where the segment being read starts and ends in `text`, for the harmless-command check. */
  let segmentStart = -1;
  let segmentEnd = -1;
  /** The next `{ … }` group is a function's body. */
  let bodyNext = false;
  /**
   * Set once an alias is defined (or bash's expand_aliases is on), or a function that moves the shell:
   * any later command could move it, so the directory stays unknown for the rest of the call (SEC MEDIUM-1).
   */
  let sticky: LostDir | null = optionSet;
  /** A shell option the reader doesn't model was set (round 14): a write through any unknown part is refused, a bare one too. */
  let optionUnknown = optionSet !== null;
  /** extendedglob was set: `#`, `^` and `~` are wildcards from here (round 15, D-R14-4). */
  let extendedGlob = false;
  /** The word tokens of the segment being read, alongside `words`. */
  let wordTokens: Token[] = [];
  const pushed: string[] = [];
  /** Words skipped up to the next operator (`for` header), up to `in` (`case` header), or one (function name). */
  let header: 'for' | 'case' | 'name' | null = null;
  let casePatterns = false;
  let caseDepth = 0;
  let closedGroupStart: number | null = null;
  let afterPipe = false;
  let dir = cwd;
  let lost: LostDir | null = sticky;
  /** A `GIT_*` variable was set or exported: git may then find another repo, or none (fix round 4, K2). */
  let gitVariableSet = false;
  /** The shell's patterns match dot entries (`shopt -s dotglob`, `setopt globdots` …), fix round 4, K2. */
  let dotGlob = dots;
  /** The folders `cd` searches (CDPATH, zsh's `cdpath` array), null when none; K8. */
  let cdpath = startCdpath;
  /** zsh's `cdpath=(…)` / `cdpath+=(…)`: the array's words come as the next segment. */
  let cdpathArray: 'set' | 'append' | null = null;
  /** A word or redirect target of the segment being read has a qualifier that matches dot entries (`*(D)`). */
  let dotsWord = false;
  /** What the next segment's stdin is piped from, set at a `|`. */
  let pipedFrom: Segment | 'unknown' | null = null;
  let words: string[] = [];
  let redirects: Segment['redirects'] = [];
  let globs = new Map<string, string>();
  /** Indices in `words` (assignments included) of the words holding a command substitution. */
  let substitutedWords = new Set<number>();
  let substitutedRedirects = new Set<string>();
  /** The same, for any unknown part (round 12, D-R12-1). */
  let unknownWords = new Set<number>();
  let unknownRedirects = new Set<string>();
  /** Substitutions seen since the last segment, even in words that are skipped (a `for` list). */
  let scripts: Token[][] = [];

  const atCommandStart = (): boolean => words.length === 0 && redirects.length === 0;

  const openGroup = (groupDir: string | null): void => {
    if (groups.length >= MAX_GROUP_DEPTH) throw new ReadingLimit(`groups nested deeper than ${MAX_GROUP_DEPTH}`);
    groups.push({ dir: groupDir, lost, dotGlob, start: segments.length, at: { dir, lost, afterPipe }, body: groupDir === null && bodyNext });
    bodyNext = false;
  };

  const openCompound = (): void => {
    if (compounds.length >= MAX_GROUP_DEPTH) throw new ReadingLimit(`groups nested deeper than ${MAX_GROUP_DEPTH}`);
    compounds.push({ dir, lost, afterPipe });
  };

  const closeCompound = (): void => {
    closedCompound = compounds.pop() ?? null;
  };

  /** The value a variable is set to, when the reader may follow it: plain text, the repo's top folder, or a new temp folder. */
  const followable = (token: Token | undefined): Omit<Followed, 'andOnly'> | null => {
    const at = token === undefined ? undefined : sourceOf(token);
    if (text === null || token === undefined || token.kind !== 'word' || at === undefined || opaqueOf(token) !== null) return null;
    const assignment = assignmentOf(token.value);
    if (assignment === null || assignment.index !== null || assignment.append) return null;
    const raw = text.slice(at.start, at.end);
    const written = raw.slice(raw.indexOf('=') + 1);
    if (TOPLEVEL_VALUE.test(written)) {
      const top = toplevel !== null && lost === null && !gitVariableSet ? toplevel(dir) : null;
      return top === null ? null : { value: top, setEnd: at.end };
    }
    const temp = NEW_TEMP_VALUE.exec(written);
    if (temp !== null) {
      const made = temp[2] === undefined ? NEW_TEMP_FILE : NEW_TEMP_FOLDER;
      return plainMentions(text, 'TMPDIR') === 0 ? { value: path.join(os.tmpdir(), made), setEnd: at.end } : null;
    }
    // round 21, CR L-b: any other `$(mktemp …)` is the path its words name (macOS takes a template with no X as written)
    MKTEMP_VALUE.lastIndex = 0;
    const madeBy = MKTEMP_VALUE.exec(written);
    if (madeBy !== null && madeBy[0].length === written.length) {
      const pattern = mktempPattern((madeBy[2] ?? madeBy[3]).trim().split(/[ \t]+/).filter(Boolean), home, plainMentions(text, 'TMPDIR') > 0);
      if (pattern === null || pattern === '') return null;
      return { value: pattern.split(MKTEMP_ANY).join('*'), setEnd: at.end, ...(pattern.includes(MKTEMP_ANY) ? { wild: true } : {}) };
    }
    // round 15, PEN LOW-1: an unquoted value that starts with the home folder (`$HOME/x`, `${HOME}/x`, `~/x`) is that folder
    const head = HOME_HEAD.exec(written);
    if (head !== null) {
      const rest = written.slice(head[0].length);
      if (home.includes(UNKNOWN) || (rest !== '' && !PLAIN_VALUE.test(rest)) || /['"]/.test(rest)) return null;
      const value = home + rest;
      return { value, setEnd: at.end, ...(WILD_VALUE.test(rest) ? { wild: true } : {}) };
    }
    const { value } = assignment;
    if (!PLAIN_VALUE.test(written) || value === '' || value.includes(UNKNOWN) || value.includes('~')) return null;
    return { value, setEnd: at.end, ...(WILD_VALUE.test(value) ? { wild: true } : {}) };
  };

  /**
   * The value of a word or redirect target whose variables the reader may all follow here, wherever they
   * sit in it (`"$D"`, `"$D/out.txt"`, `${D}/x`, `.oss/tool-gates.$D`, `$D/$E`: round 15, SEC MEDIUM-A),
   * the rest plain: each set earlier in the command, or one it never sets read from the environment
   * (D-R12-1); else null. `command`: a word of a command, which never takes a value where it names what runs.
   */
  /** The pattern of the value `followedValue` last returned, when it is one (round 14); reset before each call. */
  let wildGlob: string | undefined;
  /** `text` with each trap that sets nothing blanked, searched for setters between a set and a use (round 16, PERF LOW-1). */
  let settersRead = text ?? '';
  /** One variable's value at `use`, and whether it holds wildcard characters; null when it can't be followed. */
  const followOne = (name: string, use: number): { value: string; wild: boolean } | null => {
    if (text === null) return null;
    const found = known.get(name);
    if (found !== undefined) return mayFollow(text, name, found.setEnd, use, settersRead) ? { value: found.value, wild: found.wild === true } : null;
    if (!envClean || !mayReadEnvironment(text, name, use)) return null;
    const fromEnv = env[name];
    return fromEnv === undefined || fromEnv === '' || fromEnv.includes(UNKNOWN) || /[*?[\n]/.test(fromEnv) ? null : { value: fromEnv, wild: false };
  };
  const followedValue = (token: Extract<Token, { kind: 'word' | 'redirect' }>, value: string, command: boolean): string | null => {
    const at = sourceOf(token);
    if (text === null || at === undefined || functionDefined || sticky !== null || token.scripts !== undefined || !value.includes(UNKNOWN)) return null;
    const refs = variableReferences(text.slice(at.start, at.end), home);
    const texts = value.split(UNKNOWN);
    if (refs === null || refs.length !== texts.length - 1) return null;
    if (command && !followedHere(words)) return null;
    const glob = globOf(token);
    const patterns = glob === undefined ? texts.map(escapeGlob) : glob.split(UNKNOWN);
    if (patterns.length !== texts.length) return null;
    let out = texts[0];
    let pattern = patterns[0];
    let wild = glob !== undefined;
    for (let n = 0; n < refs.length; n++) {
      const { name, quoted } = refs[n];
      const followed = followOne(name, at.start);
      // round 16, CR MEDIUM-1: the variables followed so far stay known, the rest unknown (`D=.oss; "$D/$X"` is `.oss/` + unknown)
      if (followed === null) return n === 0 ? null : unfollowedRest(out, pattern, texts, patterns, n, wild);
      // unquoted, bash splits the value at IFS and expands wildcards in it; quoted, it is literal (round 14, SEC HIGH-3)
      if (!quoted && (/\s/.test(followed.value) || plainMentions(text, 'IFS') > 0)) return null;
      const asPattern = !quoted && followed.wild;
      wild ||= asPattern;
      out += followed.value + texts[n + 1];
      pattern += (asPattern ? valuePattern(followed.value) : escapeGlob(followed.value)) + patterns[n + 1];
    }
    if (wild) wildGlob = pattern;
    return out;
  };

  /** A word whose first `n` variables were followed (`out`, `pattern`), the rest left unknown. */
  const unfollowedRest = (out: string, pattern: string, texts: string[], patterns: string[], n: number, wild: boolean): string => {
    if (wild) wildGlob = pattern + patterns.slice(n + 1).map((p) => UNKNOWN + p).join('');
    return out + texts.slice(n + 1).map((t) => UNKNOWN + t).join('');
  };

  /**
   * The text a `trap` or `emulate -c` string holds once the shell has expanded it (round 15, SEC
   * HIGH-A/B), which the shell runs later as a script: each variable set to a literal earlier in the
   * command (or read from the environment, ADR-035) filled in, one the command never sets left as
   * `${NAME}` (unknown when the script runs). A `$(…)` in the string, or a variable the command sets
   * to a value only known when it runs, can't be expanded: the call is refused as too complex.
   */
  const expandedScript = (token: Extract<Token, { kind: 'word' }>): string => {
    const { value } = token;
    const at = sourceOf(token);
    // not following variables (a review agent's call): a string that reads any is unknown, and an unknown piece is refused there
    if (text === null || at === undefined) {
      if (text !== null && value.includes(UNKNOWN)) throw new ReadingLimit(CANNOT_EXPAND);
      return DYNAMIC_SCRIPT.test(value) ? value + UNKNOWN : value;
    }
    // round 16, SEC HIGH-1: a subscript or modifier (`$HOME[1,-1]`, `${X:h}`) changes the value in ways the gate doesn't model
    if (modifiedVariable(text.slice(at.start, at.end))) throw new ReadingLimit(CANNOT_EXPAND);
    // the string is expanded when the trap is set, before the command's own `trap` word (a setter the reader looks for)
    const setAt = segmentStart === -1 ? at.start : segmentStart;
    let out = value;
    if (value.includes(UNKNOWN)) {
      if (token.scripts !== undefined) throw new ReadingLimit(CANNOT_EXPAND);
      const refs = variableReferences(text.slice(at.start, at.end), home, true);
      const texts = value.split(UNKNOWN);
      if (refs === null || refs.length !== texts.length - 1) throw new ReadingLimit(CANNOT_EXPAND);
      out = texts[0];
      for (let n = 0; n < refs.length; n++) {
        const { name } = refs[n];
        const special = SPECIAL_PARAMETERS.has(name);
        // round 16, SEC HIGH-1: a name the shell keeps itself (`$PWD`, `$OLDPWD`, `$_`) is never known
        if (!special && neverFollowed(name)) throw new ReadingLimit(CANNOT_EXPAND);
        const followed = special ? null : followOne(name, setAt);
        if (followed !== null) out += followed.value;
        else if (special) out += `$${name}`;
        else if (plainMentions(text, name) === 0) out += `\${${name}}`;
        else throw new ReadingLimit(CANNOT_EXPAND);
        out += texts[n + 1];
      }
    }
    return filledLater(out, setAt, at);
  };

  /**
   * A script the shell runs later or in this shell (a trap, `emulate -c`, `sched`) with each variable it
   * reads that the command sets filled in, as it is when the script runs (round 16, SEC HIGH-1): followed
   * to where the script is set, and set by nothing after it. One followed but maybe set after, or read some
   * other way (`${F:-x}`, `$F[1]`), leaves the script unknown (an UNKNOWN added). One the command sets to a
   * value only known when it runs, or never sets, is left as written: an unknown value (ADR-036).
   *
   * Every variable the script reads that the command sets is watched: a later command that may change it unseen
   * makes the call too complex (round 18, D-R18-1). One not followed to the script (set after it, or before and
   * after) whose every set is a plain assignment to plain text, empty, `$?`, `$!` or `$(mktemp …)` is followed
   * instead (round 19, D-R19-1, "follow later values"): those assignments are allowed after the trap, and the
   * script is judged once per plain value it may hold, besides as written (empty, unset, or only known when it
   * runs). Any other set of it (`read`, a loop, `$(cat …)`, `unset`, a set behind a prefix word) is refused.
   */
  const filledLater = (script: string, setAt: number, span: { start: number; end: number }): string => {
    if (text === null) return script;
    const after = span.end;
    const values = new Map<string, string>();
    /** A followed value the script can't take as plain text, or one maybe set after: the script stays unknown, and is watched as a filled one (round 18). */
    let unknown = false;
    /** The variables the script reads that the command sets, followed or not: a later option (`set -o globsubst`) can change what one means (round 18). */
    const watched = new Map<string, string>();
    /** The plain values each variable set only by plain assignments may hold when the script runs (D-R19-1). */
    const settled = new Map<string, string[]>();
    /** The names the script reads unquoted, when the command mentions IFS: read once (round 21, PERF MEDIUM-1). */
    const splitting = plainMentions(text, 'IFS') > 0 ? unquotedReads(script) : null;
    for (const [, name] of script.matchAll(REFERENCED_NAME)) {
      if (name === 'HOME' || watched.has(name) || plainMentions(text, name) === 0) continue;
      watched.set(name, '');
      const followed = followOne(name, setAt);
      if (followed === null) {
        // round 20, CR MEDIUM-1: bash splits a value read unquoted at IFS, which the command changes
        const splits = splitting !== null && splitting.has(name);
        const later = unchangedAfter(text, after) && !splits ? settledValues(text, name, span, home) : null;
        if (later !== null) settled.set(name, later);
        continue;
      }
      unknown ||= followed.wild === true || !LATER_VALUE.test(followed.value) || !unchangedAfter(text, after);
      values.set(name, followed.value);
    }
    if (watched.size === 0) return script;
    if (filledAfter === -1) filledAfter = after;
    for (const name of watched.keys()) filled.names.add(name);
    for (const [name, plain] of settled) {
      filled.settled.add(name);
      if (plain.every((v) => !v.startsWith('-'))) filled.plainOperands.add(name);
    }
    filled.positional ||= POSITIONAL.test(script);
    filled.splits ||= readsUnquoted(script, watched);
    // round 18, D-R18-1: the script's own commands run after the trap is set too
    if (laterScriptRisky(script, filled, home, 1)) throw laterChange(filled);
    const read = values.size === 0 ? script : unknown ? script + UNKNOWN : filledReferences(script, values) ?? script + UNKNOWN;
    return withSettledValues(script, read, values, settled, unknown, filled);
  };

  /**
   * The script as read (`read`: each variable with an unknown value left as written), preceded by one copy per
   * combination of the plain values the variables set by plain assignments may hold, each in its own subshell so
   * one's `cd` doesn't move the next (D-R19-1): each copy is judged as the script could run.
   */
  const withSettledValues = (
    script: string,
    read: string,
    values: ReadonlyMap<string, string>,
    settled: ReadonlyMap<string, string[]>,
    unknown: boolean,
    seen: FilledScripts,
  ): string => {
    let combinations: Map<string, string>[] = [new Map(values)];
    for (const [name, plain] of settled) {
      if (plain.length === 0) continue;
      combinations = combinations.flatMap((c) => [c, ...plain.map((v) => new Map([...c, [name, v]]))]);
      if (combinations.length > MAX_SCRIPT_VARIANTS + 1) throw laterChange(seen);
    }
    const copies = combinations.slice(1).map((c) => {
      const copy = unknown ? null : filledReferences(script, c);
      if (copy === null) throw laterChange(seen);
      return `(\n${copy}\n)\n`;
    });
    return copies.join('') + read;
  };

  /** A path that starts with `$(git rev-parse --show-toplevel)` and holds nothing else unknown, with the top folder filled in (round 11). */
  const underToplevel = (token: Extract<Token, { kind: 'word' | 'redirect' }>, value: string): string | null => {
    if (toplevel === null || lost !== null || gitVariableSet || !value.startsWith(UNKNOWN) || value.indexOf(UNKNOWN, 1) !== -1) return null;
    const script = token.scripts?.length === 1 ? token.scripts[0] : null;
    if (script === null || script.length !== TOPLEVEL_WORDS.length || !script.every((t, n) => t.kind === 'word' && t.value === TOPLEVEL_WORDS[n])) return null;
    const top = toplevel(dir);
    return top === null ? null : top + value.slice(UNKNOWN.length);
  };

  const close = (next: string | null): void => {
    if (atCommandStart() && scripts.length === 0) return;
    const commandWords = stripAssignments(words);
    const assigned = words.slice(0, words.length - commandWords.length);
    segments.push({
      words: commandWords,
      assignments: assignedNames(assigned),
      assignmentValues: assignedValues(assigned),
      redirects,
      globs,
      substituted: {
        words: new Set([...substitutedWords].map((n) => n - (words.length - commandWords.length)).filter((n) => n >= 0)),
        redirects: substitutedRedirects,
      },
      unknown: {
        words: new Set([...unknownWords].map((n) => n - (words.length - commandWords.length)).filter((n) => n >= 0)),
        redirects: unknownRedirects,
      },
      cwd: dir,
      lostDir: lost,
      exits: [{ op: next, following: segments.length + 1 }],
      scripts,
      dotGlob: dotGlob || dotsWord,
      pipedFrom,
      wordTokens: wordTokens.slice(words.length - commandWords.length),
    });
    const apart = afterPipe || isPipe(next) || next === '&';
    // zsh runs the last command of a pipeline in this shell, bash apart (round 11)
    const mayRunHere = !isPipe(next) && next !== '&';
    if (cdpathArray !== null) {
      cdpath = compactCdpath(cdpathArray === 'append' ? [...(cdpath ?? []), ...commandWords] : commandWords);
      cdpathArray = null;
    }
    // round 16, PERF LOW-1: a trap whose script was read and sets nothing is harmless between a set and a use
    const quietTrap = text !== null && segmentStart !== -1 && assigned.length === 0 && setsNothing(commandWords, wordTokens[0], text, segmentStart, segmentEnd);
    if (quietTrap) settersRead = settersRead.slice(0, segmentStart) + ' '.repeat(segmentEnd - segmentStart) + settersRead.slice(segmentEnd);
    // round 18, D-R18-1: after a script with a variable filled in, a command that may change one unseen (`printf -v $(…)`) hides its value
    if (text !== null && filledAfter !== -1 && segmentStart >= filledAfter) {
      const later = words.map((value, n): LaterWord => {
        const at = wordTokens[n] === undefined ? undefined : sourceOf(wordTokens[n]);
        return { value, raw: at === undefined ? null : text.slice(at.start, at.end) };
      });
      if (commandRisky(later, filled, home, 0) || scripts.some((script) => laterTokensRisky(script, null, filled, home, 1))) throw laterChange(filled);
    }
    // anything but a harmless command could set a variable: nothing set before it is followed past it (D-R12-1)
    if (text !== null && !quietTrap && !harmlessCommand(commandWords, wordTokens[assigned.length], text, segmentStart, segmentEnd, globs)) {
      known.clear();
      envClean = false;
    }
    segmentStart = -1;
    segmentEnd = -1;
    // a variable set alone, in this shell, where it surely ran when a later command runs (D-R11-1)
    if (commandWords.length === 0 && !apart && listOps !== 'or' && !functionDefined) {
      assigned.forEach((word, n) => {
        const name = assignmentOf(word)?.name;
        if (name === undefined) return;
        known.delete(name);
        const value = followable(wordTokens[n]);
        if (value !== null) known.set(name, { ...value, andOnly: listOps === 'and' });
      });
    }
    // `CDPATH=x cd y` searches x for this cd only (read only when a command follows the assignments: K12)
    const named = commandWords.length > 0 ? cdpathAfter(assigned, [], cdpath) : cdpath;
    const searched = cdpathSetUnseen ? [...(named ?? []), UNKNOWN] : named;
    if (!apart) {
      ({ dir, lost } = dirAfter(commandWords, { dir, lost }, pushed, home, globs, searched));
      dotGlob = dotGlobAfter(commandWords, assigned, dotGlob);
    } else if (mayRunHere) {
      const moved = dirAfter(commandWords, { dir, lost }, [...pushed], home, globs, searched);
      if (moved.dir !== dir || moved.lost !== lost) lost = { why: commandWords.join(' '), pattern: null };
    }
    const verb = verbOf(commandWords);
    if (mayRunHere && verb === 'eval' && evalMayMove(commandWords)) {
      // the text it runs can move the shell (SEC MEDIUM-1)
      lost = { why: commandWords.join(' '), pattern: null };
    }
    if (mayRunHere && ((verb === 'alias' && commandWords.length > 1) || (verb === 'shopt' && commandWords.includes('expand_aliases')))) {
      sticky = { why: commandWords.join(' '), pattern: null };
    }
    // a shell option the reader doesn't model: the folder and every variable are unknown from here (round 14)
    const options = mayRunHere ? optionEffect(commandWords, assigned) : null;
    extendedGlob ||= options?.extended === true;
    if (options?.kind != null) {
      // the option as written, an assignment alone included (`options[cdablevars]=on`, round 15, CR L2)
      const why = [...assigned, ...commandWords].join(' ');
      optionUnknown = true;
      if (options.kind === 'full') sticky = { why, pattern: null };
      else sticky ??= { why, pattern: null, plainKnown: true };
    }
    if (mayRunHere && sticky?.plainKnown === true && (verb === 'cd' || verb === 'pushd' || verb === 'popd')) {
      // after such an option, a folder change is not followed (round 15, D-R14-4)
      sticky = { why: commandWords.join(' '), pattern: null };
    }
    // round 15, CR HIGH-1: `cd` switched off (`enable -n cd`, `disable cd`, `unfunction cd`) no longer moves the shell;
    // `repeat N cmd` runs cmd N times, which moves the folder each time when cmd may move it (round 16, CR LOW-1)
    const repeated = verb === 'repeat' && scriptMayMove(commandWords.slice(commandWords.indexOf(verb) + 2).join(' '));
    if (mayRunHere && (repeated || switchesOffFolderBuiltin(commandWords))) sticky = { why: commandWords.join(' '), pattern: null };
    // round 15, SEC HIGH-A/B: a trap or zsh function runs its text later (a DEBUG trap before each command); emulate -c runs it now.
    // Round 16, CR LOW-1: an EXIT trap set outside a function runs when the shell exits, after every write of the command
    const trapArgs = verb === 'trap' ? commandWords.slice(commandWords.indexOf(verb) + 1) : [];
    const atExit = verb === 'trap' && !groups.some((g) => g.body) && !functionDefined && exitOnly(trapArgs);
    const later = [...(verb === 'trap' && !atExit ? [trapScript(trapArgs)] : []), ...functionsBodies(commandWords, assigned)];
    if (mayRunHere && later.some((script) => script !== null && scriptMayMove(script))) sticky = { why: [...assigned, ...commandWords].join(' '), pattern: null };
    const emulated = verb === 'emulate' ? emulateMode(commandWords.slice(commandWords.indexOf(verb) + 1)).script : null;
    if (mayRunHere && emulated !== null && scriptMayMove(emulated)) lost = { why: commandWords.join(' '), pattern: null };
    // a sourced file may move the shell, or define a `cd` or alias that moves it later; OSS's own hook files are trusted
    if (mayRunHere && (verb === 'source' || verb === '.')) {
      const at = words.length - commandWords.length + commandWords.indexOf(verb) + 1;
      if (!trusted(wordTokens[at])) sticky = { why: commandWords.join(' '), pattern: null };
    }
    if (sticky !== null) lost = sticky;
    cdpathArray = cdpathArrayOf(commandWords, assigned);
    cdpath = cdpathAfter(commandWords.length === 0 ? assigned : [], VARIABLE_BUILTINS.has(commandWords[0] ?? '') ? commandWords.slice(1) : [], cdpath);
    gitVariableSet ||= setsGitVariable(commandWords, assigned);
    dotsWord = false;
    pipedFrom = null;
    words = [];
    wordTokens = [];
    redirects = [];
    globs = new Map();
    substitutedWords = new Set();
    substitutedRedirects = new Set();
    unknownWords = new Set();
    unknownRedirects = new Set();
    scripts = [];
  };

  const readWord = (w: string, glob: string | undefined): void => {
    if (glob !== undefined) globs.set(w, glob);
    if (casePatterns) {
      if (w === 'esac') {
        caseDepth--;
        casePatterns = false;
        closeCompound();
        known.clear();
      }
    } else if (header === 'case') {
      if (w === 'in') {
        header = null;
        casePatterns = true;
      }
    } else if (header === 'name') {
      header = null;
    } else if (header === 'for') {
      // the loop's variable and list are not commands
    } else if (!atCommandStart()) {
      if (w === '{' && TIMED_GROUP.test(words.join(' '))) {
        // `time { … }` (bash: `time -p { … }`) times a group: read as `time; { … }` (round 20, CR I-2), as `time ( … )` is
        close(';');
        openGroup(null);
      } else {
        words.push(w);
      }
    } else if (w === 'for' || w === 'select') {
      header = 'for';
      openCompound();
      known.clear();
    } else if (w === 'case') {
      header = 'case';
      caseDepth++;
      openCompound();
      known.clear();
    } else if (w === 'esac') {
      caseDepth = Math.max(0, caseDepth - 1);
      closeCompound();
      known.clear();
    } else if (w === 'function') {
      header = 'name';
      functionDefined = true;
      bodyNext = true;
      known.clear();
    } else if (w === '{') {
      openGroup(null);
      // inside a group reached through `&&`, what came before surely ran, whatever its `;` (D-R11-1)
      for (const found of known.values()) found.andOnly = false;
    } else if (w === '}') {
      const group = groups.pop();
      known.clear();
      if (group !== undefined) {
        closedGroupStart = group.start;
        if (group.body) {
          // a function's body runs only when it is called: where it would move the shell is not known (round 11)
          if (dir !== group.at.dir || lost !== group.at.lost) sticky = { why: 'a function that changes the folder', pattern: null };
          ({ dir, lost } = group.at);
          if (sticky !== null) lost = sticky;
        } else {
          closedCompound = group.at;
        }
      }
    } else if (!KEYWORDS.has(w)) {
      words.push(w);
    } else {
      if (COMPOUND_OPEN.has(w)) openCompound();
      if (COMPOUND_CLOSE.has(w)) closeCompound();
      if (FORGET_AT.has(w)) known.clear();
    }
    if (atCommandStart() && words.length === 0) listOps = 'none';
  };

  /** With extendedglob (or an unknown option) on, a word's zsh pattern, which covers its plain one (round 16, CR HIGH-1). */
  const zshGlobOf = (token: Token): string | undefined => (optionUnknown || extendedGlob ? extendedGlobOf(token) : undefined);

  for (let k = 0; k < tokens.length; k++) {
    tick();
    const token = tokens[k];
    if (token.kind !== 'op' && token.scripts !== undefined) scripts.push(...token.scripts);
    const span = token.kind === 'op' ? undefined : sourceOf(token);
    if (span !== undefined) {
      if (segmentStart === -1) segmentStart = span.start;
      segmentEnd = span.end;
    }
    if (dotsOf(token)) dotsWord = true;
    if (token.kind === 'word') {
      // `$(git rev-parse --show-toplevel)` from a folder the reader knows is that repo's top folder
      const top = toplevel !== null && lost === null && !gitVariableSet && isToplevelWord(token) ? toplevel(dir) : null;
      const opaque = opaqueOf(token);
      wildGlob = undefined;
      const value = scriptOperandNext(words)
        ? expandedScript(token)
        : opaque ?? top ?? underToplevel(token, token.value) ?? followedValue(token, token.value, true) ?? token.value;
      // an opaque word is unknown from its first variable on, so its pattern is too (Task 24: `$arr[1]` is no `[1]` glob)
      readWord(value, opaque !== null ? undefined : wildGlob ?? zshGlobOf(token) ?? globOf(token));
      if (words.length > wordTokens.length) {
        wordTokens.push(token);
        if (value.includes(UNKNOWN) && !isNewTempFile(token, tmpdirSet)) {
          // a modified variable leaves no known tail: refused as a write target, as a bare `$(…)` is
          if (token.scripts !== undefined || opaque !== null || optionUnknown) substitutedWords.add(words.length - 1);
          if (anyUnknownWrites) unknownWords.add(words.length - 1);
        }
      }
    }
    else if (token.kind === 'redirect') {
      const body = heredocBodyOf(token);
      const opaque = opaqueOf(token);
      wildGlob = undefined;
      const target = opaque ?? underToplevel(token, token.target) ?? followedValue(token, token.target, false) ?? token.target;
      if (target.includes(UNKNOWN) && !isNewTempFile(token, tmpdirSet)) {
        if (token.scripts !== undefined || opaque !== null || optionUnknown) substitutedRedirects.add(target);
        if (anyUnknownWrites) unknownRedirects.add(target);
      }
      redirects.push({ op: token.op, target, ...(body === undefined ? {} : { body }) });
      const glob = opaque !== null ? undefined : wildGlob ?? zshGlobOf(token) ?? globOf(token);
      if (glob !== undefined) globs.set(target, glob);
    }
    else if (casePatterns || header === 'case') {
      // a case pattern list: `a|b)`, `(a)`
      if (casePatterns && token.value === ')') casePatterns = false;
    } else if (token.value === '(' && isOp(tokens[k + 1], ')')) {
      // `f()`: a function definition; its body follows
      words = [];
      wordTokens = [];
      k++;
      functionDefined = true;
      bodyNext = true;
      known.clear();
    } else {
      if (header === 'for') header = null;
      const op = token.value;
      if (closedCompound !== null) {
        // a compound or group piped or backgrounded runs apart; the last one of a pipeline may run here in zsh
        const opened: Opened = closedCompound;
        closedCompound = null;
        if (isPipe(op) || op === '&') ({ dir, lost } = opened);
        else if (opened.afterPipe && (dir !== opened.dir || lost !== opened.lost)) lost = { why: 'a `cd` in a piped command', pattern: null };
        if (sticky !== null) lost = sticky;
      }
      const before = segments.length;
      close(token.value);
      if (FORGET_OPS.has(op)) known.clear();
      if (op === '(' || op === ')') envClean = false;
      else if (op === ';' || op === '\n') {
        for (const [name, found] of known) if (found.andOnly) known.delete(name);
      }
      if (op === '&&') listOps = listOps === 'or' ? 'or' : 'and';
      else if (op === '||') listOps = 'or';
      else if (!isPipe(op)) listOps = 'none';
      const source = segments.length > before && closedGroupStart === null ? segments[segments.length - 1] : 'unknown';
      if (closedGroupStart !== null && token.value !== ')') {
        for (const inner of segments.slice(closedGroupStart)) inner.exits.push({ op: token.value, following: segments.length });
        closedGroupStart = null;
      }
      afterPipe = isPipe(token.value);
      // set after close(), which clears it: the segment read next takes its stdin from this one
      pipedFrom = afterPipe ? source : null;
      if (token.value === '(') openGroup(dir);
      if (token.value === ')') {
        const group = groups.pop();
        if (group !== undefined) {
          if (group.dir !== null) ({ dir, lost, dotGlob } = { dir: group.dir, lost: group.lost, dotGlob: group.dotGlob });
          closedGroupStart = group.start;
        }
      }
      if (token.value === ';;' && caseDepth > 0) casePatterns = true;
    }
  }
  close(null);
  // round 18, D-R18-1: arithmetic, `${…}` assignments and loops after the filled script, wherever they sit
  if (text !== null && filledAfter !== -1 && laterTextRisky(text.slice(filledAfter), filled)) throw laterChange(filled);
  return segments;
}

/**
 * The parts of the segment's substitutions (captured, so piped), then the segment's own part,
 * then the parts of the script it runs (`sh -c`, `eval`).
 */
function toParts(segment: Segment, segments: Segment[], reading: Reading, depth: number): CommandPart[] {
  if (segment.scripts.length > 0 && depth >= MAX_NESTED_DEPTH) {
    throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  }
  const substituted = segment.scripts.flatMap((script) =>
    readTokens(script, segment.cwd, reading, depth + 1, segment.dotGlob).map((p) => ({ ...p, pipedOut: true })),
  );
  return [...substituted, ...ownParts(segment, segments, reading, depth)];
}

/** The part for a segment, followed by the parts of the script it runs (`sh -c`, `eval`). */
function ownParts(segment: Segment, segments: Segment[], reading: Reading, depth: number): CommandPart[] {
  const { home } = reading;
  const { words, cwd, assignments, values, lost, terminal, writes, alternates, wrappers, wrapperOptions } = unwrap(segment.words, segment.cwd, reading);
  const program = words[0] ?? null;
  const name = program === null ? null : programName(program, reading);
  const args = words.slice(1);
  let git: CommandPart['git'] = null;
  if (name === 'git') git = readGit(args, cwd, home);
  else if (name !== null && PUSH_PROGRAMS.has(name)) git = { subcommand: 'push', args, dir: cwd };
  const gitDirLost = name === 'git' ? unknownGitDir(args) : null;
  const scriptFacts = scriptFactsOf(name, args);
  if (scriptFacts !== null) reading.unreadable ??= scriptFacts.unreadable ?? scriptFacts.dynamic;
  // an interpreter or shell running a script only known when it runs (`python3 "$S"`, `bash <(curl …)`): read past (ADR-010)
  if (runsUnknownScript(name, args)) reading.unreadable ??= `${name} runs a script only known when it runs`;
  const offset = segment.words.length - words.length + 1;
  const tempArgs = args.map((w, n) => segment.words[offset + n] === w && reading.tempHead.has(segment.wordTokens[offset + n]));
  const operandsWritten = [...operandWrites(name, args, segment.globs, tempArgs), ...(scriptFacts?.writes ?? [])];
  const written = [...redirectWrites(segment), ...operandsWritten];
  // a backup (`dest~`, `dest.~1~`, `dest<suffix>`) is written next to each file the program writes
  const backups = name !== null && makesBackup(name, args) ? operandsWritten.map((p) => `${segment.globs.get(p) ?? escapeGlob(p)}*`) : [];
  const recursive = recursiveOperands(name, args);
  const part: CommandPart = {
    words,
    assignments: [...segment.assignments, ...assignments],
    assignmentValues: [...segment.assignmentValues, ...values],
    program,
    name,
    cwd,
    writeTargets: [
      ...writes,
      ...written.map((p) => joinRaw(cwd, expandTilde(p, home))),
      ...(git === null ? [] : gitWrites(git).map((p) => joinRaw(git.dir, expandTilde(p, home)))),
    ],
    writeGlobs: [
      ...written.flatMap((p) => {
        const glob = segment.globs.get(p);
        return glob === undefined ? [] : [globPathOf(glob, escapeGlob(cwd), home)];
      }),
      ...backups.map((glob) => globPathOf(glob, escapeGlob(cwd), home)),
    ],
    recursiveTargets: recursive.filter((p) => !segment.globs.has(p)).map((p) => joinRaw(cwd, expandTilde(p, home))),
    recursiveGlobs: recursive.flatMap((p) => {
      const glob = segment.globs.get(p);
      return glob === undefined ? [] : [globPathOf(glob, escapeGlob(cwd), home)];
    }),
    globs: segment.globs,
    writePatterns: new Map(written.flatMap((p) => {
      const glob = segment.globs.get(p);
      return glob === undefined ? [] : [[joinRaw(cwd, expandTilde(p, home)), globPathOf(glob, escapeGlob(cwd), home)] as const];
    })),
    substitutedWrites: [
      ...markedWrites(segment.substituted, segment, words, name, redirectWrites(segment), operandsWritten),
      // a mktemp whose path can't be read (round 22, CR MEDIUM-1): refused as a bare `$(…)` is
      ...(name === 'mktemp' && operandsWritten.includes(UNKNOWN) ? [UNKNOWN] : []),
    ].map((p) => joinRaw(cwd, expandTilde(p, home))),
    unknownWrites: markedWrites(segment.unknown, segment, words, name, redirectWrites(segment), operandsWritten).map((p) => joinRaw(cwd, expandTilde(p, home))),
    stdinScripts: stdinScriptsOf(segment, name, args, reading),
    lostDir: segment.lostDir ?? lost ?? gitDirLost,
    hosts: args.flatMap(hostOf),
    git,
    pipedOut: segment.exits.some((e) => isPipe(e.op)),
    orTrue: segment.exits.some((e) => e.op === '||' && isTrue(segments[e.following]?.words ?? [])),
    followedByAnd: segment.exits[0]?.op === '&&',
    backgrounded: segment.exits.some((e) => e.op === '&'),
    wrappers,
    wrapperOptions,
    dotGlob: segment.dotGlob,
    terminal,
  };
  // round 15, SEC HIGH-A/B: zsh's sched runs its command later, and `functions[f]=…` defines f from text: read past, their text read as scripts
  if (name === 'sched') reading.unreadable ??= 'zsh sched runs a command later';
  const bodies = [
    ...segment.assignments.flatMap((n, k) => (n === ZSH_FUNCTIONS ? [segment.assignmentValues[k] || UNKNOWN] : [])),
    ...functionsBodies(words, []),
  ];
  // round 16, SEC HIGH-1: a function defined from text (any way zsh allows) is risky, as `eval` is
  if (bodies.length > 0 || definesFunction(segment.assignments, words)) hide(part, reading, 'defines a zsh function from text');
  const settings = [
    ...functionParts(bodies, part, reading, depth),
    ...settingParts(part, reading, depth),
    ...scriptCommandParts(scriptFacts, part, reading, depth),
    ...alternateParts(alternates, segment, segments, part, reading, depth),
  ];
  for (const target of part.writeTargets) reading.written.add(path.resolve(target));
  const script = scriptOf(name, program === null ? null : path.posix.basename(program), args) ?? stdinShellScript(name, args, part.stdinScripts) ?? expectSpawns(name, args, cwd, reading, stdinFed(segment));
  if (script === null) return [part, ...settings];
  // round 16, SEC HIGH-1: a trap, emulate -c or sched script runs in this shell: read with its variables unknown, unless one is hidden
  const later = name !== null && LATER_LAUNCHERS.has(name);
  const hidden = `runs a \`${name}\` script the gate can't read in full`;
  if (later && script.includes(UNKNOWN)) {
    hide(part, reading, hidden);
    return [part, ...settings];
  }
  if (!later && (DYNAMIC_SCRIPT.test(script) || script.includes(UNKNOWN))) {
    // Read past (ADR-010): the shell's own part is kept and checked; its script is not.
    reading.unreadable ??= `${name} runs a script that is not literal`;
    return [part, ...settings];
  }
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  const kind = name === 'emulate' ? emulateKind(emulateMode(args).mode) : shellSetsUnknownOption(name, args);
  const optionSet: LostDir | null = kind === null ? null : { why: `${name} ${args.join(' ')}`, pattern: null, ...(kind === 'partial' ? { plainKnown: true } : {}) };
  const read = (): CommandPart[] => readScript(script, cwd, reading, depth + 1, part.dotGlob || shellDots(name, args, part.assignments, part.assignmentValues), optionSet);
  const nested = later ? readWhole(read, part, reading, hidden).map(asCleanup) : read();
  // The nested shell inherits the variables set for it (`GIT_DIR=x bash -c 'git push'`).
  return [part, ...settings, ...nested.map((p) => ({
    ...p,
    assignments: [...part.assignments, ...p.assignments],
    pipedOut: p.pipedOut || part.pipedOut,
    orTrue: p.orTrue || part.orTrue,
    // the script runs where and as its shell runs: in the background, under the same launchers
    backgrounded: p.backgrounded || part.backgrounded,
    wrappers: [...part.wrappers, ...p.wrappers],
    wrapperOptions: [...part.wrapperOptions, ...p.wrapperOptions],
    // an `expect` spawn runs with a terminal of its own
    terminal: p.terminal || part.terminal || name === 'expect',
  }))];
}

/** Builtins that run a script in this shell, now or later (`trap`, zsh's `emulate -c` and `sched`): their `$` are read, not read past. */
const LATER_LAUNCHERS = new Set(['trap', 'emulate', 'sched']);

/**
 * A part of a trap, emulate -c or sched script, with a folder it changes as a whole whose name is only
 * known when it runs (`rm -rf "$dir"`) judged as any write to such a path (ADR-036, its literal start and
 * end checked) rather than refused as a folder the gate can't search (K13): ADR-050 keeps single-quoted
 * clean-up traps allowed, and round 15 allowed `trap "rm -rf \"$dir\"" EXIT` (round 16).
 */
function asCleanup(part: CommandPart): CommandPart {
  if (!part.recursiveTargets.some((t) => t.includes(UNKNOWN))) return part;
  const unknown = part.recursiveTargets.filter((t) => t.includes(UNKNOWN));
  return {
    ...part,
    recursiveTargets: part.recursiveTargets.filter((t) => !t.includes(UNKNOWN)),
    unknownWrites: [...new Set([...(part.unknownWrites ?? []), ...unknown])],
    cleanupWrites: unknown,
  };
}

/** Marks a part as running or defining a script the gate can't read in full (round 16, SEC HIGH-1): unreadable, and risky. */
function hide(part: CommandPart, reading: Reading, why: string): void {
  reading.unreadable ??= why;
  part.hiddenScript ??= why;
}

/** The parts `read` reads; when any of it is unreadable, the part that runs it is marked hidden. */
function readWhole(read: () => CommandPart[], part: CommandPart, reading: Reading, why: string): CommandPart[] {
  const outer = reading.unreadable;
  reading.unreadable = null;
  try {
    return read();
  } finally {
    const inner = reading.unreadable;
    reading.unreadable = outer ?? inner;
    if (inner !== null) hide(part, reading, why);
  }
}

/** zsh's disabled-functions array: setting it defines a function `enable -f` turns on. */
const ZSH_DISABLED_FUNCTIONS = 'dis_functions';

/**
 * True when a command defines a zsh function other than by `name() {…}` (round 16, the ADR-048 list):
 * any assignment to `functions` or `dis_functions` (`+=(…)`, a subscript, the whole array), `set -A` /
 * `set +A` of them (or of a name only known when it runs), and `enable -f`.
 */
function definesFunction(assignments: string[], words: string[]): boolean {
  if (assignments.includes(ZSH_FUNCTIONS) || assignments.includes(ZSH_DISABLED_FUNCTIONS)) return true;
  let p = 0;
  while (CD_PREFIXES.has(words[p])) p++;
  const [program, ...args] = words.slice(p);
  if (program === 'enable') return args.some((a) => /^-[A-Za-z]*f/.test(a));
  if (program === 'set') {
    const at = args.findIndex((a) => /^[-+][A-Za-z]*A/.test(a));
    const array = at === -1 ? undefined : args[at + 1] ?? UNKNOWN;
    return array !== undefined && (array.includes(UNKNOWN) || array === ZSH_FUNCTIONS || array === ZSH_DISABLED_FUNCTIONS);
  }
  if (program !== undefined && VARIABLE_BUILTINS.has(program)) {
    return args.some((a) => {
      const name = assignmentOf(a)?.name;
      return name === ZSH_FUNCTIONS || name === ZSH_DISABLED_FUNCTIONS;
    });
  }
  return false;
}

/**
 * The parts of the commands another platform's reading of a wrapper runs (`script -t -c 'cmd' log`
 * on util-linux, K8), read as the wrapper's own command would be, with a terminal of their own.
 */
function alternateParts(alternates: string[][], segment: Segment, segments: Segment[], part: CommandPart, reading: Reading, depth: number): CommandPart[] {
  if (alternates.length === 0) return [];
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  return alternates.flatMap((words) =>
    ownParts({ ...segment, words, assignments: [], assignmentValues: [], scripts: [] }, segments, reading, depth + 1).map((p) => ({
      ...p,
      assignments: [...part.assignments, ...p.assignments],
      terminal: true,
    })),
  );
}

/**
 * expect commands (Tcl syntax) that only wait for or send text: read when they have at most one
 * argument besides their options (`expect eof`, `send "y\r"`); `interact` and friends only bare.
 */
const EXPECT_WAITS = new Map([['expect', 1], ['send', 1], ['exit', 1], ['interact', 0], ['wait', 0], ['close', 0]]);

/**
 * The commands an `expect -c '<script>'` spawns, as a shell script, or null (fix round 4, K6). Other
 * expect text than a spawn or a simple wait or send (`exec`, a braced action, a substitution) is
 * read past (ADR-010): the call is unreadable, and expect runs code, so it is refused when risky.
 */
function expectSpawns(name: string | null, args: string[], cwd: string, reading: Reading, stdinFed: boolean): string | null {
  if (name !== 'expect') return null;
  const spawns: string[] = [];
  let inline = false;
  let file = false;
  for (let n = 0; n < args.length; n++) {
    const a = args[n];
    if (a === '-c') {
      inline = true;
      expectText(args[++n] ?? '', reading, spawns);
    } else if (a === '-i') {
      // interactive: it reads commands from stdin (K8)
      reading.unreadable ??= 'expect reads its script from stdin';
    } else if (EXPECT_VALUE_OPTIONS.has(a)) n++;
    else if (EXPECT_FILE_OPTIONS.has(a) || a === '--' || !a.startsWith('-') || a === '-') {
      // the script file: after `-f`, `-b` or `--`, or the first operand; the words after it are its arguments
      const named = a.startsWith('-') && a !== '-' ? args[n + 1] : a;
      file = named !== undefined;
      if (named !== undefined) expectText(expectFile(named, cwd, reading), reading, spawns);
      break;
    }
  }
  // with no script file, expect reads its commands from stdin, after any `-c` ones (K8)
  if (!file && (!inline || stdinFed)) reading.unreadable ??= 'expect reads its script from stdin';
  return spawns.length > 0 ? spawns.join('\n') : null;
}

/** expect options that take a value (expect syntax): `-D` a debug level. */
const EXPECT_VALUE_OPTIONS = new Set(['-D']);
/** expect options whose value is its script file (expect syntax). */
const EXPECT_FILE_OPTIONS = new Set(['-f', '-b']);

/**
 * The text of an expect script file, read through the file reader (K7), or null when it can't be
 * read: stdin (`-`), a name only known when it runs, a file written earlier in the same call, or
 * one the reader can't read. Its words count against the call's reading budget.
 */
function expectFile(file: string, cwd: string, reading: Reading): string | null {
  if (file === '-' || file.includes(UNKNOWN) || reading.readFile === null) return null;
  const absPath = resolvePath(file, cwd, reading.home);
  if (reading.written.has(path.resolve(absPath))) return null;
  const known = reading.files.get(absPath);
  if (known !== undefined) return known;
  const text = reading.readFile(absPath);
  reading.files.set(absPath, text);
  return text;
}

/**
 * Most expect text one call may scan, in characters and command separators, counted each time a
 * text runs (a reading limit, not a rule value; fix round 4, K8): one file read 400 times is read
 * 400 times. Past it the call is refused as too complex.
 */
const MAX_SCRIPT_SCAN = 1024 * 1024;

/** Counts `amount` more of the call's expect scanning; a reading limit past MAX_SCRIPT_SCAN. */
function scan(amount: number, reading: Reading): void {
  reading.scanned += amount;
  if (reading.scanned > MAX_SCRIPT_SCAN) throw new ReadingLimit(`expect reads over ${MAX_SCRIPT_SCAN / 1024 / 1024} MB of script files`);
}

/** The commands of expect text, split once per call (a file run again gives the same text). */
function tclCommandsOf(text: string, reading: Reading): string[][] | null {
  const known = reading.scriptCommands.get(text);
  if (known !== undefined) return known;
  const commands = tclCommands(text);
  reading.scriptCommands.set(text, commands);
  return commands;
}

/** What ends a Tcl word, and what ends a Tcl command (Tcl syntax). */
const TCL_BLANK = /[ \t\r]/;
const TCL_SEPARATOR = /[;\n]/;
/** Text in a word the gate does not read (Tcl syntax): a substitution (`[…]`, `$x`), a brace, a backslash, a quote inside a word. */
const TCL_UNREAD_BARE = /[[\]{}$\\"]/;
/** In a quoted word, substitutions and braces; its backslash escapes are decoded (tclUnescape). */
const TCL_UNREAD_QUOTED = /[[\]{}$]/;
/** Tcl's one-letter backslash escapes (Tcl syntax, the `Tcl` manual's backslash substitution). */
const TCL_ESCAPES = new Map([['a', '\x07'], ['b', '\b'], ['f', '\f'], ['n', '\n'], ['r', '\r'], ['t', '\t'], ['v', '\v']]);
const OCTAL = /^[0-7]{1,3}/;
const HEX = /^[0-9A-Fa-f]+/;

/**
 * A quoted Tcl word's text with its backslash escapes decoded as Tcl decodes them (fix part K11):
 * `\151` (octal), `\x69` (hex), `\u0069`, `\n` and the other letters, a backslash-newline and the
 * blanks after it (one space), and `\c` for any other `c`. Null for an escape Tcl versions decode
 * differently (macOS expect links Tcl 8.5): `\x` with more than two hex digits, `\U`, or an octal
 * escape over `\377`.
 */
function tclUnescape(body: string): string | null {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    tick();
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const c = body[i + 1] ?? '';
    const rest = body.slice(i + 1, i + 10);
    const octal = OCTAL.exec(rest)?.[0];
    if (octal !== undefined) {
      if (octal.length === 3 && octal[0] > '3') return null;
      out += String.fromCharCode(parseInt(octal, 8));
      i += octal.length;
    } else if (c === 'x' || c === 'u') {
      const digits = HEX.exec(rest.slice(1))?.[0] ?? '';
      const most = c === 'x' ? 2 : 4;
      if (c === 'x' && digits.length > most) return null;
      const used = digits.slice(0, most);
      out += used === '' ? c : String.fromCharCode(parseInt(used, 16));
      i += 1 + used.length;
    } else if (c === 'U') {
      return null;
    } else if (c === '\n') {
      let j = i + 2;
      while (j < body.length && TCL_BLANK.test(body[j]) && body[j] !== '\r') j++;
      out += ' ';
      i = j - 1;
    } else {
      out += TCL_ESCAPES.get(c) ?? c;
      i++;
    }
  }
  return out;
}

/**
 * Expect text split into commands of words by Tcl's rules (fix round 4, K8), not the shell's: a
 * command ends at `;` or a newline; words are split on spaces and tabs; only a `"` that starts a
 * word quotes (to the next unescaped `"`, which must end the word), and `'` is plain text; `#` where
 * a command starts is a comment to the end of the line. Null when it holds text the gate doesn't read.
 */
function tclCommands(text: string): string[][] | null {
  const commands: string[][] = [];
  let words: string[] = [];
  let i = 0;
  while (i < text.length) {
    tick();
    const c = text[i];
    if (TCL_BLANK.test(c)) {
      i++;
    } else if (TCL_SEPARATOR.test(c)) {
      if (words.length > 0) commands.push(words);
      words = [];
      i++;
    } else if (c === '#' && words.length === 0) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const after = text[j + 1];
      if (j >= text.length || (after !== undefined && !TCL_BLANK.test(after) && !TCL_SEPARATOR.test(after))) return null;
      const body = text.slice(i + 1, j);
      const decoded = TCL_UNREAD_QUOTED.test(body) ? null : tclUnescape(body);
      if (decoded === null) return null;
      words.push(decoded);
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !TCL_BLANK.test(text[j]) && !TCL_SEPARATOR.test(text[j])) j++;
      const word = text.slice(i, j);
      if (TCL_UNREAD_BARE.test(word)) return null;
      words.push(word);
      i = j;
    }
  }
  if (words.length > 0) commands.push(words);
  return commands;
}

/** Reads expect text (Tcl syntax) into `spawns`; text the gate can't read (or no text) makes the call unreadable. */
function expectText(text: string | null, reading: Reading, spawns: string[]): void {
  const commands = text === null || text.includes(UNKNOWN) ? null : (scan(text.length, reading), tclCommandsOf(text, reading));
  if (commands === null) {
    reading.unreadable ??= 'expect runs text the gate can\'t read';
    return;
  }
  for (const words of commands) {
    tick();
    scan(1, reading);
    const spawned = expectCommand(words, reading);
    if (spawned !== null) spawns.push(spawned);
  }
}

/** The shell command one expect command spawns, or null; anything but a spawn or a simple wait is unreadable. */
function expectCommand(words: string[], reading: Reading): string | null {
  const [command, ...rest] = words;
  if (command === undefined) return null;
  const options = rest.filter((w) => w.startsWith('-'));
  const operands = rest.filter((w) => !w.startsWith('-'));
  // spawn's own options take no value, except `-open` and `-ignore`
  if (command === 'spawn' && !options.some((o) => o === '-open' || o === '-ignore') && rest.length > options.length) {
    return rest.slice(rest.findIndex((w) => !w.startsWith('-'))).map(shellQuote).join(' ');
  }
  const most = EXPECT_WAITS.get(command);
  if (most === undefined || operands.length > most || (most === 0 && options.length > 0)) reading.unreadable ??= 'expect runs text the gate can\'t read';
  return null;
}

/** A word quoted for the shell. */
function shellQuote(word: string): string {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Variables some programs run as a command (a pager, an editor, an ssh or diff program): `GIT_*`, and any set for git. */
const GIT_VARIABLE = /^GIT_/;
/**
 * git variables that only label a commit (who made it, and when), trace what git does
 * (`GIT_TRACE`, `GIT_TRACE_PACKET` …) or turn off replace refs (GIT_NO_REPLACE_OBJECTS, which the
 * served /oss:ship-team commands export; round 11): git never runs their values as a command.
 */
export const SAFE_GIT_VARIABLE = /^(?:GIT_NO_REPLACE_OBJECTS|GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)|GIT_TRACE[A-Za-z0-9_]*)$/;

/** The parts of the function bodies `functions[…]=` defines (round 15), read as nested scripts; a body only known when it runs is read past. */
function functionParts(bodies: string[], part: CommandPart, reading: Reading, depth: number): CommandPart[] {
  return bodies.flatMap((body) => {
    if (DYNAMIC_SCRIPT.test(body) || body.includes(UNKNOWN)) return [];
    if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
    return readScript(body, part.cwd, reading, depth + 1, part.dotGlob);
  });
}

/**
 * The parts of the settings a part runs as commands, read as nested scripts: the values of
 * `git -c key=value` and of the variables set for git (`PAGER=…`, `GIT_EXTERNAL_DIFF=…`), and of
 * any `GIT_*` set for another program, which may run git. git runs such values through the shell
 * (`diff.external`, `core.pager`, `alias.x=!cmd` …); for a value that is no command (`user.name=x`)
 * the part is a harmless program name. A value that is not literal is read past (ADR-010).
 */
function settingParts(part: CommandPart, reading: Reading, depth: number): CommandPart[] {
  const values = part.assignmentValues.filter((_, n) => {
    const name = part.assignments[n];
    return !SAFE_GIT_VARIABLE.test(name) && (part.git !== null || GIT_VARIABLE.test(name));
  });
  if (part.git !== null) {
    const globals = part.words.slice(1, part.words.length - part.git.args.length - 1);
    globals.forEach((w, n) => {
      if (w === '-c' && n + 1 < globals.length) values.push(globals[n + 1].slice(globals[n + 1].indexOf('=') + 1));
    });
  }
  return values.flatMap((value) => {
    if (value === '' || DYNAMIC_SCRIPT.test(value) || value.includes(UNKNOWN)) {
      if (value !== '') reading.unreadable ??= 'a setting that runs a command is not literal';
      return [];
    }
    if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
    // an alias value `!cmd` runs `cmd` in the shell
    const command = value.startsWith('!') ? value.slice(1) : value;
    return readScript(command, part.cwd, reading, depth + 1, part.dotGlob).map((p) => ({ ...p, pipedOut: true }));
  });
}

function isOp(token: Token | undefined, value: string): boolean {
  return token?.kind === 'op' && token.value === value;
}

function isPipe(op: string | null): boolean {
  return op !== null && PIPES.includes(op);
}

function isTrue(words: string[]): boolean {
  return words.length === 1 && (words[0] === 'true' || words[0] === ':');
}


/** The words of the program a wrapper runs, recursively, the directory it runs in and the variables it sets. */
/**
 * `first`: the spec to read the first word with instead of its own (another platform's reading).
 * `alternates`: the words of the commands another platform's reading of a wrapper runs (K8).
 */
function unwrap(
  words: string[],
  cwd: string,
  reading: Reading,
  first?: WrapperSpec,
): { words: string[]; cwd: string; assignments: string[]; values: string[]; lost: LostDir | null; terminal: boolean; writes: string[]; alternates: string[][]; wrappers: string[]; wrapperOptions: string[][] } {
  const { home } = reading;
  const wrappers: string[] = [];
  const wrapperOptions: string[][] = [];
  const alternates: string[][] = [];
  const assignments: string[] = [];
  const values: string[] = [];
  let lost: LostDir | null = null;
  let terminal = false;
  const writes: string[] = [];
  let dir = cwd;
  let rest = words;
  let unwrapped = 0;
  const wrapperOf = (word: string | undefined): WrapperSpec | undefined => (word === undefined ? undefined : WRAPPERS.get(plainWriterName(programName(word, reading))));
  rest = withEquals(rest);
  for (let spec = first ?? wrapperOf(rest[0]); spec !== undefined; spec = wrapperOf(rest[0])) {
    if (++unwrapped > MAX_WRAPPERS) throw new ReadingLimit(`more than ${MAX_WRAPPERS} wrappers`);
    wrappers.push(plainWriterName(programName(rest[0], reading)));
    terminal ||= spec.terminal === true;
    if (spec.alternate !== undefined) {
      // the other platform's reading: the files it writes count, and the command it runs is read too
      const other = unwrap(rest, dir, reading, spec.alternate);
      writes.push(...other.writes);
      alternates.push(...other.alternates, ...(other.words === rest ? [] : [other.words]));
      lost ??= other.lost;
    }
    let split: string[] = [];
    let shell: string | undefined;
    let i = 1;
    for (; i < rest.length; i++) {
      const w = rest[i];
      if (w === '--') {
        i++;
        break;
      }
      if (spec.assignments === true && ASSIGNMENT.test(w)) {
        assignments.push(...assignedNames([w]));
        values.push(...assignedValues([w]));
        continue;
      }
      if (!w.startsWith('-') || w === '-') break;
      const long = w.startsWith('--');
      const eq = long ? w.indexOf('=') : -1;
      // In a short cluster (`-Eu`), the first letter that takes a value takes the rest of it, or the next word.
      const at = long ? 0 : [...w.slice(1)].findIndex((l) => spec.values.includes(`-${l}`)) + 1;
      if (at === 0 && !long) continue;
      const flag = long ? (eq === -1 ? w : w.slice(0, eq)) : `-${w[at]}`;
      if (!spec.values.includes(flag)) continue;
      let value: string | undefined;
      if (eq !== -1) value = w.slice(eq + 1);
      else if (!long && w.length > at + 1) value = w.slice(at + 1);
      else value = rest[++i];
      if (value === undefined) break;
      if (spec.dir?.includes(flag)) {
        if (value.includes(UNKNOWN)) lost = { why: `${rest[0]} ${flag} ${value}`, pattern: null };
        dir = resolvePath(value, dir, home);
      }
      if (spec.split?.includes(flag)) split = splitWords(value, reading);
      if (spec.shell?.includes(flag)) shell = value;
    }
    wrapperOptions.push(rest.slice(1, i));
    const files = spec.writesOperands === true ? rest.slice(i, i + (spec.operands ?? 0)).filter((w) => !w.startsWith('-')) : [];
    // util-linux reads `-c` after the file too (`script out.log -c 'cmd'`, `flock /tmp/l -c 'cmd'`: K7)
    let after = i + files.length;
    while (spec.shell !== undefined && shell === undefined && after < rest.length && rest[after].startsWith('-') && rest[after] !== '-') {
      const w = rest[after];
      const eq = w.indexOf('=');
      const flag = w.startsWith('--') && eq !== -1 ? w.slice(0, eq) : w;
      if (spec.shell.includes(flag) || (/^-[A-Za-z]+$/.test(w) && w.endsWith('c'))) shell = eq !== -1 && w.startsWith('--') ? w.slice(eq + 1) : rest[after + 1];
      else if (spec.values.includes(flag) && eq === -1) after++;
      after++;
    }
    for (const file of files.length > 0 ? files : spec.defaultWrite === undefined ? [] : [spec.defaultWrite]) writes.push(joinRaw(dir, expandTilde(file, home)));
    // the shell command it runs is read as the script of `sh -c`
    const operandsRun = spec.noCommandOperands === true ? [] : rest.slice(i + (spec.operands ?? 0));
    const next = shell !== undefined ? ['sh', '-c', shell] : [...split, ...operandsRun];
    if (next.length === 0) break;
    rest = withEquals(next);
  }
  return { words: rest, cwd: dir, assignments, values, lost, terminal, writes, alternates, wrappers, wrapperOptions };
}

/** zsh `=cmd` in program position runs `cmd` (it expands to the program's path). */
function withEquals(words: string[]): string[] {
  const first = words[0];
  return first !== undefined && first.length > 1 && first.startsWith('=') ? [first.slice(1), ...words.slice(1)] : words;
}

/** The words of an `env -S` string (those before a piece it can't read). */
function splitWords(value: string, reading: Reading): string[] {
  return tokensOf(value, reading).flatMap((t) => (t.kind === 'word' ? [t.value] : []));
}

/**
 * The script a part runs: the `-c` script of a shell (`name`, as the file system finds it), or the
 * joined words of `eval` (`exact`: a builtin, found by its exact name); else null.
 */
function scriptOf(name: string | null, exact: string | null, args: string[]): string | null {
  if (exact === 'eval') return args.length > 0 ? args.join(' ') : null;
  // round 15, SEC HIGH-A/B: the text a trap, `emulate … -c` or zsh's sched runs, read like an eval
  if (exact === 'trap') return trapScript(args);
  if (exact === 'emulate') return emulateMode(args).script;
  if (exact === 'sched') return schedScript(args);
  if (name === null || !SHELLS.has(name)) return null;
  let command = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SHELL_VALUE_OPTIONS.has(a)) i++;
    else if (a.startsWith('-') || a.startsWith('+')) {
      command ||= COMMAND_STRING_FLAG.test(a);
      // like bash, each value-taking letter of a cluster (`-eo pipefail`, `-oc pipefail 'x'`) takes the next word;
      // `-oglobdots` / `-Odotglob` carry the option name attached (zsh), so take none (K8)
      if (SHORT_OPTION_CLUSTER.test(a) && !ATTACHED_OPTION_NAME.test(a)) i += [...a.slice(1)].filter((l) => SHELL_VALUE_OPTIONS.has(`-${l}`)).length;
    }
    else return command ? a : null;
  }
  return null;
}

/** Redirects that feed stdin from text in the command: heredocs and here-strings (bash and zsh). */
const STDIN_TEXT = /^0?(?:<<-?|<<<)$/;

/** A redirect that feeds stdin from a file (`<`, `0<`). */
const STDIN_FILE = /^0?<$/;

/** True when a segment's stdin is fed by the command: a pipe, a `<` file, a heredoc or a here-string. */
function stdinFed(segment: Segment): boolean {
  return segment.pipedFrom !== null || segment.redirects.some((r) => STDIN_TEXT.test(r.op) || STDIN_FILE.test(r.op));
}
/** Programs that run a script read from stdin when given no script (bash, sh … are SHELLS). */
const STDIN_INTERPRETERS = new Set(['node', 'perl', 'ruby', 'osascript', 'php']);
const PYTHON = /^python[0-9.]*$/;
/** Programs that run a script from stdin only when told to with `-` (`deno run -`). */
const DASH_INTERPRETERS = new Set(['deno', 'bun']);
/**
 * Options that give the interpreter its script or module inline, so stdin is data (`-c`, `-e`,
 * `-m`, `--eval`, node's `-p`, and clusters ending in one: `-pe`, `-Bc`).
 */
const INLINE_SCRIPT = /^(?:-[A-Za-z]*[ceEm]|--eval|--print|-p)$/;
/** Interpreter options that take the next word as their value (node, ruby, perl, osascript, php syntax). */
const INTERPRETER_VALUE_OPTIONS = new Set([
  '-Q', '-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type',
  '--title', '-I', '-E', '-l', '-s',
]);
/**
 * python's own syntax (fix round 4, K4): only `-W` and `-X` take a value (`-I`, `-E`, `-s` … take
 * none), and only `-c` and `-m` give the script inline (`-E` is perl's).
 */
const PYTHON_VALUE_OPTIONS = new Set(['-W', '-X']);
const PYTHON_INLINE_SCRIPT = /^-[A-Za-z]*[cm]$/;

/** The options that take a value, and the inline-script pattern, of this interpreter. */
function interpreterSyntax(name: string): { values: ReadonlySet<string>; inline: RegExp } {
  return PYTHON.test(name) ? { values: PYTHON_VALUE_OPTIONS, inline: PYTHON_INLINE_SCRIPT } : { values: INTERPRETER_VALUE_OPTIONS, inline: INLINE_SCRIPT };
}
/**
 * True for a program that runs a command, a script or code it is given (fix round 4, K9): a wrapper
 * the reader unwraps, a shell, an interpreter, or `expect`. A rule that must not let such a program
 * run asks this, so a wrapper or interpreter added to these tables is covered there too.
 */
export function runsItsArguments(name: string): boolean {
  return WRAPPERS.has(name) || SHELLS.has(name) || STDIN_INTERPRETERS.has(name) || PYTHON.test(name) || DASH_INTERPRETERS.has(name) || name === 'expect';
}

/** `-s`: the shell reads its commands from stdin even when given arguments (bash, sh, zsh syntax). */
const SHELL_STDIN_FLAG = /^-(?=[A-Za-z]*s)[A-Za-z]+$/;

/** True when the program runs a script it reads from stdin (`python3`, `node -`, `bash -s x`), not one it is given. */
function readsStdinScript(name: string | null, args: string[]): boolean {
  if (name === null) return false;
  if (SHELLS.has(name)) {
    if (scriptOf(name, name, args) !== null) return false;
    return args.some((a) => SHELL_STDIN_FLAG.test(a)) || stdinShellScript(name, args, ['']) !== null;
  }
  if (DASH_INTERPRETERS.has(name)) return args.includes('-');
  if (!STDIN_INTERPRETERS.has(name) && !PYTHON.test(name)) return false;
  const { values, inline } = interpreterSyntax(name);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-') return true;
    if (inline.test(a)) return false;
    if (values.has(a)) i++;
    else if (!a.startsWith('-')) return false;
  }
  return true;
}

/**
 * True when an interpreter or shell runs a script only known when it runs (fix round 4, K3): its
 * script file is a variable or a `<( … )` (`python3 "$S"`, `bash <(curl …)`), or its inline script
 * or module (`-c`, `-e`, `-m`) is. A shell's own `-c` script is checked where it is read.
 */
function runsUnknownScript(name: string | null, args: string[]): boolean {
  if (name === null) return false;
  const shell = SHELLS.has(name);
  if (!shell && !STDIN_INTERPRETERS.has(name) && !PYTHON.test(name)) return false;
  const { values, inline } = shell ? { values: SHELL_VALUE_OPTIONS, inline: null } : interpreterSyntax(name);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return args[i + 1]?.includes(UNKNOWN) === true;
    // `bash -s x`: the script comes from stdin (read there), the words are its arguments
    if (shell && SHELL_STDIN_FLAG.test(a)) return false;
    if (values.has(a)) i++;
    else if (inline?.test(a) === true) return args[i + 1]?.includes(UNKNOWN) === true;
    else if (!a.startsWith('-') && !(shell && a.startsWith('+'))) return a.includes(UNKNOWN);
  }
  return false;
}

/** `echo`'s options (bash, zsh). */
const ECHO_OPTIONS = /^-[neE]+$/;

/**
 * The text a piped segment prints when it is literal: `echo` words with no backslash, a `printf`
 * format alone with no `%` or `\`, or a `cat` of its heredoc or here-string; else null.
 */
function printedText(source: Segment): string | null {
  const [program, ...args] = source.words;
  if (source.words.some((w) => w.includes(UNKNOWN)) || source.scripts.length > 0) return null;
  if (program === 'echo') {
    let n = 0;
    while (n < args.length && ECHO_OPTIONS.test(args[n])) n++;
    const text = args.slice(n).join(' ');
    // zsh's and macOS /bin/sh's echo decode backslash escapes even without `-e` (K8): text holding one is not read
    return text.includes('\\') ? null : text;
  }
  if (program === 'printf') return args.length === 1 && !/[%\\]/.test(args[0]) ? args[0] : null;
  if (program === 'cat' && args.every((a) => a === '-')) {
    const text = stdinTextOf(source);
    return text.length > 0 ? text.join('\n') : null;
  }
  return null;
}

/** The text heredocs and here-strings feed a segment's stdin. */
function stdinTextOf(segment: Segment): string[] {
  return segment.redirects.flatMap((r) => {
    if (!STDIN_TEXT.test(r.op)) return [];
    return [r.op.endsWith('<<<') ? r.target : r.body ?? ''];
  });
}

/**
 * The scripts a segment's stdin feeds it (heredocs, here-strings and, for an interpreter that reads
 * its script from stdin, a literal piped text). Such an interpreter fed a file (`python3 < x.py`) or
 * the output of a command the gate can't read (`curl … | bash`) is read past (ADR-010), fix round 4, K2.
 */
function stdinScriptsOf(segment: Segment, name: string | null, args: string[], reading: Reading): string[] {
  const texts = stdinTextOf(segment);
  if (!readsStdinScript(name, args)) return texts;
  const last = [...segment.redirects].reverse().find((r) => STDIN_TEXT.test(r.op) || STDIN_FILE.test(r.op));
  if (last !== undefined) {
    if (STDIN_FILE.test(last.op)) reading.unreadable ??= `${name} runs a script read from a file`;
    return texts;
  }
  if (segment.pipedFrom === null) return texts;
  const piped = segment.pipedFrom === 'unknown' ? null : printedText(segment.pipedFrom);
  if (piped === null) {
    reading.unreadable ??= `${name} runs a script piped from a command the gate can't read`;
    return texts;
  }
  return [...texts, piped];
}

/**
 * The commands a shell reads from stdin: the heredoc or here-string fed to a shell that names no
 * script file (`bash <<EOF`, `sh -s <<< …`, `bash - <<EOF`); else null, as for `bash x.sh <<EOF`,
 * whose stdin is the script's input.
 */
function stdinShellScript(name: string | null, args: string[], stdin: string[]): string | null {
  if (name === null || !SHELLS.has(name) || stdin.length === 0) return null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SHELL_VALUE_OPTIONS.has(a)) i++;
    else if (a !== '-' && !a.startsWith('-') && !a.startsWith('+')) return null;
  }
  return stdin.join('\n');
}

function assignedNames(words: string[]): string[] {
  return words.map((w) => assignmentOf(w)?.name ?? w.slice(0, w.indexOf('=')));
}

function assignedValues(words: string[]): string[] {
  return words.map((w) => assignmentOf(w)?.value ?? w.slice(w.indexOf('=') + 1));
}

function stripAssignments(words: string[]): string[] {
  const first = words.findIndex((w) => !ASSIGNMENT.test(w));
  return first === -1 ? [] : words.slice(first);
}

function expandTilde(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return home + p.slice(1);
  return p;
}

/** The directory `p` names from `cwd`; `cwd` itself when `p` is only known when the command runs. */
function resolvePath(p: string, cwd: string, home: string): string {
  if (p.includes(UNKNOWN)) return cwd;
  return path.resolve(cwd, expandTilde(p, home));
}

/** Where the shell is: the directory, and whether the reader lost track of it. */
interface ShellDir {
  dir: string;
  lost: LostDir | null;
}

/**
 * The shell's directory after a command: moved by `cd`, `pushd` and `popd` (also after `command`,
 * `builtin`, `time`). These are shell builtins, found by their exact name in any letter case setting.
 */
function dirAfter(
  words: string[],
  at: ShellDir,
  pushed: string[],
  home: string,
  globs: ReadonlyMap<string, string>,
  cdpath: string[] | null = null,
): ShellDir {
  let p = 0;
  while (CD_PREFIXES.has(words[p])) p++;
  const [verb, ...args] = words.slice(p);
  if (verb === 'cd') return cdTarget(verb, args, at, home, globs, cdpath);
  if (verb === 'pushd') {
    // with no argument pushd swaps the top two stack entries; `-n` only adds to the stack
    if (args.length === 0 || STACK_ENTRY.test(args[0])) return lostAt(at, [verb, ...args].join(' '));
    if (args.includes('-n')) return at;
    pushed.push(at.dir);
    return cdTarget(verb, args, at, home, globs, cdpath);
  }
  // popd: the stack may hold entries from before this command, so where it leads is not followed
  if (verb === 'popd') return lostAt({ dir: pushed.pop() ?? at.dir, lost: at.lost }, [verb, ...args].join(' '));
  return at;
}

/** The variables `cd` searches (shell syntax): bash's CDPATH, and zsh's `cdpath` array tied to it. */
const CDPATH = 'CDPATH';
const ZSH_CDPATH = 'cdpath';

/**
 * The CDPATH after these assignments (alone, or after `export`/`declare` …): its folders; null when
 * unset or empty. Every form counts (fix part K11): `CDPATH+=:x` appends to the text, zsh's
 * `cdpath+=x` adds a folder, and `cdpath[1]=x` sets one (read as added: which one is not followed).
 * A value only known when it runs is a folder only known then, so the cd is lost.
 */
function cdpathAfter(assigned: string[], exported: string[], cdpath: string[] | null): string[] | null {
  let result = cdpath;
  for (const word of [...assigned, ...exported]) {
    tick();
    const assignment = assignmentOf(word);
    if (assignment === null || (assignment.name !== CDPATH && assignment.name !== ZSH_CDPATH)) continue;
    const { name, index, append, value } = assignment;
    if (index !== null && /[[$`]|\u0000/.test(index)) {
      // an index the reader can't read (`CDPATH[X[0]]=…`): which entry it sets, and so the folders, are unknown
      result = compactCdpath([...(result ?? []), UNKNOWN]);
    } else if (index !== null || (append && name === ZSH_CDPATH)) {
      if (value !== '') result = compactCdpath([...(result ?? []), value]);
    } else if (append) {
      // appended to the text: its last entry grows, and each `:` in the value starts a new one
      const [first, ...rest] = value.split(':');
      const entries = result === null || result.length === 0 ? [first, ...rest] : [...result.slice(0, -1), result[result.length - 1] + first, ...rest];
      result = entries.length === 1 && entries[0] === '' ? null : compactCdpath(entries);
    } else {
      result = value === '' ? (name === ZSH_CDPATH ? result : null) : compactCdpath(value.split(':'));
    }
  }
  return result;
}

/**
 * A CDPATH kept only as far as `cd` reads it (cdpathSearch: none, one or several folders other
 * than the current one), so thousands of appends in one call stay linear (fix part K12): at most two
 * of its earlier entries that name another folder, and its last entry whole, which `CDPATH+=x` extends.
 */
function compactCdpath(entries: string[]): string[] {
  if (entries.length === 0) return entries;
  const last = entries.length - 1;
  const kept: string[] = [];
  for (let i = 0; i < last && kept.length < 2; i++) {
    if (entries[i] !== '' && entries[i] !== '.') kept.push(entries[i]);
  }
  kept.push(entries[last]);
  return kept;
}

/**
 * Whether these words start an array assignment to CDPATH or zsh's `cdpath` whose words come as the
 * next segment (`cdpath=(…)`, `cdpath+=(…)`, `typeset -a cdpath=(…)`, `declare -a CDPATH=(…)`): 'set',
 * 'append', or null.
 */
function cdpathArrayOf(commandWords: string[], assigned: string[]): 'set' | 'append' | null {
  const words = commandWords.length === 0 ? assigned : VARIABLE_BUILTINS.has(commandWords[0]) ? commandWords.slice(1) : [];
  const last = words.length === 0 ? null : assignmentOf(words[words.length - 1]);
  if (last === null || last.value !== '' || last.index !== null || (last.name !== CDPATH && last.name !== ZSH_CDPATH)) return null;
  return last.append ? 'append' : 'set';
}

/**
 * Where CDPATH may send `cd <target>` besides `./<target>` (bash and zsh search it for a relative
 * name that doesn't start with `.` or `..`): undefined when it isn't searched or names only the
 * current folder; the one other folder it names; null when there are several or one is unknown.
 */
function cdpathSearch(target: string, cdpath: string[] | null): string | null | undefined {
  if (cdpath === null || path.isAbsolute(target) || target.startsWith('~') || /^\.\.?(?:\/|$)/.test(target)) return undefined;
  const elsewhere = cdpath.filter((entry) => entry !== '' && entry !== '.');
  if (elsewhere.length === 0) return undefined;
  return elsewhere.length === 1 && !elsewhere[0].includes(UNKNOWN) ? elsewhere[0] : null;
}

/** `cd` options of bash and zsh (`-P`, `-L` …): they change how links are followed, not where it goes. */
const CD_OPTION = /^-[LPeqs@]+$/;
/** A directory-stack entry (`+1`, `-2`): where it leads is only known in the shell running it. */
const STACK_ENTRY = /^[+-][0-9]+$/;

function lostAt(at: ShellDir, why: string): ShellDir {
  return { dir: at.dir, lost: { why, pattern: null } };
}

/**
 * The directory after `cd <args>` (or `pushd <args>`): home with no argument. `cd -`, a stack entry,
 * several arguments (zsh's `cd old new`) or a directory only known when it runs leave the reader
 * not knowing where the shell is; a wildcard leaves it knowing only the pattern.
 */
function cdTarget(verb: string, args: string[], at: ShellDir, home: string, globs: ReadonlyMap<string, string>, cdpath: string[] | null = null): ShellDir {
  const why = [verb, ...args].join(' ');
  let rest = args;
  while (rest.length > 0 && CD_OPTION.test(rest[0])) rest = rest.slice(1);
  if (rest[0] === '--') rest = rest.slice(1);
  if (rest.length === 0) return home.includes(UNKNOWN) ? lostAt(at, why) : { dir: home, lost: null };
  const target = rest[0];
  if (rest.length > 1 || target === '-' || STACK_ENTRY.test(target) || target.includes(UNKNOWN)) return lostAt(at, why);
  const glob = globs.get(target);
  if (glob !== undefined) {
    // a wildcard: the shell goes to whatever it matches, somewhere the reader can only describe as the pattern
    const base = at.lost === null ? escapeGlob(at.dir) : at.lost.pattern;
    const pattern = base === null ? null : globPathOf(glob, base, home);
    return { dir: at.dir, lost: { why, pattern } };
  }
  const dir = resolvePath(target, at.dir, home);
  const searched = cdpathSearch(target, cdpath);
  if (searched !== undefined) {
    // CDPATH may send it elsewhere (K8): lost, known only as the one folder CDPATH names, if just one
    const pattern = searched === null || at.lost !== null ? null : escapeGlob(resolvePath(path.join(searched, target), at.dir, home));
    return { dir, lost: { why, pattern } };
  }
  // An absolute target is known again; a relative one stays below the lost directory.
  if (at.lost === null || path.isAbsolute(expandTilde(target, home))) return { dir, lost: null };
  const pattern = at.lost.pattern === null ? null : globPathOf(escapeGlob(target), at.lost.pattern, home);
  return { dir, lost: { why: at.lost.why, pattern } };
}

function redirectWrites(segment: Segment): string[] {
  return segment.redirects
    .filter((r) => OUTPUT_REDIRECT.test(r.op) && !FD_DUPLICATION.test(r.target))
    .map((r) => (r.target.startsWith('&') ? r.target.slice(1) : r.target));
}

/**
 * Non-flag operands; everything after `--` is an operand. The options in `values` take a value
 * (`-s 0`, `-s0`, `--size=0`, `--size 0`), which is not an operand.
 */
function operands(args: string[], values: string[] = []): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return [...result, ...args.slice(i + 1)];
    if (!a.startsWith('-')) result.push(a);
    else if (a.startsWith('--')) {
      if (values.includes(a)) i++;
    } else {
      const at = [...a.slice(1)].findIndex((l) => values.includes(`-${l}`));
      if (at !== -1 && at === a.length - 2) i++;
    }
  }
  return result;
}

/**
 * The words of a cp, mv, ln or install with its target folder spelled `--target-directory=DIR`, however it was
 * written (GNU getopt syntax, R-266 round 20, CR LOW-1): `-t DIR`, `-tDIR`, a `t` inside a short-option cluster
 * (`-at.oss`, `-ft DIR`), or any prefix of `--target-directory` (`--targ DIR`, `--target=DIR`). `valueLetters`:
 * the other short options that take a value, which end a cluster (`-S.bak` holds no target).
 */
function spelledOutTarget(args: string[], valueLetters: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return [...out, ...args.slice(i)];
    const long = /^--(t[a-z-]*)(?:=(.*))?$/s.exec(a);
    if (long !== null && 'target-directory'.startsWith(long[1])) {
      const dir = long[2] ?? args[++i];
      if (dir !== undefined) out.push(`--target-directory=${dir}`);
      continue;
    }
    if (!/^-[^-]/.test(a)) {
      out.push(a);
      continue;
    }
    let n = 1;
    while (n < a.length && a[n] !== 't' && !valueLetters.includes(a[n])) n++;
    if (a[n] !== 't') {
      out.push(a);
      continue;
    }
    if (n > 1) out.push(a.slice(0, n));
    const dir = n + 1 < a.length ? a.slice(n + 1) : args[++i];
    if (dir !== undefined) out.push(`--target-directory=${dir}`);
  }
  return out;
}

/** The target folder, else the last operand: the destination of cp, ln and install. */
function destination(args: string[], values: string[] = [], valueLetters = 'S'): string[] {
  const spelled = spelledOutTarget(args, valueLetters);
  const target = spelled.find((a) => a.startsWith('--target-directory='));
  if (target !== undefined) return [target.slice('--target-directory='.length)];
  return operands(spelled, values).slice(-1);
}

const TRUNCATE_VALUES = ['-s', '-r', '--size', '--reference'];
const LN_VALUES = ['-t', '-S', '--target-directory', '--suffix'];
const INSTALL_VALUES = ['-m', '-o', '-g', '-t', '-S', '--mode', '--owner', '--group', '--target-directory', '--suffix'];
const RESTORE_VALUES = ['-s', '--source', '--pathspec-from-file'];

/** rsync options that take a value, so it is not read as the source or destination. */
const RSYNC_VALUES = [
  '-e', '--rsh', '-f', '--filter', '--exclude', '--include', '--exclude-from', '--include-from', '--files-from',
  '-T', '--temp-dir', '--partial-dir', '--backup-dir', '--suffix', '--chmod', '--chown', '-B', '--block-size',
  '--rsync-path', '-M', '--remote-option', '--log-file', '--password-file', '--port', '--compare-dest',
  '--copy-dest', '--link-dest', '--max-size', '--min-size', '--timeout', '--bwlimit', '--out-format',
];

/** rsync writes into its last operand; with one operand it only lists. */
function rsyncWrites(args: string[]): string[] {
  const named = operands(args, RSYNC_VALUES);
  return named.length > 1 ? named.slice(-1) : [];
}

/** Why: tar reads its first word as bundled letters (`tar xf a.tar`), with or without a dash. */
function tarExtracts(args: string[]): boolean {
  const first = args[0] ?? '';
  if (/^[^-]*x/.test(first) && !first.includes('/')) return true;
  return args.some((a) => a === '--extract' || a === '--get' || /^-[A-Za-z]*x/.test(a));
}

/**
 * tar's folder option written long: bsdtar's `--cd`, or any prefix of `--directory` from `--di` (GNU tar and bsdtar
 * take a unique prefix: R-266 round 21, SEC MEDIUM-1); group 1 holds a value given after `=`.
 */
const TAR_DIRECTORY = /^--(?:cd|di(?:r(?:e(?:c(?:t(?:o(?:r(?:y)?)?)?)?)?)?)?)(?:=(.*))?$/s;

/** tar unpacks into each `-C`/`--directory` folder, else the working folder. */
function tarWrites(args: string[]): string[] {
  if (!tarExtracts(args)) return [];
  const dirs: string[] = [];
  args.forEach((a, i) => {
    const long = TAR_DIRECTORY.exec(a);
    if ((a === '-C' || (long !== null && long[1] === undefined)) && i + 1 < args.length) dirs.push(args[i + 1]);
    else if (long !== null && long[1] !== undefined) dirs.push(long[1]);
    else dirs.push(...clusterValue(a, args[i + 1], 'C', TAR_VALUE_LETTERS));
  });
  // the old style (`tar xCf DIR t.tar`): each letter that takes a value takes the next word, in order
  const first = args[0] ?? '';
  if (!first.startsWith('-') && first.includes('C')) {
    if (/[FgHKLNVs]/.test(first)) return [UNKNOWN];
    const letters = [...first].filter((l) => l === 'C' || TAR_VALUE_LETTERS.includes(l));
    const dir = args[1 + letters.indexOf('C')];
    dirs.push(dir ?? UNKNOWN);
  }
  return dirs.length > 0 ? dirs : ['.'];
}

/**
 * tar's short options other than `-C` that take a value in both GNU tar and bsdtar: a `C` after one is its value.
 * The others (`-s` is a flag in GNU tar, a value in bsdtar) are read as flags: the `C` after them is a folder.
 */
const TAR_VALUE_LETTERS = 'bfITX';

/**
 * The value of option `letter` inside a short-option cluster (getopt syntax, R-266 round 20, CR LOW-1): the rest of
 * the cluster (`-xC../x`), or the next word when it ends it (`-xC dir`); none when an option taking a value comes
 * first (`-fC`: C is the file) or the word is no cluster. A single `-C`/`-d` with its value apart is read by the caller.
 */
function clusterValue(word: string, next: string | undefined, letter: string, valueLetters: string): string[] {
  if (!/^-[^-]/.test(word)) return [];
  for (let n = 1; n < word.length; n++) {
    if (word[n] === letter) {
      if (n === 1 && word.length === 2) return [];
      const value = n + 1 < word.length ? word.slice(n + 1) : next;
      return value === undefined ? [] : [value];
    }
    if (valueLetters.includes(word[n])) return [];
  }
  return [];
}

/** Why: unzip -l/-t/-p/-v/-Z/-z list, test or print an archive without writing files. */
const UNZIP_NO_WRITE = /^-[A-Za-z]*[ltpvZz]/;

/** unzip unpacks into its `-d` folder, else the working folder. */
function unzipWrites(args: string[]): string[] {
  if (args.some((a) => UNZIP_NO_WRITE.test(a))) return [];
  const d = args.indexOf('-d');
  if (d !== -1 && d + 1 < args.length) return [args[d + 1]];
  // `-dDIR`, or `d` inside a cluster (`-qd DIR`, `-qdDIR`: round 20, CR LOW-1); `-P` takes the password
  const dirs = args.flatMap((a, i) => clusterValue(a, args[i + 1], 'd', 'P'));
  return dirs.length === 0 ? ['.'] : dirs;
}

/** cp options that take a value (GNU and BSD cp syntax), so the value is not read as a file. */
const CP_VALUES = ['-S', '--suffix', '-t', '--target-directory'];
const CP_TARGET = /^--target-directory=(.*)$/s;

/**
 * What a cp reads and writes: its sources, and its destination (the `-t` / `--target-directory`
 * folder, else the last operand). Options may come after the operands (GNU cp).
 */
export function cpOperands(words: string[]): { sources: string[]; dest: string | null; targetDir: boolean } {
  const args = spelledOutTarget(words, 'S');
  const named = operands(args, CP_VALUES);
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const attached = CP_TARGET.exec(args[i]);
    if (attached !== null) return { sources: named, dest: attached[1], targetDir: true };
  }
  return { sources: named.slice(0, -1), dest: named.at(-1) ?? null, targetDir: false };
}

/**
 * cp into a destination written with a trailing slash writes `<dest>/<basename of each source>`
 * (cp syntax). The destination itself is listed instead when a copy could land anywhere inside it:
 * a source that is only known when it runs or is a wildcard, ends with `/` (BSD cp then copies the
 * folder's contents), or is `.` / `..`; or `-T`, which writes the destination itself.
 */
function cpWrites(args: string[], globs: ReadonlyMap<string, string>): string[] {
  const { sources, dest: last, targetDir } = cpOperands(args);
  if (last === null) return [];
  const dest = [last];
  const into = !targetDir && last.endsWith('/') && sources.length > 0;
  const plain = (src: string): boolean => {
    const base = path.posix.basename(src);
    return !src.includes(UNKNOWN) && !globs.has(src) && !src.endsWith('/') && base !== '.' && base !== '..';
  };
  const whole = args.some((a) => a === '-T' || a === '--no-target-directory' || /^-[A-Za-z]*T/.test(a));
  if (!into || whole || globs.has(dest[0]) || !sources.every(plain)) return dest;
  return sources.map((src) => dest[0] + path.posix.basename(src));
}

/** Programs that can keep a backup of each file they replace (GNU coreutils `--backup`). */
const BACKUP_PROGRAMS = new Set(['cp', 'mv', 'ln', 'install']);
/** Their short options that take a value (GNU syntax): `-S` (the backup suffix, which turns backups on too) and the rest. */
const BACKUP_VALUE_LETTERS = new Set(['S', 't', 'm', 'o', 'g']);
const BACKUP_LONG = /^--(?:backup|suffix)(?:=.*)?$/;

/** True when a cp, mv, ln or install keeps backups: `-b`, `--backup[=…]`, `-S`/`--suffix` (GNU syntax). */
function makesBackup(name: string, args: string[]): boolean {
  if (!BACKUP_PROGRAMS.has(plainWriterName(name))) return false;
  for (const a of args) {
    if (a === '--') return false;
    if (BACKUP_LONG.test(a)) return true;
    if (!a.startsWith('-') || a.startsWith('--')) continue;
    for (const letter of a.slice(1)) {
      if (letter === 'b' || letter === 'S') return true;
      if (BACKUP_VALUE_LETTERS.has(letter)) break;
    }
  }
  return false;
}

/**
 * `find` options before its start folders (GNU and BSD find syntax): `-H -L -P` and BSD `-E -X -d -s
 * -x` clusters, GNU `-O<level>`; `-D <debug>` takes a value; BSD `-f <path>` names a start folder.
 */
const FIND_LEADING_FLAGS = /^-(?:[HLPEXdsx]+|O[0-9]*)$/;
/** Words that start find's expression (after the start folders). */
const FIND_EXPRESSION_START = new Set(['(', ')', '!', ',']);

/** The folders a `find` starts from (`.` when it names none). */
export function findStarts(args: string[]): string[] {
  const starts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-D') i++;
    else if (a === '-f' && i + 1 < args.length) starts.push(args[++i]);
    else if (FIND_LEADING_FLAGS.test(a)) continue;
    else if (a.startsWith('-') || FIND_EXPRESSION_START.has(a)) break;
    else starts.push(a);
  }
  return starts.length > 0 ? starts : ['.'];
}

/** `rm` options that remove whole folders (rm syntax): `-r`, `-R` in any cluster, `--recursive`. The cluster patterns here and in the rules use a lookahead (`-(?=[A-Za-z]*r)[A-Za-z]+`), so a long cluster is read in one pass, not once per letter (fix part K11). */
const RM_RECURSIVE = /^(?:-(?=[A-Za-z]*[rR])[A-Za-z]+|--recursive)$/;
/** `chmod` / `chown` options that change whole folders (only `-R`: `-r` is a chmod mode). */
const CHANGE_RECURSIVE = /^(?:-(?=[A-Za-z]*R)[A-Za-z]+|--recursive)$/;

/** True when a word before `--` matches the option. */
function hasOption(args: string[], option: RegExp): boolean {
  const end = args.indexOf('--');
  return (end === -1 ? args : args.slice(0, end)).some((a) => option.test(a));
}

/**
 * The words naming folders a part removes or changes as a whole, everything below included (fix
 * round 4, K3): `rm -r`, `chmod -R` / `chown -R`, and the start folders of a `find … -delete`.
 */
function recursiveOperands(name: string | null, args: string[]): string[] {
  switch (name === null ? null : plainWriterName(name)) {
    case 'rm':
      return hasOption(args, RM_RECURSIVE) ? operands(args) : [];
    case 'chmod':
    case 'chown':
      return hasOption(args, CHANGE_RECURSIVE) ? operands(args).slice(1) : [];
    case 'find':
      return args.includes('-delete') ? findStarts(args) : [];
    default:
      return [];
  }
}

/** ditto (macOS) options that take a value, so it is not read as a source or the destination. */
const DITTO_VALUES = ['--arch', '--bom', '--zlibCompressionLevel'];

/**
 * The Homebrew GNU names (coreutils, findutils, gnu-sed, gnu-tar, rsync … installed with a `g` in front) of writers
 * the gate knows: each writes as the plain one (round 19, PEN MEDIUM; round 20, SEC INFO-1). An explicit list: a `g`
 * is never taken off any other name (`git`, `grep`, `gzip`, `gawk` are programs of their own).
 */
const GNU_WRITERS: ReadonlySet<string> = new Set([
  'cp', 'mv', 'ln', 'install', 'rsync', 'tar', 'ditto', 'tee', 'rm', 'dd', 'touch', 'truncate', 'shred', 'chmod', 'chown',
  'mkdir', 'rmdir', 'sed', 'split', 'csplit', 'find', 'xargs',
]);

/** A writer's plain name: `gcp` is cp, `gditto` is ditto; any other name as it is. */
export function plainWriterName(name: string): string {
  return name.startsWith('g') && GNU_WRITERS.has(name.slice(1)) ? name.slice(1) : name;
}

function operandWrites(name: string | null, args: string[], globs: ReadonlyMap<string, string>, tempArgs: boolean[]): string[] {
  switch (name === null ? null : plainWriterName(name)) {
    case 'ditto': {
      // ditto copies (or archives, or unpacks) into its last operand
      const named = operands(args, DITTO_VALUES);
      return named.length > 1 ? named.slice(-1) : [];
    }
    case 'rsync':
      return rsyncWrites(args);
    case 'tar':
    case 'bsdtar':
      return tarWrites(args);
    case 'unzip':
      return unzipWrites(args);
    case 'mktemp':
      return mktempWrites(args, tempArgs);
    case 'mv': {
      // the target folder however written (round 19, PEN MEDIUM; round 20, CR LOW-1)
      const spelled = spelledOutTarget(args, 'S');
      return [...operands(spelled), ...spelled.filter((a) => a.startsWith('--target-directory=')).flatMap((a) => destination([a]))];
    }
    case 'rm':
    case 'tee':
    case 'touch':
      return operands(args);
    case 'cp':
      return cpWrites(args, globs);
    case 'ln':
      return destination(args, LN_VALUES);
    case 'install':
      return destination(args, INSTALL_VALUES, 'mogS');
    case 'truncate':
      return operands(args, TRUNCATE_VALUES);
    case 'chmod':
    case 'chown':
      return operands(args).slice(1);
    case 'dd':
      return args.filter((a) => a.startsWith('of=')).map((a) => a.slice('of='.length));
    case 'sed':
      return inPlaceFiles(args, SED);
    case 'perl':
      return inPlaceFiles(args, PERL);
    default:
      return [];
  }
}

/** The parts of the commands a sed or awk script runs (`e cmd`, `system("cmd")`), read as nested scripts. */
function scriptCommandParts(script: ScriptFacts | null, part: CommandPart, reading: Reading, depth: number): CommandPart[] {
  if (script === null || script.commands.length === 0) return [];
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  return script.commands.flatMap((command) => readScript(command, part.cwd, reading, depth + 1, part.dotGlob));
}

/** How an in-place editor's options are read. */
interface InPlaceSpec {
  /** Long options that switch in-place editing on (`--in-place`, `--in-place=.bak`). */
  inPlaceLong: string[];
  /** Options whose value is the script, so every operand is a file. */
  script: string[];
  /** Other options whose value is the next word when not attached. */
  values: string[];
  /** Short options whose value is the rest of their cluster only (`perl -I/x`). */
  attached: string[];
}

const SED: InPlaceSpec = {
  inPlaceLong: ['--in-place'],
  script: ['-e', '-f', '--expression', '--file'],
  values: ['-l', '--line-length'],
  attached: [],
};
const PERL: InPlaceSpec = { inPlaceLong: [], script: ['-e', '-E'], values: [], attached: ['-I', '-M', '-m', '-F', '-C', '-d', '-x'] };

/**
 * The files `sed -i` / `perl -i` edit in place: the operands after the script, or every operand
 * when the script comes from an option (`-e`, `-f`). `-i` takes the rest of its cluster as the
 * backup suffix. An empty word (BSD `sed -i ''`) is a suffix, not a file. Nothing without `-i`.
 */
function inPlaceFiles(args: string[], spec: InPlaceSpec): string[] {
  let inPlace = false;
  let scriptGiven = false;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      words.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('-') || a === '-') {
      if (a !== '') words.push(a);
    } else if (a.startsWith('--')) {
      const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
      // GNU getopt takes any unambiguous prefix of a long option (`--in` for `--in-place`)
      if (spec.inPlaceLong.some((full) => longOption(flag, full, 3))) inPlace = true;
      if (spec.script.includes(flag)) scriptGiven = true;
      if (!a.includes('=') && (spec.script.includes(flag) || spec.values.includes(flag))) i++;
    } else {
      for (let j = 1; j < a.length; j++) {
        const flag = `-${a[j]}`;
        if (flag === '-i') inPlace = true;
        if (spec.script.includes(flag)) scriptGiven = true;
        const takesNext = spec.script.includes(flag) || spec.values.includes(flag);
        if (takesNext && j === a.length - 1) i++;
        if (flag === '-i' || takesNext || spec.attached.includes(flag)) break;
      }
    }
  }
  if (!inPlace) return [];
  return scriptGiven ? words : words.slice(1);
}

/** The paths `git checkout -- <paths>` and `git restore <paths>` put back. */
function gitWrites(git: NonNullable<CommandPart['git']>): string[] {
  if (git.subcommand === 'checkout') {
    const end = git.args.indexOf('--');
    return end === -1 ? [] : git.args.slice(end + 1);
  }
  if (git.subcommand === 'restore') return operands(git.args, RESTORE_VALUES);
  return [];
}

function hostOf(arg: string): string[] {
  const value = arg.startsWith('-') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
  const url = URL_AUTHORITY.exec(value);
  let host: string | undefined;
  if (url) host = url[1].slice(url[1].lastIndexOf('@') + 1).replace(/:[0-9]*$/, '');
  else host = USER_AT_HOST.exec(value)?.[1] ?? (value.startsWith('-') ? undefined : BARE_HOST.exec(value)?.[1]);
  return host ? [host.toLowerCase()] : [];
}

/** A `git -C` whose directory is only known when it runs, as lost: git then runs somewhere the reader can't tell. */
function unknownGitDir(args: string[]): LostDir | null {
  for (let i = 0; i < args.length && args[i].startsWith('-'); i += GIT_VALUE_OPTIONS.has(args[i]) ? 2 : 1) {
    if (args[i] === '-C' && args[i + 1]?.includes(UNKNOWN) === true) return { why: `git -C ${args[i + 1]}`, pattern: null };
  }
  return null;
}

function readGit(args: string[], cwd: string, home: string): CommandPart['git'] {
  let dir = cwd;
  let unknown: string | undefined;
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i];
    if (a === '-C' && i + 1 < args.length) dir = resolvePath(args[i + 1], dir, home);
    const attached = a.startsWith('--') && a.includes('=') && GIT_VALUE_OPTIONS.has(a.slice(0, a.indexOf('=')));
    if (!GIT_VALUE_OPTIONS.has(a) && !GIT_FLAG_OPTIONS.has(a) && !attached) unknown ??= a;
    i += GIT_VALUE_OPTIONS.has(a) ? 2 : 1;
  }
  if (i >= args.length) return null;
  const subcommand = args[i];
  const rest = args.slice(i + 1);
  const noted = unknown === undefined ? {} : { unknownOption: unknown };
  if (PUSH_LIKE.has(subcommand)) return { subcommand: 'push', args: rest, dir, ...noted };
  if (subcommand === 'subtree' && rest[0] === 'push') return { subcommand: 'push', args: subtreePushWords(rest.slice(1)), dir, ...noted };
  return { subcommand, args: rest, dir, ...noted };
}

/** The repository and remote ref of `git subtree push` (its own options and their values dropped). */
function subtreePushWords(args: string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (SUBTREE_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith('-')) words.push(args[i]);
  }
  return words;
}
