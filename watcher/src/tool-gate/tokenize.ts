/**
 * Shell tokenizer for the tool gate (ADR-007: our own, no dependency).
 *
 * Reads a shell command the way the shell would, for the parts the rules need:
 * words (quotes removed, braces, `$HOME` and `~user` expanded), control operators, and
 * redirects with their target. A command, process or arithmetic substitution, or any other
 * variable, is an `UNKNOWN` part of its word; the tokens of the commands a substitution runs
 * come with the word, so they are still checked. `eval` and `sh -c` scripts are returned as
 * words: the command reader decides whether they can be read (ADR-009).
 *
 * What it can't read is reported in two ways (ADR-010):
 * - a reading limit (input over 1 MB, nesting over 64, a word expanding to over 256 words, a
 *   call over 2048 words or 64 KB of words) stops the read at once: the gate refuses the call;
 *   so does a form the gate never reads (round 14, CR HIGH-1): zsh parameter flags `${(…)…}`, an
 *   unquoted `(` right after a word that is no pattern (a zsh glob qualifier or modifier,
 *   `src(:s#a#b#)`; outside `[[ … ]]`, `name=(…)` and `f()`), a glob qualifier that runs code, a zsh
 *   glob group `(a|b)` in the middle of a command (round 19, D-R19-3), a `name=(…)` that is no assignment,
 *   or a group after a pattern that holds a newline, comment, redirect or separator, or never closes (round 20),
 *   a `name=(` after a typeset-family word, reserved word or assignment that is not written plainly, and
 *   `disable -r` / `enable -r`, which change the reserved words (round 21);
 * - a `~` form other than `~`, `~/…` and `~user` (`~+`, `~-`, `~N`, `~[…]`) is an unknown head that
 *   counts as a substitution, so a bare one is refused as a write target (round 14, CR HIGH-2);
 * - anything else (an unterminated quote, a `${…}` or `$((…))` that runs a command) is
 *   unreadable, but the tokens around it are still returned (the commands inside `${…}` and
 *   `$((…))` included, and those before an unterminated quote), so they are still checked.
 */

import os from 'node:os';
import path from 'node:path';
import { tick } from './deadline.js';
import { escapeGlob, hasShellWildcard } from './patterns.js';

/**
 * Stands for text whose value is only known when the command runs: a command or process
 * substitution, an arithmetic expansion, a variable other than `$HOME`, or `~user`. A word may
 * be wholly unknown (`"$(git branch --show-current)"` is exactly `UNKNOWN`) or partly
 * (`.oss/tool-gates/$(x)` is `.oss/tool-gates/` + `UNKNOWN`). No real input can contain it:
 * the tokenizer drops NUL characters from the command, as bash does when it reads a script,
 * and a `$'…'` string ends at its first NUL.
 */
export const UNKNOWN = '\u0000DYN\u0000';

/**
 * A word or a redirect target may carry `scripts`: the tokens of each command or process
 * substitution in it, which run before the command does.
 */
export type Token =
  | { kind: 'word'; value: string; scripts?: Token[][] }
  | { kind: 'op'; value: string }
  | { kind: 'redirect'; op: string; target: string; scripts?: Token[][] };

type RedirectToken = Extract<Token, { kind: 'redirect' }>;

/**
 * The shell pattern of each word or redirect target written with an unquoted `*`, `?` or `[…]`
 * (quoted wildcard characters escaped with `\`), which the shell expands when the command runs.
 * Kept beside the tokens rather than on them, so a token's shape stays what it was.
 */
const GLOBS = new WeakMap<Token, string>();

/** The shell pattern a word or redirect target stands for, when it has an unquoted wildcard. */
export function globOf(token: Token): string | undefined {
  return GLOBS.get(token);
}

/**
 * The pattern of each word or redirect target written with an unquoted `#`, `^` or `~` (after its
 * first character), each as `*`: zsh's EXTENDED_GLOB operators, read only after a shell option the
 * reader doesn't model (round 14, SEC HIGH-2).
 */
const ZSH_GLOBS = new WeakMap<Token, string>();

/** The pattern a word or redirect target stands for when zsh's extended glob operators are on, when it has one. */
export function extendedGlobOf(token: Token): string | undefined {
  return ZSH_GLOBS.get(token);
}

/** Stands, in a word's extended pattern, for a character a `^` or `~` covers: dropped once braces are expanded. */
const SKIPPED = '\u0001';

/** The words and redirect targets written with a glob qualifier (zsh `*(D)`), which may also match dot entries. */
const DOTS = new WeakSet<Token>();

/** True when a word or redirect target's pattern may also match names starting with `.` (a zsh glob qualifier). */
export function dotsOf(token: Token): boolean {
  return DOTS.has(token);
}

/**
 * Characters that start a bash extended glob when a `(` follows (`!(x)`, `@(a|b)`, `+(x)`); `*(…)`
 * and `?(…)` are ones too, and `*(…)` is also a zsh glob qualifier.
 */
const EXTGLOB_START = /[!@+]$/;
/**
 * The characters a zsh glob qualifier list may start with (zsh 5.9): at any other first character zsh
 * stops with an error before it reads the rest, so nothing in it runs (`!(keep.txt)`, `!(keeper)`).
 */
const QUALIFIER_START = new Set('/.@=p*%rwxAIERWXsStfedlUGugamcLMTNDnoOYF^-[P:+#');
/**
 * Characters that make a qualifier list run code or rewrite the names wherever they sit, since an
 * argument before them may end anywhere (`u_name_` …): `+name` and `o+name` call a function, `:` starts
 * a modifier (`:s/a/b/`), `#` an extended-glob `(#q…)` list, `(` a nested group.
 */
const REWRITING_CHARS = /[+:#(]/;
/**
 * A `[…]` subscript in a qualifier list holding more than digits, `,` and `-` (R-266 round 16, ADR-047):
 * zsh evaluates it as arithmetic, so a variable there runs any `$(…)` its value holds (`*([X])`).
 */
const SUBSCRIPT_NOT_NUMBERS = /\[(?![0-9,-]*\])/;
/** Qualifiers that take a string: `e` runs it as code (`oe` too), `P` adds it as a word before each name. */
const STRING_QUALIFIERS = new Set(['e', 'P']);
/** A string qualifier's delimiter closes with the same character, or with its pair for these. */
const CLOSING: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '<': '>' };

/**
 * True when zsh may read a `(…)` after a pattern (a glob qualifier list, or what bash reads as an
 * extended pattern: `!(…)`, `@(…)`, `*(…)`) as qualifiers that run code or rewrite the names (R-266
 * round 15, D-R14-4): a `+`, `:`, `#` or `(` anywhere, or an `e` or `P` whose delimiter (the character
 * after it) closes later in the list, wherever it sits (`!(tests)` runs `t`; `!(test)` and
 * `!(node_modules)` never close, so zsh stops with an error). Not when the list starts with a character
 * no qualifier starts with, or holds `|` (an alternation, not qualifiers). Always when it holds a `$` or
 * a backtick, whose text is only known when it runs (round 17, CR limit B).
 */
