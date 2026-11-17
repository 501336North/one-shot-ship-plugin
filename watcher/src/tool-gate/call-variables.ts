/**
 * Simple variables inside one Bash call (R-266 round 4, L): the plugin's served prompts name its
 * scripts through variables the same call sets (`PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}"`,
 * `X="$PLUGIN_ROOT/watcher/dist/cli/…"`, then `node "$X"`). The command reader can't know such a
 * value, so the call would read as running an unknown script. This fills the values in first, only
 * where they are certain:
 * - the assignments are the call's leading statements (`NAME="value"`, one per line or after `;`
 *   or `&&`), each variable set exactly once in the whole call and never set any other way;
 * - a value is plain text (letters, digits, `_ . / @ + : -`), the home folder, earlier such
 *   variables, or exactly `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}`, which is the plugin
 *   folder only when the gate trusts it (both places it can mean resolve to the folder the gate
 *   runs from); never `$(`, a backtick, `..` or a wildcard;
 * - nothing is filled in when the call sets CLAUDE_PLUGIN_ROOT, HOME or PATH, holds a heredoc or
 *   `$'…'` text, or has any other way to set a variable or move the shell (round 5: a setter
 *   builtin, eval, source, cd, `${…:=…}`, zsh's `${(…)…}`; round 6: zsh's print -v, set -A,
 *   integer, float, private, vared, zparseopts, sysread, strftime, zstat, zle, getln);
 * - a name the shell sets itself (PWD, REPLY, RANDOM, BASH_*, zsh's reply …) is never filled in;
 * - a value is filled in outside single quotes only (`$NAME` and `${NAME}`, never `${NAME%…}`).
 * Round 5 (never fail open): a call over MAX_INPUT characters or with over MAX_ASSIGNMENTS
 * assignments is left as it is, and so is one whose filled-in text would pass MAX_OUTPUT.
 * Any doubt leaves the call as it is, and the reader then reads the variable as unknown.
 */

import { tick } from './deadline.js';

