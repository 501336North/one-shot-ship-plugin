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

import path from 'node:path';
import { escapeGlob, globPathOf } from './patterns.js';
import { joinRaw } from './raw-path.js';
import { tick } from './deadline.js';
import { longOption, scriptFactsOf, type ScriptFacts } from './sed-awk.js';
import { dotsOf, globOf, heredocBodyOf, ReadBudget, tokenize, UNKNOWN, type Token } from './tokenize.js';

/**
 * The reader lost track of the shell's directory before a part (`cd -`, `cd "$D"`, `popd` …): why,
 * as the agent wrote it, and the directory as an absolute shell pattern when it was a wildcard
 * (`cd .oss/tool-gate?`), else null. The part's `cwd` is then the last directory it knew.
 */
export interface LostDir {
  why: string;
  pattern: string | null;
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
  /** Absolute shell patterns of the write targets written with an unquoted wildcard (`rm .oss/*`). */
  writeGlobs: string[];
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
  /** This part's wildcards also match names starting with `.` (dotglob / GLOB_DOTS set earlier in the call, or a `(D)` qualifier). */
  dotGlob: boolean;
  /** It runs with a terminal of its own (under `script`, `unbuffer` or an `expect` spawn), so git starts its pager. */
  terminal: boolean;
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
}

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
/** Words before `cd` that still change the shell's own directory. */
const CD_PREFIXES = new Set(['command', 'builtin', 'time']);

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
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
const ASSIGNMENT_PARTS = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\])?(\+?)=/;

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
export function readCommand(
  cmd: string,
  cwd: string,
  home: string,
  caseInsensitive = false,
  toplevel?: ToplevelOf,
  readFile?: ScriptFileReader,
  cdpath?: string,
): ReadResult {
  const reading: Reading = {
    home, budget: new ReadBudget(), unreadable: null, caseInsensitive, toplevel: toplevel ?? null, readFile: readFile ?? null, written: new Set(),
    files: new Map(), scriptCommands: new Map(), scanned: 0,
    cdpath: cdpath === undefined ? null : compactCdpath(cdpath.split(':')),
  };
  try {
    const parts = readScript(cmd, cwd, reading, 0);
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
  return result.tokens;
}

/** `dots`: the shell's patterns already match dot entries (the script runs where `dotglob` is on). */
function readScript(cmd: string, cwd: string, reading: Reading, depth: number, dots = false): CommandPart[] {
  return readTokens(tokensOf(cmd, reading), cwd, reading, depth, dots);
}

function readTokens(tokens: Token[], cwd: string, reading: Reading, depth: number, dots = false): CommandPart[] {
  const segments = split(tokens, cwd, reading.home, reading.toplevel, dots, reading.cdpath);
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

/** True when a command sets a `GIT_*` variable for the rest of the shell (`GIT_DIR=x;` alone, `export GIT_DIR=x`). */
function setsGitVariable(commandWords: string[], assigned: string[]): boolean {
  if (commandWords.length === 0 && assigned.some((w) => w.startsWith('GIT_'))) return true;
  return VARIABLE_BUILTINS.has(commandWords[0] ?? '') && commandWords.slice(1).some((w) => w.startsWith('GIT_'));
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

function split(tokens: Token[], cwd: string, home: string, toplevel: ToplevelOf | null = null, dots = false, startCdpath: string[] | null = null): Segment[] {
  const segments: Segment[] = [];
  /** `( … )` groups restore the directory (and glob options) they started in; `{ … }` groups (dir null) do not. */
  const groups: { dir: string | null; lost: LostDir | null; dotGlob: boolean; start: number }[] = [];
  const pushed: string[] = [];
  /** Words skipped up to the next operator (`for` header), up to `in` (`case` header), or one (function name). */
  let header: 'for' | 'case' | 'name' | null = null;
  let casePatterns = false;
  let caseDepth = 0;
  let closedGroupStart: number | null = null;
  let afterPipe = false;
  let dir = cwd;
  let lost: LostDir | null = null;
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
  /** Substitutions seen since the last segment, even in words that are skipped (a `for` list). */
  let scripts: Token[][] = [];

  const atCommandStart = (): boolean => words.length === 0 && redirects.length === 0;

  const openGroup = (groupDir: string | null): void => {
    if (groups.length >= MAX_GROUP_DEPTH) throw new ReadingLimit(`groups nested deeper than ${MAX_GROUP_DEPTH}`);
    groups.push({ dir: groupDir, lost, dotGlob, start: segments.length });
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
      cwd: dir,
      lostDir: lost,
      exits: [{ op: next, following: segments.length + 1 }],
      scripts,
      dotGlob: dotGlob || dotsWord,
      pipedFrom,
    });
    const apart = afterPipe || isPipe(next) || next === '&';
    if (cdpathArray !== null) {
      cdpath = compactCdpath(cdpathArray === 'append' ? [...(cdpath ?? []), ...commandWords] : commandWords);
      cdpathArray = null;
    }
    if (!apart) {
      // `CDPATH=x cd y` searches x for this cd only (read only when a command follows the assignments: K12)
      const searched = commandWords.length > 0 ? cdpathAfter(assigned, [], cdpath) : cdpath;
      ({ dir, lost } = dirAfter(commandWords, { dir, lost }, pushed, home, globs, searched));
      dotGlob = dotGlobAfter(commandWords, assigned, dotGlob);
    }
    cdpathArray = cdpathArrayOf(commandWords, assigned);
    cdpath = cdpathAfter(commandWords.length === 0 ? assigned : [], VARIABLE_BUILTINS.has(commandWords[0] ?? '') ? commandWords.slice(1) : [], cdpath);
    gitVariableSet ||= setsGitVariable(commandWords, assigned);
    dotsWord = false;
    pipedFrom = null;
    words = [];
    redirects = [];
    globs = new Map();
    scripts = [];
  };

  const readWord = (w: string, glob: string | undefined): void => {
    if (glob !== undefined) globs.set(w, glob);
    if (casePatterns) {
      if (w === 'esac') {
        caseDepth--;
        casePatterns = false;
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
      words.push(w);
    } else if (w === 'for' || w === 'select') {
      header = 'for';
    } else if (w === 'case') {
      header = 'case';
      caseDepth++;
    } else if (w === 'esac') {
      caseDepth = Math.max(0, caseDepth - 1);
    } else if (w === 'function') {
      header = 'name';
    } else if (w === '{') {
      openGroup(null);
    } else if (w === '}') {
      const group = groups.pop();
      if (group !== undefined) closedGroupStart = group.start;
    } else if (!KEYWORDS.has(w)) {
      words.push(w);
    }
  };

  for (let k = 0; k < tokens.length; k++) {
    tick();
    const token = tokens[k];
    if (token.kind !== 'op' && token.scripts !== undefined) scripts.push(...token.scripts);
    if (dotsOf(token)) dotsWord = true;
    if (token.kind === 'word') {
      // `$(git rev-parse --show-toplevel)` from a folder the reader knows is that repo's top folder
      const top = toplevel !== null && lost === null && !gitVariableSet && isToplevelWord(token) ? toplevel(dir) : null;
      readWord(top ?? token.value, globOf(token));
    }
    else if (token.kind === 'redirect') {
      const body = heredocBodyOf(token);
      redirects.push({ op: token.op, target: token.target, ...(body === undefined ? {} : { body }) });
      const glob = globOf(token);
      if (glob !== undefined) globs.set(token.target, glob);
    }
    else if (casePatterns || header === 'case') {
      // a case pattern list: `a|b)`, `(a)`
      if (casePatterns && token.value === ')') casePatterns = false;
    } else if (token.value === '(' && isOp(tokens[k + 1], ')')) {
      // `f()`: a function definition; its body follows
      words = [];
      k++;
    } else {
      if (header === 'for') header = null;
      const before = segments.length;
      close(token.value);
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
  const { words, cwd, assignments, values, lost, terminal, writes, alternates } = unwrap(segment.words, segment.cwd, reading);
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
  const operandsWritten = [...operandWrites(name, args, segment.globs), ...(scriptFacts?.writes ?? [])];
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
    stdinScripts: stdinScriptsOf(segment, name, args, reading),
    lostDir: segment.lostDir ?? lost ?? gitDirLost,
    hosts: args.flatMap(hostOf),
    git,
    pipedOut: segment.exits.some((e) => isPipe(e.op)),
    orTrue: segment.exits.some((e) => e.op === '||' && isTrue(segments[e.following]?.words ?? [])),
    followedByAnd: segment.exits[0]?.op === '&&',
    dotGlob: segment.dotGlob,
    terminal,
  };
  const settings = [
    ...settingParts(part, reading, depth),
    ...scriptCommandParts(scriptFacts, part, reading, depth),
    ...alternateParts(alternates, segment, segments, part, reading, depth),
  ];
  for (const target of part.writeTargets) reading.written.add(path.resolve(target));
  const script = scriptOf(name, program === null ? null : path.posix.basename(program), args) ?? stdinShellScript(name, args, part.stdinScripts) ?? expectSpawns(name, args, cwd, reading, stdinFed(segment));
  if (script === null) return [part, ...settings];
  if (DYNAMIC_SCRIPT.test(script) || script.includes(UNKNOWN)) {
    // Read past (ADR-010): the shell's own part is kept and checked; its script is not.
    reading.unreadable ??= `${name} runs a script that is not literal`;
    return [part, ...settings];
  }
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  const nested = readScript(script, cwd, reading, depth + 1, part.dotGlob || shellDots(name, args, part.assignments, part.assignmentValues));
  // The nested shell inherits the variables set for it (`GIT_DIR=x bash -c 'git push'`).
  return [part, ...settings, ...nested.map((p) => ({
    ...p,
    assignments: [...part.assignments, ...p.assignments],
    pipedOut: p.pipedOut || part.pipedOut,
    orTrue: p.orTrue || part.orTrue,
    // an `expect` spawn runs with a terminal of its own
    terminal: p.terminal || part.terminal || name === 'expect',
  }))];
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
 * git variables that only label a commit (who made it, and when) or trace what git does
 * (`GIT_TRACE`, `GIT_TRACE_PACKET` …): git never runs their values as a command.
 */
export const SAFE_GIT_VARIABLE = /^(?:GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)|GIT_TRACE[A-Za-z0-9_]*)$/;

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
): { words: string[]; cwd: string; assignments: string[]; values: string[]; lost: LostDir | null; terminal: boolean; writes: string[]; alternates: string[][] } {
  const { home } = reading;
  const alternates: string[][] = [];
  const assignments: string[] = [];
  const values: string[] = [];
  let lost: LostDir | null = null;
  let terminal = false;
  const writes: string[] = [];
  let dir = cwd;
  let rest = words;
  let unwrapped = 0;
  const wrapperOf = (word: string | undefined): WrapperSpec | undefined => (word === undefined ? undefined : WRAPPERS.get(programName(word, reading)));
  rest = withEquals(rest);
  for (let spec = first ?? wrapperOf(rest[0]); spec !== undefined; spec = wrapperOf(rest[0])) {
    if (++unwrapped > MAX_WRAPPERS) throw new ReadingLimit(`more than ${MAX_WRAPPERS} wrappers`);
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
  return { words: rest, cwd: dir, assignments, values, lost, terminal, writes, alternates };
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
    if (index !== null || (append && name === ZSH_CDPATH)) {
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
  if (rest.length === 0) return { dir: home, lost: null };
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

/** The `-t` directory, else the last operand: the destination of cp, ln and install. */
function destination(args: string[], values: string[] = []): string[] {
  const t = args.indexOf('-t');
  if (t !== -1 && t + 1 < args.length) return [args[t + 1]];
  return operands(args, values).slice(-1);
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

/** tar unpacks into each `-C`/`--directory` folder, else the working folder. */
function tarWrites(args: string[]): string[] {
  if (!tarExtracts(args)) return [];
  const dirs: string[] = [];
  args.forEach((a, i) => {
    if ((a === '-C' || a === '--directory') && i + 1 < args.length) dirs.push(args[i + 1]);
    else if (a.startsWith('--directory=')) dirs.push(a.slice('--directory='.length));
    else if (/^-C./.test(a)) dirs.push(a.slice(2));
  });
  return dirs.length > 0 ? dirs : ['.'];
}

/** Why: unzip -l/-t/-p/-v/-Z/-z list, test or print an archive without writing files. */
const UNZIP_NO_WRITE = /^-[A-Za-z]*[ltpvZz]/;

/** unzip unpacks into its `-d` folder, else the working folder. */
function unzipWrites(args: string[]): string[] {
  if (args.some((a) => UNZIP_NO_WRITE.test(a))) return [];
  const d = args.indexOf('-d');
  if (d !== -1 && d + 1 < args.length) return [args[d + 1]];
  const attached = args.find((a) => /^-d./.test(a));
  return attached === undefined ? ['.'] : [attached.slice(2)];
}

/** cp options that take a value (GNU and BSD cp syntax), so the value is not read as a file. */
const CP_VALUES = ['-S', '--suffix', '-t', '--target-directory'];
const CP_TARGET = /^(?:-t(.+)|--target-directory=(.*))$/;

/**
 * What a cp reads and writes: its sources, and its destination (the `-t` / `--target-directory`
 * folder, else the last operand). Options may come after the operands (GNU cp).
 */
export function cpOperands(args: string[]): { sources: string[]; dest: string | null; targetDir: boolean } {
  const named = operands(args, CP_VALUES);
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const a = args[i];
    const attached = CP_TARGET.exec(a);
    const target = attached === null ? ((a === '-t' || a === '--target-directory') ? args[i + 1] : undefined) : attached[1] ?? attached[2];
    if (target !== undefined) return { sources: named, dest: target, targetDir: true };
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
  if (!BACKUP_PROGRAMS.has(name)) return false;
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
  switch (name) {
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

function operandWrites(name: string | null, args: string[], globs: ReadonlyMap<string, string>): string[] {
  switch (name) {
    case 'ditto': {
      // ditto copies (or archives, or unpacks) into its last operand
      const named = operands(args, DITTO_VALUES);
      return named.length > 1 ? named.slice(-1) : [];
    }
    case 'rsync':
      return rsyncWrites(args);
    case 'tar':
    case 'bsdtar':
    case 'gtar':
      return tarWrites(args);
    case 'unzip':
      return unzipWrites(args);
    case 'rm':
    case 'mv':
    case 'tee':
    case 'touch':
      return operands(args);
    case 'cp':
      return cpWrites(args, globs);
    case 'ln':
      return destination(args, LN_VALUES);
    case 'install':
      return destination(args, INSTALL_VALUES);
    case 'truncate':
      return operands(args, TRUNCATE_VALUES);
    case 'chmod':
    case 'chown':
      return operands(args).slice(1);
    case 'dd':
      return args.filter((a) => a.startsWith('of=')).map((a) => a.slice('of='.length));
    case 'sed':
    case 'gsed':
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