function qualifierRewrites(inside: string): boolean {
  // round 17, CR limit B: a `$` or backtick puts text known only when it runs in the list (`*($X)`, `*($(…))`)
  if (/[$`]/.test(inside)) return true;
  if (inside.includes('|') || !QUALIFIER_START.has(inside[0] ?? '')) return false;
  if (REWRITING_CHARS.test(inside) || SUBSCRIPT_NOT_NUMBERS.test(inside)) return true;
  for (let i = 0; i < inside.length; i++) {
    const open = inside[i + 1];
    if (!STRING_QUALIFIERS.has(inside[i]) || open === undefined) continue;
    if (inside.indexOf(CLOSING[open] ?? open, i + 2) !== -1) return true;
  }
  return false;
}

/**
 * Where each word token stands in the text it was read from (its first character and the one after
 * its last), for a word that brace expansion left whole: the command reader reads a variable's
 * assignment and use as written there (R-266 round 11, D-R11-1).
 */
const SOURCES = new WeakMap<Token, { start: number; end: number }>();

/** Where a word token stands in the text it was read from, when known. */
export function sourceOf(token: Token): { start: number; end: number } | undefined {
  return SOURCES.get(token);
}

/** The body of each heredoc (`<<EOF`, `<<-EOF`), by its redirect token (kept beside the tokens, as GLOBS). */
const HEREDOC_BODIES = new WeakMap<Token, string>();

/** The text a heredoc feeds on stdin (tabs stripped for `<<-`), as written. */
export function heredocBodyOf(token: Token): string | undefined {
  return HEREDOC_BODIES.get(token);
}

/**
 * `limit`: a reading limit was reached and `tokens` is empty. Otherwise `tokens` holds what was
 * read: all of it with the unreadable pieces as `UNKNOWN`, or the tokens before a syntax error.
 */
export type TokenizeResult = { tokens: Token[] } | { unreadable: true; reason: string; limit: boolean; tokens: Token[] };

const CONTROL_OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '(', ')', '\n'];
/**
 * Redirect operators of bash and zsh. zsh adds the clobber forms (`>!`, `>>!`, `>>|`, and `&>`, `>&`,
 * `&>>`, `>>&` each followed by `|` or `!`), which write the next word even with NO_CLOBBER set.
 */
const REDIRECT_OPERATORS = [
  '&>>|', '&>>!', '>>&|', '>>&!', '&>>', '&>|', '&>!', '>&|', '>&!', '<<<', '<<-', '>>|', '>>!',
  '&>', '>>', '>|', '>!', '<<', '<>', '>', '<',
];
/** Longest first, so `&&` wins over `&` and `>>` over `>`. */
const ALL_OPERATORS = [...CONTROL_OPERATORS, ...REDIRECT_OPERATORS].sort((a, b) => b.length - a.length);
const HEREDOC_OPERATORS = ['<<', '<<-'];
/**
 * Words after which a command starts, so a `case` there is the keyword (shell grammar, not a
 * rule value). Reading `case` only there keeps `echo case in a)` an ordinary command.
 */
/** A function name as a definition `name()` writes it (bash allows more; these are the common ones). */
const FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const COMMAND_START_WORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!', 'time']);
/** A word zsh reads as `name=(…)`, an array, where an assignment can stand (round 20, SEC HIGH-2). */
const ARRAY_NAME = /^[A-Za-z_][A-Za-z0-9_]*\+?=$/;
/** A word the shell reads as an assignment before a command's name. */
/** What makes a word not written plainly for zsh's reserved words and assignments: quotes, backslashes, `$`, backticks, braces. */
const NOT_PLAIN = /['"\\$`{}]/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
/** Commands whose `name=(…)` arguments zsh reads as arrays (round 20, SEC HIGH-2). */
const TYPESET_FAMILY = new Set(['typeset', 'declare', 'local', 'export', 'readonly', 'integer', 'float']);
/** Words before a command's name that leave it the command: reserved words and precommand modifiers (round 21). */
const PRECOMMANDS = new Set([...COMMAND_START_WORDS, 'builtin', 'command', 'noglob', 'nocorrect', 'exec', '-']);
/** Words that may stand before an array assignment where a command starts: reserved words and `nocorrect` (round 21, CR INFO-1). */
const ARRAY_PREFIXES = new Set([...COMMAND_START_WORDS, 'nocorrect']);
/**
 * What ends or splits a zsh glob group after a pattern, or hides a command in it (round 20, PEN HIGH-1 =
 * SEC HIGH-1): zsh ends the word at a `<`, `>`, `&` or `;` (the rest runs as a command) and reads the group
 * across newlines; a backtick runs a command.
 */
const GROUP_HIDES = new Set(['\n', '<', '>', '&', ';', '`']);
/** Characters a backslash escapes inside double quotes (a newline is a line continuation). */
const DOUBLE_QUOTE_ESCAPABLE = '$`"\\\n';

/** A piece the tokenizer can't read (a syntax error); what came before it is still returned. */
class Unreadable extends Error {}
/** A reading limit: the read stops and the call is refused as too complex to check. */
class ReadingLimit extends Error {}
/**
 * A form the gate never reads (R-266 round 14, CR HIGH-1): zsh parameter flags `${(…)…}`, a zsh glob
 * qualifier or modifier on a word that is no pattern (`src(:s#a#b#)`), or a qualifier that runs code.
 * They can rewrite a path or run a command, and in bash they are a syntax error: the read stops and the
 * call is refused, as at a reading limit.
 */
class NeverRead extends Error {}

/**
 * Reading limits (not rule values): a bigger command, deeper nesting or a brace word that
 * expands further stops the read, which keeps every read fast. Bash expands any sequence; we
 * only expand short ones and leave longer ones as written.
 */
const MAX_INPUT_CHARS = 1024 * 1024;
const MAX_NESTING = 64;
const MAX_BRACE_WORDS = 256;
const MAX_SEQUENCE_ITEMS = 64;
/**
 * Most words, and most characters of words after expansion, one Bash call may hold (reading
 * limits, not rule values). Counted while words are built, so a call can't make the gate build
 * millions of words first: each word may be looked up on disk, and a gate slower than its time
 * limit allows the call. Real commands stay far below both.
 */
export const MAX_CALL_WORDS = 2048;
export const MAX_CALL_CHARS = 64 * 1024;

/** The words and characters a call has used so far; shared by every tokenize of one call. */
export class ReadBudget {
  private words = 0;
  private chars = 0;
  private operators = 0;

  /**
   * Counts one more operator (round 18): a flood of `(`, `;` or newlines makes no words, so without
   * this the whole input was read before any limit stopped it.
   */
  takeOperator(): void {
    if (++this.operators > MAX_CALL_WORDS) throw new ReadingLimit(`too many operators: over ${MAX_CALL_WORDS}`);
  }

  /** Counts `count` more words of `chars` characters; a reading limit when the call goes over. */
  take(count: number, chars: number): void {
    this.words += count;
    this.chars += chars;
    if (this.words > MAX_CALL_WORDS) throw new ReadingLimit(`too many words: over ${MAX_CALL_WORDS}`);
    this.checkChars(0);
  }

  /** A reading limit when `more` characters would take the call over its characters. */
  checkChars(more: number): void {
    if (this.chars + more > MAX_CALL_CHARS) throw new ReadingLimit(`words longer than ${MAX_CALL_CHARS / 1024} KB in all`);
  }
}

/** Set when a piece was read past as unknown; shared by the scanners of one tokenize. */
interface ReadFlags {
  unreadable: string | null;
}

/** Characters that end an unquoted word: blanks and the first characters of operators. */
const WORD_END = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>']);
/** A shell variable name, and the one-character special parameters (`$1`, `$@`, `$?` …). */
const NAME_START = /[A-Za-z_]/;
const NAME = /[A-Za-z0-9_]*/y;
const SPECIAL_PARAMETER = /[0-9@*#?$!-]/;
/** A user name after `~`, up to `/` or the end of the word. */
const TILDE_USER = /[A-Za-z0-9._-]+/y;
const TILDE_USER_START = /[A-Za-z0-9._-]/;
/** zsh's one-character parameter flags right after `${`: `~` (globsubst), `=` (word splitting), `^` (rcexpandparam). */
const PARAMETER_FLAG_CHARS = new Set(['~', '=', '^']);
/** `~+`, `~-`, `~N`, `~+N`, `~-N`, up to `/` or the end of the word: a folder of the shell's stack. */
const STACK_TILDE = /~(?:[+-][0-9]*|[0-9]+)(?=$|[\/ \t\n;&|()<>])/y;

export function tokenize(cmd: string, home?: string, budget: ReadBudget = new ReadBudget()): TokenizeResult {
  if (cmd.length > MAX_INPUT_CHARS) return { unreadable: true, reason: 'command larger than 1 MB', limit: true, tokens: [] };
  const flags: ReadFlags = { unreadable: null };
  const scanner = new Scanner(cmd.replaceAll('\0', ''), home, budget, flags);
  try {
    const tokens = scanner.script(0, false);
    return flags.unreadable === null ? { tokens } : { unreadable: true, reason: flags.unreadable, limit: false, tokens };
  } catch (err) {
    if (err instanceof ReadingLimit || err instanceof NeverRead) return { unreadable: true, reason: err.message, limit: true, tokens: [] };
    if (err instanceof Unreadable) return { unreadable: true, reason: err.message, limit: false, tokens: scanner.top };
    throw err;
  }
}

function matchOperator(cmd: string, i: number): string | undefined {
  return ALL_OPERATORS.find((op) => cmd.startsWith(op, i));
}

/** Single-character escapes inside bash `$'…'`. */
const ANSI_C_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v',
  '\\': '\\', "'": "'", '"': '"', '?': '?',
};
/** Escapes that take a run of digits: `\NNN` octal, `\xHH`, `\uHHHH`, `\UHHHHHHHH`. */
const ANSI_C_NUMERIC: Record<string, { digits: RegExp; radix: number; skip: number }> = {
  '0': { digits: /[0-7]{1,3}/y, radix: 8, skip: 1 },
  x: { digits: /[0-9A-Fa-f]{1,2}/y, radix: 16, skip: 2 },
  u: { digits: /[0-9A-Fa-f]{1,4}/y, radix: 16, skip: 2 },
  U: { digits: /[0-9A-Fa-f]{1,8}/y, radix: 16, skip: 2 },
};
for (const d of '1234567') ANSI_C_NUMERIC[d] = ANSI_C_NUMERIC['0'];

/**
 * Decodes a bash `$'…'` string whose body starts at `start`; returns the text and the index
 * after the closing quote. Like bash, a NUL ends the text (the rest up to the quote is dropped).
 */
function readAnsiCQuote(cmd: string, start: number): { text: string; end: number } {
  let text = '';
  let ended = false;
  let i = start;
  while (i < cmd.length) {
    tick();
    const c = cmd[i];
    if (c === "'") return { text, end: i + 1 };
    let decoded = c;
    let length = 1;
    if (c === '\\' && i + 1 < cmd.length) {
      const e = cmd[i + 1];
      const numeric = ANSI_C_NUMERIC[e];
      decoded = c + e;
      length = 2;
      if (e in ANSI_C_ESCAPES) {
        decoded = ANSI_C_ESCAPES[e];
      } else if (e === 'c' && i + 2 < cmd.length) {
        decoded = String.fromCharCode(cmd[i + 2].toUpperCase().charCodeAt(0) ^ 0x40);
        length = 3;
      } else if (numeric !== undefined) {
        numeric.digits.lastIndex = i + numeric.skip;
        const digits = numeric.digits.exec(cmd)?.[0];
        if (digits !== undefined) {
          const codePoint = parseInt(digits, numeric.radix);
          if (codePoint > 0x10ffff) throw new Unreadable(`escape \\${e}${digits} is not a character`);
          decoded = String.fromCodePoint(codePoint);
          length = numeric.skip + digits.length;
        }
      }
    }
    if (decoded === '\0') ended = true;
    if (!ended) text += decoded;
    i += length;
  }
  throw new Unreadable("unterminated $' quote");
}

/** The word being read: its text, which characters are unquoted braces or commas, and its substitutions. */
class Word {
  text = '';
  /** The word as a shell pattern: unquoted characters as typed, quoted wildcard characters escaped. */
  glob = '';
  /** Indices in `text` of unquoted `{`, `,` and `}`: the only ones brace expansion reads. */
  braces: number[] = [];
  /** The same braces' indices in `glob`. */
  globBraces: number[] = [];
  /**
   * `glob` as zsh reads it with EXTENDED_GLOB, same length (brace positions line up): each unquoted `#`
   * as `*`; an unquoted `^` (anything but what follows) as `*` for the rest of its path segment, and a
   * non-leading `~` (what is left of it, less what follows) as `*` for the rest of the word (round 16,
   * CR HIGH-1); the characters they cover kept as SKIPPED, dropped once braces are expanded. And whether it has one.
   */
  extended = '';
  extendedWild = false;
  /** Covered by a `^` (`segment`, to the next `/`) or a `~` (`word`, to its end): what is read there adds SKIPPED. */
  private covered: 'none' | 'segment' | 'word' = 'none';
  /** `extended` ends in an unescaped `*`, so a `^` or `~` right after adds nothing (no `**`, which crosses folders). */
  private endsInStar = false;
  scripts: Token[][] = [];
  started = false;
  /** Any part was quoted or escaped: then a heredoc delimiter makes its body literal, and the word is no keyword. */
  quoted = false;
  /** A glob qualifier (`*(D)`) may make the pattern match dot entries too. */
  dots = false;
  /** The pattern was seen to hold a wildcard: it only grows, so it keeps it (round 9, perf HIGH-1). */
  private wild = false;

  /** True when the pattern holds a wildcard; once true, never searched again. */
  hasWildcard(): boolean {
    this.wild ||= hasShellWildcard(this.glob);
    return this.wild;
  }

  /** Quoted, escaped or expanded text: never a wildcard. */
  add(text: string): void {
    this.text += text;
    this.glob += escapeGlob(text);
    for (const c of escapeGlob(text)) this.extend(c);
    this.started = true;
  }

  /** An unquoted character as typed: `*`, `?` and `[` in it are wildcards. */
  addPlain(c: string): void {
    const operator = c === '#' || c === '^' || (c === '~' && this.started);
    this.extendedWild ||= operator;
    if (operator && c !== '#') {
      // round 16, CR HIGH-1: `^x` is any name but x (not a dot name, as zsh 5.9 reads it); `x~y` is what x matches, less y
      this.extend(this.endsInStar ? SKIPPED : '*', true);
      if (this.covered !== 'word') this.covered = c === '^' ? 'segment' : 'word';
    } else if (c === '#' && this.covered === 'none' && this.extended.length > 0 && !this.extended.endsWith(SKIPPED)) {
      // `x#` is zero or more `x`: the character before a `#` may be missing too
      this.extended = `${this.extended.slice(0, -1)}*`;
      this.extend(SKIPPED);
      this.endsInStar = true;
    } else {
      this.extend(c === '#' ? '*' : c, c === '*' || c === '#');
    }
    this.text += c;
    this.glob += c;
    this.started = true;
  }

  /**
   * Adds one character to `extended`: SKIPPED where a `^` or `~` covers it (a `/` ends a `^`'s cover).
   * `star`: it is a `*` wildcard as read, which a `^` or `~` right after needs no other `*` for.
   */
  private extend(c: string, star = false): void {
    if (this.covered === 'segment' && c === '/') this.covered = 'none';
    if (this.covered !== 'none') {
      this.extended += SKIPPED;
      return;
    }
    this.extended += c;
    this.endsInStar = star || (c === SKIPPED && this.endsInStar);
  }

  addBrace(c: string): void {
    this.braces.push(this.text.length);
    this.globBraces.push(this.glob.length);
    this.text += c;
    this.glob += c;
    // a brace stays where expansion looks for it, even under a `^` or `~`
    this.extended += c;
    this.endsInStar = false;
    this.started = true;
  }

  addUnknown(script?: Token[]): void {
    this.add(UNKNOWN);
    if (script !== undefined) this.scripts.push(script);
  }
}

class Scanner {
  i = 0;
  /** The top-level tokens read so far: what a syntax error leaves readable. */
  top: Token[] = [];

  constructor(
    private readonly cmd: string,
    private readonly home: string | undefined,
    private readonly budget: ReadBudget,
    private readonly flags: ReadFlags,
  ) {}

  /**
   * Reads a script from `i`: to the end of the input, or (inside `$( … )`, `<( … )`) up to and
   * past the `)` that closes it.
   */
  script(depth: number, closed: boolean): Token[] {
    if (depth > MAX_NESTING) throw new ReadingLimit(`substitutions nested deeper than ${MAX_NESTING}`);
    const { cmd } = this;
    const tokens: Token[] = [];
    if (depth === 0) this.top = tokens;
    /** Heredocs whose bodies start after the next newline; a `literal` body (quoted delimiter) runs no substitutions. */
    const heredocs: { delimiter: string; stripTabs: boolean; token: RedirectToken; literal: boolean }[] = [];
    /**
     * Open `case` commands, innermost last: reading the header (up to `in`), a pattern (up to its
     * `)`, which then closes no substitution), or the commands of an item (up to `;;` or `esac`).
     */
    const cases: ('header' | 'pattern' | 'body')[] = [];
    let word = new Word();
    let quote: '' | "'" | '"' = '';
    let pendingRedirect: string | null = null;
    let pendingRedirectEnd = -1;
    let parens = 0;
    /** Open `[[ … ]]` tests: in one, an unquoted `(` in a word is part of a pattern or regex. */
    let tests = 0;
    /**
     * Open `(` of a `[[ … ]]` test or a case pattern: in one, zsh reads a `#` as pattern text, never as a
     * comment (round 18, CR limit 2).
     */
    let patternParens = 0;
    /** The `for` and `coproc` words read where a command starts: the keywords, not arguments (round 18, SEC MEDIUM-2). */
    const keywords = new WeakSet<Token>();
    /** Where the word being read starts in `cmd`. */
    let wordStart = this.i;

    const endWord = (): void => {
      if (!word.started) return;
      const done = word;
      word = new Word();
      const heredoc = pendingRedirect !== null && HEREDOC_OPERATORS.includes(pendingRedirect);
      this.budget.checkChars(done.text.length);
      const values = heredoc ? [done.text] : expandBraces(done.text, done.braces, this.budget);
      this.budget.take(values.length, values.reduce((n, v) => n + v.length, 0));
      const globs = !heredoc && hasShellWildcard(done.glob) ? expandBraces(done.glob, done.globBraces, new ReadBudget()) : [];
      const extendedGlobs = !heredoc && done.extendedWild ? expandBraces(done.extended, done.globBraces, new ReadBudget()) : [];
      /** Records the pattern of the n-th expanded word, when it still has a wildcard. */
      const withGlob = <T extends Token>(token: T, n: number): T => {
        const glob = globs.length === values.length ? globs[n] : undefined;
        if (glob !== undefined && hasShellWildcard(glob)) GLOBS.set(token, glob);
        const extended = extendedGlobs.length === values.length ? extendedGlobs[n] : undefined;
        if (extended !== undefined) ZSH_GLOBS.set(token, extended.replaceAll(SKIPPED, ''));
        if (done.dots) DOTS.add(token);
        return token;
      };
      const scripts = done.scripts.length > 0 ? { scripts: done.scripts } : {};
      if (pendingRedirect !== null) {
        const op = pendingRedirect;
        const redirects = values.map((target, n): RedirectToken => withGlob({ kind: 'redirect', op, target, ...(n === 0 ? scripts : {}) }, n));
        if (heredoc) {
          heredocs.push({ delimiter: done.text, stripTabs: op === '<<-', token: redirects[0], literal: done.quoted });
        } else if (redirects.length === 1) {
          // the target word as written, so the reader can follow a variable in it (R-266 round 12, D-R12-1)
          SOURCES.set(redirects[0], { start: wordStart, end: this.i });
        }
        tokens.push(...redirects);
        pendingRedirect = null;
        return;
      }
      if (!done.quoted) {
        readCaseWord(done.text);
        if (done.text === '[[' && atCommandStart()) tests++;
        else if (done.text === ']]' && tests > 0) tests--;
      }
      const words = values.map((value, n): Token => withGlob({ kind: 'word', value, ...(n === 0 ? scripts : {}) }, n));
      if (values.some((v) => /^-[A-Za-z]*r/.test(v)) && changesReservedWords()) {
        throw new NeverRead("`disable -r` and `enable -r` change zsh's reserved words; the gate doesn't run calls that use them");
      }
      if (words.length === 1) SOURCES.set(words[0], { start: wordStart, end: this.i });
      if (!done.quoted && (done.text === 'for' || done.text === 'coproc') && atCommandStart()) keywords.add(words[0]);
      tokens.push(...words);
    };

    /** The command being read is `disable` or `enable` (after assignments and precommand words): with a `-r` it changes the reserved words (round 21). */
    const changesReservedWords = (): boolean => {
      let n = tokens.length;
      while (n > 0 && tokens[n - 1].kind !== 'op') n--;
      for (const t of tokens.slice(n)) {
        if (t.kind !== 'word') continue;
        if (t.value === 'disable' || t.value === 'enable') return true;
        if (!ASSIGNMENT.test(t.value) && !PRECOMMANDS.has(t.value) && !t.value.startsWith('-')) return false;
      }
      return false;
    };

    const atCommandStart = (): boolean => {
      const last = tokens[tokens.length - 1];
      return last === undefined || last.kind === 'op' || (last.kind === 'word' && COMMAND_START_WORDS.has(last.value));
    };

    /** The word being read names a function being defined: `f()` where a command starts, or after `function`. */
    const definesFunction = (): boolean => {
      const last = tokens[tokens.length - 1];
      return !word.quoted && FUNCTION_NAME.test(word.text) && (atCommandStart() || (last?.kind === 'word' && last.value === 'function'));
    };

    /**
     * A `(` at `i`, where no word is being read, opens a zsh glob group (`ls (a|b)`, `> (x|y)/z`), which the
     * gate never reads (round 19, D-R19-3): the command already has words or a redirect waits for its target
     * (round 17, CR limit A). Not where a
     * command starts (a subshell, `((`), in `[[ … ]]` or a case pattern, for `for ((…))` / zsh's
     * `for x (…)` and `coproc (…)` (only after the keyword, read where a command starts: round 18,
     * SEC MEDIUM-2), or before `)` (`f ()`, `function f ()`).
     */
    const globGroupHere = (i: number): boolean => {
      if (tests > 0 || cases[cases.length - 1] === 'pattern' || /^\(\s*\)/.test(cmd.slice(i, i + 64))) return false;
      if (pendingRedirect !== null) return true;
      if (atCommandStart()) return false;
      const last = tokens[tokens.length - 1];
      const before = tokens[tokens.length - 2];
      const isKeyword = (t: Token | undefined, value: string): boolean => t !== undefined && keywords.has(t) && t.kind === 'word' && t.value === value;
      return !(isKeyword(last, 'for') || isKeyword(before, 'for') || isKeyword(last, 'coproc'));
    };

    /**
     * The word being read, which ends in `=` right before a `(`, is an array assignment: written as one,
     * where a command starts (after other assignments) or as an argument of the typeset family. Anywhere
     * else zsh reads the `(` as a glob group (round 20, SEC HIGH-2).
     */
    const assignsArray = (): boolean => {
      if (word.quoted || !ARRAY_NAME.test(word.text)) return false;
      let n = tokens.length;
      while (n > 0 && tokens[n - 1].kind !== 'op') n--;
      const words = tokens.slice(n).filter((t) => t.kind === 'word');
      let first = 0;
      while (first < words.length && ARRAY_PREFIXES.has(words[first].value) && writtenPlainly(words[first])) first++;
      const command = words.slice(first).find((w) => !namedPlainly(w));
      return command === undefined || (TYPESET_FAMILY.has(command.value) && writtenPlainly(command));
    };

    /**
     * zsh reads a reserved word (`typeset`, `time`, `{` …) or an assignment only when written plainly: no
     * quotes, backslashes, braces or `$` (round 21, PEN HIGH = SEC HIGH-1). A word brace expansion split has
     * no source, so it is never plain.
     */
    const writtenPlainly = (token: Token): boolean => {
      const source = SOURCES.get(token);
      if (source === undefined || token.kind !== 'word') return false;
      const raw = cmd.slice(source.start, source.end);
      return raw === token.value && (raw === '{' || !NOT_PLAIN.test(raw));
    };

    /** An assignment whose `name=` part is written plainly; its value may be quoted or expanded (round 22, CR LOW-2). */
    const namedPlainly = (token: Token): boolean => {
      const source = SOURCES.get(token);
      const name = token.kind === 'word' ? ASSIGNMENT.exec(token.value)?.[0] : undefined;
      return source !== undefined && name !== undefined && cmd.startsWith(name, source.start) && !NOT_PLAIN.test(name);
    };

    /** Follows `case … in`, its patterns and `esac`, for an unquoted word about to be added. */
    const readCaseWord = (value: string): void => {
      const top = cases[cases.length - 1];
      if (top === 'header') {
        if (value === 'in') cases[cases.length - 1] = 'pattern';
      } else if (value === 'esac' && (top === 'pattern' || (top === 'body' && atCommandStart()))) {
        cases.pop();
      } else if (value === 'case' && atCommandStart()) {
        cases.push('header');
      }
    };

    /**
     * Reads the heredoc bodies that start at `i` (right after a newline); returns the index after
     * them. An unquoted body runs its `$( … )` and backtick substitutions, as bash does, so their
     * commands go with the heredoc's redirect; a quoted one is literal text.
     */
    const skipHeredocBodies = (i: number): number => {
      for (const { delimiter, stripTabs, token, literal } of heredocs) {
        const lines: string[] = [];
        while (i < cmd.length) {
          tick();
          const end = cmd.indexOf('\n', i);
          const lineEnd = end === -1 ? cmd.length : end;
          let line = cmd.slice(i, lineEnd);
          if (stripTabs) line = line.replace(/^\t+/, '');
          i = lineEnd + 1;
          if (line === delimiter) break;
          lines.push(line);
        }
        const body = lines.join('\n');
        HEREDOC_BODIES.set(token, body);
        if (literal) continue;
        const bodyScripts = this.scriptsIn(body, depth);
        if (bodyScripts.length > 0) token.scripts = [...(token.scripts ?? []), ...bodyScripts];
      }
      heredocs.length = 0;
      return Math.min(i, cmd.length);
    };

    while (this.i < cmd.length) {
      tick();
      const i = this.i;
      const c = cmd[i];
      const next = cmd[i + 1];
      if (!word.started) wordStart = i;

      if (quote === "'") {
        if (c === "'") quote = '';
        else word.add(c);
        this.i++;
        continue;
      }

      if (quote === '"') {
        if (c === '"') {
          quote = '';
          this.i++;
        } else if (c === '\\' && next !== undefined && DOUBLE_QUOTE_ESCAPABLE.includes(next)) {
          if (next !== '\n') word.add(next);
          this.i += 2;
        } else if (c === '`') {
          word.addUnknown(this.backticks(depth, true));
        } else if (c === '$') {
          this.dollar(word, depth);
        } else {
          word.add(c);
          this.i++;
        }
        continue;
      }

      if (c === '$' && next === "'") {
        const { text, end } = readAnsiCQuote(cmd, i + 2);
        word.add(text);
        word.quoted = true;
        this.i = end;
        continue;
      }

      // `$"…"` (locale translation) reads as a plain double-quoted string.
      if (c === '$' && next === '"') {
        word.quoted = true;
        this.i++;
        continue;
      }

      if (c === "'" || c === '"') {
        quote = c;
        word.started = true;
        word.quoted = true;
        this.i++;
        continue;
      }

      if (c === '\\') {
        word.quoted = true;
        if (next === '\n') {
          this.i += 2;
        } else if (next === undefined) {
          word.add(c);
          this.i++;
        } else {
          word.add(next);
          this.i += 2;
        }
        continue;
      }

      if (c === '`') {
        word.addUnknown(this.backticks(depth, false));
        continue;
      }
      if (c === '$') {
        this.dollar(word, depth);
        continue;
      }
      if ((c === '<' || c === '>') && next === '(') {
        this.i += 2;
        word.addUnknown(this.script(depth + 1, true));
        continue;
      }
      if (c === '{' || c === ',' || c === '}') {
        word.addBrace(c);
        this.i++;
        continue;
      }
      if (c === '~' && !word.started) {
        this.tilde(word);
        continue;
      }

      if (c === '#' && !word.started && patternParens === 0) {
        const end = cmd.indexOf('\n', i);
        this.i = end === -1 ? cmd.length : end;
        continue;
      }

      if (c === ' ' || c === '\t') {
        endWord();
        this.i++;
        continue;
      }

      // `2>&1`, `>&2`: an `&` right after a redirect names another output, not a file.
      // `>& out.txt`: with a space, the next word is the target (`&out.txt`).
      if (c === '&' && pendingRedirect !== null && !word.started && i === pendingRedirectEnd) {
        word.add('&');
        this.i++;
        while (cmd[this.i] === ' ' || cmd[this.i] === '\t') this.i++;
        continue;
      }

      if (c === '(' && word.started && (word.hasWildcard() || EXTGLOB_START.test(word.glob))) {
        this.qualifier(word);
        continue;
      }
      if (c === '(' && word.started && tests === 0 && word.text.endsWith('=') && !assignsArray()) {
        throw new NeverRead(groupRefusal(cmd, i));
      }
      if (c === '(' && word.started && tests === 0 && !word.text.endsWith('=') && !(next === ')' && definesFunction())) {
        throw new NeverRead('a `(` right after a word: a zsh glob qualifier or modifier');
      }
      if (c === '(' && !word.started && globGroupHere(i)) {
        // round 19, D-R19-3 ("Refuse all groups"): zsh reads a group across newlines and ends its word at a `<`
        // or `>` (PEN HIGH-1, SEC HIGH-1); rather than follow each way, no group in the middle of a command is read
        throw new NeverRead(groupRefusal(cmd, i));
      }

      const operator = matchOperator(cmd, i);
      if (operator === undefined) {
        word.addPlain(c);
        this.i++;
        continue;
      }

      const isRedirect = REDIRECT_OPERATORS.includes(operator);
      let opText = operator;
      const digits = word.text;
      const fdPrefix =
        isRedirect && word.started && /^[0-9]+$/.test(digits) && cmd.slice(i - digits.length, i) === digits;
      if (fdPrefix) {
        opText = digits + operator;
        word = new Word();
      } else {
        endWord();
      }
      if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
      this.i += operator.length;

      if (isRedirect) {
        pendingRedirect = opText;
        pendingRedirectEnd = this.i;
        continue;
      }

      const caseTop = cases[cases.length - 1];
      if (operator === '(' && (tests > 0 || caseTop === 'pattern')) patternParens++;
      else if (operator === ')' && patternParens > 0) patternParens--;
      if (caseTop === 'pattern' && (operator === ')' || operator === '(')) {
        // `a)` / `(a)`: the parentheses of a case pattern, not a subshell or the substitution's end
        if (operator === ')') cases[cases.length - 1] = 'body';
        this.budget.takeOperator();
        tokens.push({ kind: 'op', value: operator });
        continue;
      }
      if (caseTop === 'body' && operator === ';;') cases[cases.length - 1] = 'pattern';
      if (closed && operator === ')' && parens === 0) return tokens;
      if (operator === '(') parens++;
      if (operator === ')') parens--;
      this.budget.takeOperator();
      tokens.push({ kind: 'op', value: operator });
      if (operator === '\n') this.i = skipHeredocBodies(this.i);
    }

    if (quote !== '') throw new Unreadable(`unterminated ${quote} quote`);
    endWord();
    if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
    if (closed) throw new Unreadable('unterminated substitution');
    return tokens;
  }

  /**
   * Reads a `` `…` `` substitution at `i` and returns its script. Inside it, a backslash before
   * `$`, `` ` `` or `\` (and `"` when the backticks sit in double quotes) only escapes that character.
   */
  private backticks(depth: number, inDoubleQuotes: boolean): Token[] {
    const { cmd } = this;
    const escapable = inDoubleQuotes ? '$`\\"' : '$`\\';
    let body = '';
    let j = this.i + 1;
    for (; j < cmd.length && cmd[j] !== '`'; j++) {
      tick();
      if (cmd[j] === '\\' && j + 1 < cmd.length && escapable.includes(cmd[j + 1])) j++;
      body += cmd[j];
    }
    if (j >= cmd.length) throw new Unreadable('unterminated ` substitution');
    this.i = j + 1;
    return new Scanner(body, this.home, this.budget, this.flags).script(depth + 1, false);
  }

  /**
   * The scripts of the `$( … )` and backtick substitutions in a text: an unquoted heredoc body, or
   * the inside of a `${…}` or `$((…))`. Quotes are plain text here (inside `${…}` that may read a
   * substitution bash would not run, which only adds parts to check); a backslash keeps the next
   * character from starting a substitution.
   */
  private scriptsIn(body: string, depth: number): Token[][] {
    const reader = new Scanner(body, this.home, this.budget, this.flags);
    const found = new Word();
    while (reader.i < body.length) {
      tick();
      const c = body[reader.i];
      if (c === '\\') reader.i += 2;
      else if (c === '`') found.addUnknown(reader.backticks(depth, false));
      else if (c === '$') reader.dollar(found, depth);
      else reader.i++;
    }
    return found.scripts;
  }

  /** Reads what a `$` at `i` starts: a substitution, arithmetic, a variable, or just `$`. */
  private dollar(word: Word, depth: number): void {
    const { cmd } = this;
    const i = this.i;
    const next = cmd[i + 1] ?? '';
    if (next === '(') {
      const arithmeticEnd = cmd[i + 2] === '(' ? arithmeticEndOf(cmd, i + 1) : -1;
      if (arithmeticEnd !== -1) {
        word.addUnknown();
        const body = cmd.slice(i + 3, arithmeticEnd - 2);
        if (/\$\(|`/.test(body)) this.readPast(word, body, 'arithmetic that runs a command', depth);
        this.i = arithmeticEnd;
        return;
      }
      this.i += 2;
      word.addUnknown(this.script(depth + 1, true));
      return;
    }
    if (next === '{') {
      if (cmd[i + 2] === '(') throw new NeverRead('zsh parameter flags `${(…)…}`');
      // round 15, CR MEDIUM-1: `${~X}` makes the value a pattern, `${=X}` splits it into words, `${^X}` joins it to its neighbours
      if (PARAMETER_FLAG_CHARS.has(cmd[i + 2] ?? '')) throw new NeverRead(`zsh \`\${${cmd[i + 2]}…}\` reads a value as a pattern or as several words`);
      const end = parameterEndOf(cmd, i + 2);
      const body = cmd.slice(i + 2, end);
      if (/\$\(|`/.test(body)) {
        word.addUnknown();
        this.readPast(word, body, '${…} that runs a command', depth);
      } else {
        this.variable(word, body);
      }
      this.i = end + 1;
      return;
    }
    if (NAME_START.test(next)) {
      NAME.lastIndex = i + 1;
      const name = NAME.exec(cmd)?.[0] ?? '';
      this.variable(word, name);
      this.i = i + 1 + name.length;
      return;
    }
    if (next !== '' && SPECIAL_PARAMETER.test(next)) {
      word.addUnknown();
      this.i = i + 2;
      return;
    }
    word.add('$');
    this.i++;
  }

  /**
   * Reads the `(…)` right after a pattern into its word: a zsh glob qualifier (`*(D)`, `*(.N)`) or
   * a bash extended glob (`!(x)`, `@(a|b)`). Either way the word stands for any names its start
   * allows, so its pattern ends in `*`; a qualifier may add dot entries (`D`), and one that runs
   * code (`e:…:`, `+name`) is never read. Nor is a group that never closes, or that holds an unquoted
   * newline, `<`, `>`, `&`, `;`, backtick, `$(` or comment `#` (round 20, PEN HIGH-1 = SEC HIGH-1): zsh
   * ends the word at a redirect or separator, so the rest runs as a command, and reads past newlines.
   */
  private qualifier(word: Word): void {
    const { cmd } = this;
    let depth = 0;
    let quote = '';
    let end = this.i;
    for (; end < cmd.length; end++) {
      tick();
      const c = cmd[end];
      if (quote !== '') {
        if (c === quote) quote = '';
        else if (c === '\\' && quote === '"') end++;
      } else if (c === '\\') end++;
      else if (c === "'" || c === '"') quote = c;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
      else if (GROUP_HIDES.has(c) || (c === '$' && cmd[end + 1] === '(') || (c === '#' && /[ \t]/.test(cmd[end - 1]))) break;
    }
    // round 20, PEN HIGH-1 = SEC HIGH-1: a group that never closes, or holds what ends its word or hides a command
    if (cmd[end] !== ')') {
      throw new NeverRead(`a zsh glob group holds a newline, comment, redirect or separator, or never closes; list the names instead: ${clip(cmd.slice(this.i, this.i + 61).split('\n')[0])}`);
    }
    const inside = cmd.slice(this.i + 1, end);
    if (qualifierRewrites(inside)) throw new NeverRead(`zsh reads ${clip(`(${inside})`)} after a pattern as glob qualifiers that can run a command or rewrite the names`);
    const extglob = EXTGLOB_START.test(word.glob);
    const start = extglob ? word.glob.slice(0, -1) : word.glob;
    const star = start.endsWith('*') ? '' : '*';
    word.glob = start + star;
    // round 16, CR HIGH-1: the zsh pattern keeps the `^` and `~` read before the qualifier, the same length as glob
    word.extended = (extglob ? word.extended.slice(0, -1) : word.extended) + star;
    word.text += `(${inside})`;
    word.dots ||= !extglob;
    this.i = end + 1;
  }

  /**
   * A piece read past as unknown (ADR-010): the call is flagged unreadable, and the commands the
   * piece runs go with its word, so they are still checked.
   */
  private readPast(word: Word, body: string, reason: string, depth: number): void {
    this.flags.unreadable ??= reason;
    word.scripts.push(...this.scriptsIn(body, depth));
  }

  /** `HOME` is the home folder; every other variable is unknown, never empty. */
  private variable(word: Word, name: string): void {
    if (name === 'HOME' && this.home !== undefined) word.add(this.home);
    else word.addUnknown();
  }

  /**
   * An unquoted `~name` at the start of a word: the home folder for the current user, unknown
   * for any other user. A bare `~` (and `~/…`) is left as written for the command reader.
   */
  private tilde(word: Word): void {
    const { cmd } = this;
    // `~+`, `~-`, `~N`, `~+N`, `~-N` (a folder of the shell's stack), `~[…]` (a zsh named folder), or
    // `~` before any other character: a head the gate can't know, refused bare like `$(…)` (round 14)
    STACK_TILDE.lastIndex = this.i;
    const stack = STACK_TILDE.exec(cmd)?.[0];
    const following = cmd[this.i + 1];
    if (stack !== undefined || (following !== undefined && following !== '/' && !WORD_END.has(following) && !TILDE_USER_START.test(following))) {
      const end = following === '[' ? cmd.indexOf(']', this.i) : -1;
      this.i = stack !== undefined ? this.i + stack.length : end !== -1 ? end + 1 : this.i + 1;
      word.addUnknown([]);
      return;
    }
    TILDE_USER.lastIndex = this.i + 1;
    const user = TILDE_USER.exec(cmd)?.[0];
    const after = this.i + 1 + (user?.length ?? 0);
    if (user === undefined || (after < cmd.length && cmd[after] !== '/' && !WORD_END.has(cmd[after]))) {
      word.add('~');
      this.i++;
      return;
    }
    if (this.isCurrentUser(user)) word.add(this.home ?? '');
    else word.addUnknown();
    this.i = after;
  }

  private isCurrentUser(user: string): boolean {
    if (this.home === undefined) return false;
    if (user === path.posix.basename(this.home)) return true;
    try {
      return user === os.userInfo().username;
    } catch {
      return false;
    }
  }
}

/** The refusal for a zsh glob group in the middle of a command (ADR-061), quoting the group's first line. */
function groupRefusal(cmd: string, at: number): string {
  return `zsh glob groups like \`(a|b)\` in the middle of a command aren't read by the gate; list the names instead: ${clip(cmd.slice(at, at + 61).split('\n')[0])}`;
}

/** A piece of the command quoted in a refusal: at most about 60 characters (round 18, PERF INFO-1). */
function clip(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * Where a `$((` arithmetic expansion whose first `(` is at `open` ends (the index after `))`),
 * or -1 when the parentheses don't close as `))`: then it is `$(` with a subshell inside.
 */
function arithmeticEndOf(cmd: string, open: number): number {
  let depth = 0;
  for (let j = open; j < cmd.length; j++) {
    tick();
    if (cmd[j] === '(') depth++;
    else if (cmd[j] === ')') {
      depth--;
      if (depth === 1 && cmd[j + 1] !== ')') return -1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** The index of the `}` that closes a `${` whose body starts at `start`. */
function parameterEndOf(cmd: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let j = start; j < cmd.length; j++) {
    tick();
    const c = cmd[j];
    if (quote !== '') {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"') j++;
    } else if (c === '\\') j++;
    else if (c === "'" || c === '"') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0) return j;
      depth--;
    }
  }
  throw new Unreadable('unterminated ${');
}

/**
 * Brace expansion, as bash does it: the first `{…}` holding an unquoted comma (or a short
 * `a..b` sequence) becomes one word per choice, with the text before and after it; choices and
 * the text after are expanded in turn. `braces` lists the indices of unquoted `{`, `,` and `}`.
 */
function expandBraces(text: string, braces: number[], budget: ReadBudget): string[] {
  if (braces.length === 0) return [text];
  const on = new Uint8Array(text.length);
  for (const b of braces) on[b] = 1;
  return expand(text, on, 0, budget);
}

function lengthOf(words: string[]): number {
  return words.reduce((n, w) => n + w.length, 0);
}

/** Expands one word's braces; the count and size of the result are checked before it is built. */
function expand(text: string, on: Uint8Array, depth: number, budget: ReadBudget): string[] {
  if (depth > MAX_NESTING) throw new ReadingLimit(`brace groups nested deeper than ${MAX_NESTING}`);
  const group = firstGroup(text, on);
  if (group === null) return [text];
  const { open, close, commas, sequence } = group;
  const pre = text.slice(0, open);
  let choices: string[];
  if (sequence !== null) {
    choices = sequence;
  } else {
    const cuts = [open, ...commas, close];
    choices = cuts.slice(1).flatMap((cut, n) => expand(text.slice(cuts[n] + 1, cut), on.subarray(cuts[n] + 1, cut), depth + 1, budget));
  }
  const after = expand(text.slice(close + 1), on.subarray(close + 1), depth + 1, budget);
  const count = choices.length * after.length;
  if (count > MAX_BRACE_WORDS) {
    throw new ReadingLimit(`brace expansion makes more than ${MAX_BRACE_WORDS} words`);
  }
  budget.checkChars(after.length * lengthOf(choices) + choices.length * lengthOf(after) + count * pre.length);
  return choices.flatMap((choice) => after.map((rest) => pre + choice + rest));
}

/** The first brace group that expands: its `{` and `}`, its top-level commas, or its sequence. */
function firstGroup(
  text: string,
  on: Uint8Array,
): { open: number; close: number; commas: number[]; sequence: string[] | null } | null {
  const stack: { open: number; commas: number[] }[] = [];
  let best: { open: number; close: number; commas: number[]; sequence: string[] | null } | null = null;
  for (let j = 0; j < text.length; j++) {
    tick();
    if (on[j] !== 1) continue;
    const c = text[j];
    if (c === '{') stack.push({ open: j, commas: [] });
    else if (c === ',') stack[stack.length - 1]?.commas.push(j);
    else {
      const group = stack.pop();
      if (group === undefined || (best !== null && best.open < group.open)) continue;
      const sequence = group.commas.length === 0 ? sequenceOf(text.slice(group.open + 1, j)) : null;
      if (group.commas.length > 0 || sequence !== null) best = { ...group, close: j, sequence };
    }
  }
  return best;
}

/** Bash brace sequences: `{1..10}`, `{1..10..2}`, `{a..e}` (the forms bash 4+ expands). */
const NUMBER_SEQUENCE = /^(-?[0-9]+)\.\.(-?[0-9]+)(?:\.\.(-?[0-9]+))?$/;
const LETTER_SEQUENCE = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?[0-9]+))?$/;

/** The words of `a..b` or `a..b..step` (bash 4: zero padding, letters), or null if not one or too long. */
function sequenceOf(body: string): string[] | null {
  const numbers = NUMBER_SEQUENCE.exec(body);
  const letters = numbers === null ? LETTER_SEQUENCE.exec(body) : null;
  const match = numbers ?? letters;
  if (match === null) return null;
  const from = numbers !== null ? Number(match[1]) : match[1].charCodeAt(0);
  const to = numbers !== null ? Number(match[2]) : match[2].charCodeAt(0);
  const step = Math.abs(Number(match[3] ?? '1')) || 1;
  if (Math.floor(Math.abs(to - from) / step) + 1 > MAX_SEQUENCE_ITEMS) return null;
  const padded = numbers !== null && [match[1], match[2]].some((n) => /^-?0[0-9]/.test(n));
  const size = Math.max(match[1].length, match[2].length);
  const items: string[] = [];
  const direction = to >= from ? 1 : -1;
  for (let n = from; direction > 0 ? n <= to : n >= to; n += direction * step) {
    if (letters !== null) items.push(String.fromCharCode(n));
    else if (padded) items.push(n < 0 ? `-${String(-n).padStart(size - 1, '0')}` : String(n).padStart(size, '0'));
    else items.push(String(n));
  }
  return items;
}