/** Variables the call may not set for any value to be filled in. */
const MOVES_EVERYTHING = ['CLAUDE_PLUGIN_ROOT', 'HOME', 'PATH'];
/** The one non-plain value filled in: the plugin folder Claude Code names, or the installed plugin. */
const PLUGIN_ROOT_VALUE = '${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}';
const LEADING_ASSIGNMENT = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"[ \t]*(?:\n|;|&&|$)/;
const PLAIN_VALUE = /^[A-Za-z0-9_./@+:-]+$/;
const REFERENCE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
/** zsh reads `$NAME:h` and `$NAME[…]` as a modifier or subscript of the value (R-266 round 13, CR H-1): never filled in. */
const MODIFIED = /^[:[]/;
/** The largest call read, the most assignments, and the largest filled-in call. */
const MAX_INPUT = 32 * 1024;
const MAX_ASSIGNMENTS = 64;
const MAX_OUTPUT = 64 * 1024;
/** Builtins and forms that set a variable or move the shell some other way, as a command word. */
const OTHER_SETTERS =
  /(?:^|[\s;&|(`])(?:declare|typeset|export|local|readonly|read|mapfile|readarray|getopts|let|unset|eval|source|cd|pushd|popd|integer|float|private|vared|zparseopts|sysread|strftime|zstat|zle|getln)(?=$|[\s;&|)])/;
const DOT_SOURCE = /(?:^|[;&|(`\n])\s*\.(?=\s)/;
const PRINTF_V = /(?:^|[\s;&|(`])print(?:f)?\s(?:[^;&|\n]*\s)?-[A-Za-z]*v/;
/** zsh's `set -A` / `set +A` set an array. */
const SET_ARRAY = /(?:^|[\s;&|(`])set\s(?:[^;&|\n]*\s)?[-+][A-Za-z]*A/;
const EXPANSION_SETS = /\$\{\(|::=|:=/;
/** Names the shell sets itself (bash and zsh). */
const SHELL_SET = new Set(['PWD', 'OLDPWD', 'REPLY', 'MAPFILE', 'OPTARG', 'OPTIND', 'RANDOM', 'SECONDS', 'LINENO', 'UID', 'EUID', 'PPID', 'reply', 'match', 'MATCH', 'status', 'argv']);

/**
 * Names the shell maintains itself (bash and zsh), never followed or read from the environment
 * (R-266 round 12, D-R12-1 item 2): the last argument, the folder stack and history, the terminal
 * size, random numbers, completion and match state, zsh's tied arrays (`path`, `cdpath` …).
 */
const SHELL_MAINTAINED =
  /^(?:_|DIRSTACK|dirstack|PIPESTATUS|pipestatus|OLDPWD|PWD|HISTCMD|ERRNO|COLUMNS|LINES|SHLVL|GROUPS|FUNCNAME|EPOCH[A-Za-z0-9_]*|SRANDOM|RANDOM|COMP_[A-Za-z0-9_]*|ZSH_[A-Za-z0-9_]*|MBEGIN|MEND|mbegin|mend|TRY_BLOCK_[A-Za-z0-9_]*|path|fpath|psvar|cdpath|CDPATH|REPLY)$/;

function shellSets(name: string): boolean {
  return SHELL_SET.has(name) || name.startsWith('BASH') || SHELL_MAINTAINED.test(name);
}

/** How often each name appears as a word, and how often as a `$NAME` / `${NAME…}` reference, in one pass. */
function nameCounts(text: string, words = /(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g): Map<string, { words: number; references: number }> {
  const counts = new Map<string, { words: number; references: number }>();
  for (const match of text.matchAll(words)) {
    tick();
    const name = match[0];
    const at = match.index ?? 0;
    const count = counts.get(name) ?? { words: 0, references: 0 };
    count.words++;
    if (text[at - 1] === '$' || (text[at - 1] === '{' && text[at - 2] === '$')) count.references++;
    counts.set(name, count);
  }
  return counts;
}

/** True when the counts show the name set some way other than as a reference. */
function setIn(counts: ReadonlyMap<string, { words: number; references: number }>, name: string): boolean {
  const count = counts.get(name);
  return count !== undefined && count.words !== count.references;
}

/** The value of `NAME="value"`, or null when it is not certain. */
function valueOf(raw: string, known: ReadonlyMap<string, string>, home: string, pluginRoot: string | null): string | null {
  if (raw === PLUGIN_ROOT_VALUE) return pluginRoot;
  if (/[`*?[\]]|\$\(|\.\./.test(raw)) return null;
  let unknown = false;
  // the value's size so far: once past MAX_OUTPUT (`B="$A$A"`, doubled again and again), give up
  let size = raw.length;
  const value = raw.replace(REFERENCE, (all: string, braced: string | undefined, bare: string | undefined, at: number) => {
    tick();
    const name = braced ?? bare ?? '';
    const found = name === 'HOME' ? home : known.get(name);
    size += (found?.length ?? 0) - all.length;
    if (found === undefined || size > MAX_OUTPUT || (bare !== undefined && MODIFIED.test(raw.slice(at + all.length)))) {
      unknown = true;
      return '';
    }
    return found;
  });
  return !unknown && PLAIN_VALUE.test(value) && !value.includes('..') ? value : null;
}

/** The rest of the call with each known variable filled in, outside single quotes; null past MAX_OUTPUT. */
function fillIn(text: string, known: ReadonlyMap<string, string>, room: number): string | null {
  const out: string[] = [];
  let size = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    tick();
    const c = text[i];
    let piece = c;
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') {
      piece = text.slice(i, i + 2);
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === '$') {
      const match = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(text.slice(i, i + 256));
      const name = match?.[1] ?? match?.[2];
      const value = name === undefined ? undefined : known.get(name);
      if (match !== null && value !== undefined && !(match[2] !== undefined && MODIFIED.test(text.slice(i + match[0].length)))) {
        piece = value;
        i += match[0].length - 1;
      }
    }
    size += piece.length;
    if (size > room) return null;
    out.push(piece);
  }
  return out.join('');
}

/** True when the call could set a variable, or move the shell, in a way the reader can't follow here. */
function otherWaysToSet(command: string): boolean {
  return command.includes('<<') || command.includes("$'") || OTHER_SETTERS.test(command) || DOT_SOURCE.test(command) || PRINTF_V.test(command) || SET_ARRAY.test(command) || EXPANSION_SETS.test(command);
}

/**
 * The call with the values of its own leading simple variables filled in where they are certain;
 * the call as it is otherwise. `pluginRoot` is the plugin folder when the gate trusts it, else null.
 */
export function resolveCallVariables(command: string, home: string, pluginRoot: string | null): string {
  return fillCallVariables(command, home, pluginRoot);
}

function fillCallVariables(command: string, home: string, pluginRoot: string | null): string {
  if (command.length > MAX_INPUT || otherWaysToSet(command)) return command;
  const whole = nameCounts(command);
  if (MOVES_EVERYTHING.some((name) => setIn(whole, name))) return command;
  const statements: { name: string; raw: string; text: string }[] = [];
  let at = 0;
  for (;;) {
    tick();
    const match = LEADING_ASSIGNMENT.exec(command.slice(at, at + MAX_INPUT));
    if (match === null || match[0].trim() === '') break;
    if (statements.length === MAX_ASSIGNMENTS) return command;
    const [text, name = '', raw = ''] = match;
    statements.push({ name, raw, text });
    at += text.length;
    if (at >= command.length) break;
  }
  if (statements.length === 0) return command;
  // what follows each assignment: the later assignments and the rest of the call
  const later = statements.map((s) => nameCounts(s.text));
  const tail = nameCounts(command.slice(at));
  const known = new Map<string, string>();
  statements.forEach(({ name, raw }, i) => {
    tick();
    const value = valueOf(raw, known, home, pluginRoot);
    // set once, and never another way (`X=…` again, `for X in`)
    const elsewhere = setIn(tail, name) || later.slice(i + 1).some((counts) => setIn(counts, name));
    if (value !== null && !elsewhere && !known.has(name) && !shellSets(name)) known.set(name, value);
  });
  if (known.size === 0) return command;
  const filled = fillIn(command.slice(at), known, MAX_OUTPUT - at);
  return filled === null ? command : command.slice(0, at) + filled;
}

/*
 * Following a variable to its folder (R-266 round 11, D-R11-1): the command reader follows `cd "$D"`
 * to the value `D=…` set earlier in the same command, and only when nothing in the command could
 * change D between the set and the use. These read the command's text for that, failing closed.
 */

/** Names the reader never follows: the shell sets them itself, or they move where the shell looks. */
const NEVER_FOLLOWED = new Set(['HOME', 'PATH', 'CDPATH', 'cdpath', 'IFS', 'TMPDIR', 'CLAUDE_PLUGIN_ROOT', 'ENV', 'BASH_ENV']);

/**
 * Command words that set a variable without naming it or run text as commands (eval, source, alias,
 * nameref, enable). `trap` is added to them for the text before a use (HIDDEN_SETTERS), and left out for
 * the text after a filled trap (LATER_HIDDEN_SETTERS), where a later trap's script is read on its own.
 */
const HIDDEN_SETTER_WORDS = ['eval', 'source', 'alias', 'nameref', 'enable'];
/** The other forms that do so: `.`, a `-n` nameref declaration, `${!…}` / zsh's `${(…)…}`, `::=`. */
const HIDDEN_SETTER_FORMS =
  String.raw`(?:^|[;&|(\`\n])\s*\.(?=\s)|(?:^|[\s;&|(\`])(?:declare|typeset|local|export|readonly)\s(?:[^;&|\n]*\s)?-[A-Za-z]*n|\$\{[!(]|::=`;
function hiddenSetters(words: string[]): RegExp {
  return new RegExp(String.raw`(?:^|[\s;&|(\`])(?:${words.join('|')})(?=$|[\s;&|)])|` + HIDDEN_SETTER_FORMS);
}
/**
 * Before the use, anywhere in the command: a way to set a variable without naming it, or to run text
 * as commands (eval, source, `.`, an alias, a trap, a nameref, `${!…}` / zsh's `${(…)…}` / `::=`).
 */
const HIDDEN_SETTERS = hiddenSetters([...HIDDEN_SETTER_WORDS, 'trap']);
/**
 * After a trap whose script reads a variable (round 16, SEC HIGH-1): the same forms without `trap`. A
 * later trap is not one by itself; the command reader reads its script command by command (D-R18-1).
 */
const LATER_HIDDEN_SETTERS = hiddenSetters(HIDDEN_SETTER_WORDS);
/**
 * Between the set and the use, in the text (the reader checks each command there against its
 * allowlist of harmless commands, R-266 round 12, D-R12-1): arithmetic (which can set a variable
 * through another's value), `[[` (which evaluates arithmetic), a `${…}` other than `${NAME}` (which
 * can assign), or `$'…'` text.
 */
const SETTERS_BETWEEN = /\(\(|\$\[|\[\[|\$\{(?![A-Za-z_][A-Za-z0-9_]*\})|\$'/;

/** The non-reference occurrences of each name in a command, counted once per command. */
const COUNTED = new Map<string, Map<string, { words: number; references: number }>>();

/**
 * How many times `name` appears in `text` other than as `$name` / `${name…}`: each one could set it
 * (`name=…`, `read name`, `for name in`, `declare -n r=name` …). Counted over the whole command.
 */
export function plainMentions(text: string, name: string): number {
  let counts = COUNTED.get(text);
  if (counts === undefined) {
    // a letter right after a dash that starts a word is an option (`mktemp -d`), not a name; any other
    // name after `-` counts (`a[--F]`, `x-F`): arithmetic can set it (R-266 round 13, CR M-1)
    counts = nameCounts(text, /(?<![A-Za-z0-9_])(?<!(?:^|[\s'"=])-)[A-Za-z_][A-Za-z0-9_]*/g);
    // one command at a time is read: keep only the last one's counts
    COUNTED.clear();
    COUNTED.set(text, counts);
  }
  const count = counts.get(name);
  return count === undefined ? 0 : count.words - count.references;
}

/**
 * How many times `name` appears in `text` between `from` and `to` other than as `$name` / `${name…}`, by the
 * rule `plainMentions` counts the whole command with (R-266 round 20: the mentions inside a trap's own script).
 */
export function plainMentionsIn(text: string, name: string, from: number, to: number): number {
  const words = new RegExp(`(?<![A-Za-z0-9_])(?<!(?:^|[\\s'"=])-)${name}(?![A-Za-z0-9_])`, 'g');
  words.lastIndex = from;
  let count = 0;
  for (let m = words.exec(text); m !== null && m.index < to; m = words.exec(text)) {
    tick();
    if (text[m.index - 1] !== '$' && !(text[m.index - 1] === '{' && text[m.index - 2] === '$')) count++;
  }
  return count;
}

/**
 * True when a variable set in `text` may be followed to its use at `use`: never for a name the
 * shell sets or that moves where it looks; only when its name appears just once outside `$…` (the
 * set itself), nothing before the use can set it unnamed or run text as commands, and nothing between
 * the set (ending at `setEnd`) and the use sets variables or evaluates arithmetic. `read`: the text
 * searched for setters, the same length, with the traps that set nothing blanked (round 16, PERF LOW-1).
 */
export function mayFollow(text: string, name: string, setEnd: number, use: number, read = text): boolean {
  if (neverFollowed(name) || setEnd > use) return false;
  if (plainMentions(text, name) !== 1) return false;
  return !HIDDEN_SETTERS.test(read.slice(0, use)) && !SETTERS_BETWEEN.test(read.slice(setEnd, use));
}

/**
 * True when nothing in `text` after `from` can set the variable without naming it (round 16, SEC HIGH-1):
 * `eval`, `source`, an alias, a nameref … The variable must be followable, so no word names it twice.
 */
export function unchangedAfter(text: string, from: number): boolean {
  return !LATER_HIDDEN_SETTERS.test(text.slice(from));
}

/** True for a name the reader never follows or reads from the environment (D-R12-1 item 2). */
export function neverFollowed(name: string): boolean {
  return shellSets(name) || NEVER_FOLLOWED.has(name);
}

/**
 * True when a variable the command never sets may be read from the environment the gate sees at
 * its use (D-R12-1 item 3): no word in the command names it, and nothing before the use can set it
 * unnamed or run text as commands, or set it through arithmetic or an expansion.
 */
export function mayReadEnvironment(text: string, name: string, use: number): boolean {
  if (neverFollowed(name) || plainMentions(text, name) !== 0) return false;
  const before = text.slice(0, use);
  return !HIDDEN_SETTERS.test(before) && !SETTERS_BETWEEN.test(before);
}
