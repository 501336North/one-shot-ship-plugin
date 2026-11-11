/**
 * Reads what a sed or awk script does besides reading its files (fix round 4, K2): the files it
 * writes, the commands it runs, and whether it runs or writes something only known when it runs.
 * The script is the program's own text (`-e`, `--expression`, `--source`, or the first operand);
 * a script read from a file (`-f`) is not read, like an interpreter's script file.
 *
 * sed (GNU sed manual): `w`/`W file` and the `w file` flag of `s` write a file (the name runs to
 * the end of the line); `e command` runs a command, and `e` alone or the `e` flag of `s` runs the
 * pattern space. awk (POSIX, gawk): `print > "file"` / `>> "file"` writes, `system("cmd")`,
 * `print | "cmd"` and `"cmd" | getline` run a command; `@include`, `@load`, `-i`, `-l` load a
 * library (gawk's `inplace` edits the files in place).
 */

import { UNKNOWN } from './tokenize.js';

export interface ScriptFacts {
  /** Files the script writes, as written (relative to the folder it runs in). */
  writes: string[];
  /** Shell commands the script runs, as written. */
  commands: string[];
  /** Why the script runs or writes something the gate can't read; null when it doesn't. */
  unreadable: string | null;
  /**
   * Why part of the script itself is only known when it runs (a shell variable or substitution in
   * it, fix round 4, K3); null when it is all literal. Unlike `unreadable`, this alone doesn't make
   * the call risky (ADR-010, user decision).
   */
  dynamic: string | null;
}

export interface AwkFacts extends ScriptFacts {
  /** The awk loads a library (`-i`, `-l`, `@include`, `@load`), which may edit its files in place. */
  loads: boolean;
}

/** True when `word` is a long option GNU getopt reads as `full` (any unambiguous prefix, `--in` for `--in-place`). */
export function longOption(word: string, full: string, shortest: number): boolean {
  const flag = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
  return flag.length >= shortest && full.startsWith(flag);
}

/** sed options whose value is the next word (or the rest of the cluster); `-i`/`-I` take only an attached suffix (GNU). */
const SED_SCRIPT_LETTERS = new Set(['e']);
const SED_FILE_LETTERS = new Set(['f']);
const SED_VALUE_LETTERS = new Set(['l']);
const SED_LONG: { full: string; shortest: number; kind: 'script' | 'file' | 'value' }[] = [
  { full: '--expression', shortest: 3, kind: 'script' },
  { full: '--file', shortest: 4, kind: 'file' },
  { full: '--line-length', shortest: 4, kind: 'value' },
];

/** The scripts a sed's words give it: from `-e`/`--expression`, else its first operand (and, after a bare `-i`, its second, as BSD sed reads `-i ''`). */
function sedScripts(args: string[]): { scripts: string[]; alternates: string[]; fromFile: boolean } {
  const scripts: string[] = [];
  const operands: string[] = [];
  let fromFile = false;
  let bareInPlace = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const long = SED_LONG.find((o) => longOption(a, o.full, o.shortest));
      if (long === undefined) continue;
      const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[++i];
      if (long.kind === 'script' && value !== undefined) scripts.push(value);
      if (long.kind === 'file') fromFile = true;
    } else if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const letter = a[j];
        if ((letter === 'i' || letter === 'I') && j === a.length - 1) bareInPlace = true;
        if (letter === 'i' || letter === 'I') break;
        if (SED_SCRIPT_LETTERS.has(letter) || SED_FILE_LETTERS.has(letter) || SED_VALUE_LETTERS.has(letter)) {
          const value = j < a.length - 1 ? a.slice(j + 1) : args[++i];
          if (SED_SCRIPT_LETTERS.has(letter) && value !== undefined) scripts.push(value);
          if (SED_FILE_LETTERS.has(letter)) fromFile = true;
          break;
        }
      }
    } else {
      operands.push(a);
    }
  }
  if (scripts.length > 0 || fromFile) return { scripts, alternates: [], fromFile };
  return { scripts: operands.slice(0, 1), alternates: bareInPlace ? operands.slice(1, 2) : [], fromFile };
}

/** sed commands that take no argument (GNU sed). */
const SED_PLAIN = new Set(['=', 'd', 'D', 'g', 'G', 'h', 'H', 'n', 'N', 'p', 'P', 'x', 'z', 'F', '{', '}']);
/** sed commands whose argument runs to the end of the line: text, a file read, a label (GNU sed). */
const SED_TO_LINE_END = new Set(['a', 'i', 'c', 'r', 'R']);
const SED_LABEL = new Set([':', 'b', 't', 'T', 'v']);
const SED_NUMBER = new Set(['q', 'Q', 'l', 'L']);
/** Flags of the `s` command other than `w` and `e` (GNU sed). */
const S_FLAGS = /[gpiImM0-9]/;

class SedReader {
  i = 0;

  constructor(
    private readonly s: string,
    private readonly facts: ScriptFacts,
  ) {}

  private blank(): void {
    while (this.s[this.i] === ' ' || this.s[this.i] === '\t') this.i++;
  }

  private toLineEnd(): string {
    const end = this.s.indexOf('\n', this.i);
    const text = this.s.slice(this.i, end === -1 ? this.s.length : end);
    this.i = end === -1 ? this.s.length : end;
    return text;
  }

  /** Skips to past the next unescaped `d`; false when there is none. */
  private past(d: string): boolean {
    while (this.i < this.s.length && this.s[this.i] !== d) {
      if (this.s[this.i] === '\\') this.i++;
      this.i++;
    }
    if (this.i >= this.s.length) return false;
    this.i++;
    return true;
  }

  private address(): boolean {
    const c = this.s[this.i];
    if (c === '/') {
      this.i++;
      this.past('/');
    } else if (c === '\\') {
      const d = this.s[this.i + 1];
      this.i += 2;
      if (d !== undefined) this.past(d);
    } else if (c !== undefined && /[0-9$]/.test(c)) {
      while (this.i < this.s.length && /[0-9$~]/.test(this.s[this.i])) this.i++;
    } else {
      return false;
    }
    while (this.s[this.i] === 'I' || this.s[this.i] === 'M') this.i++;
    return true;
  }

  private ranges(): void {
    if (!this.address()) return;
    this.blank();
    if (this.s[this.i] !== ',') return;
    this.i++;
    this.blank();
    if (this.s[this.i] === '+' || this.s[this.i] === '~') {
      this.i++;
      while (/[0-9]/.test(this.s[this.i] ?? '')) this.i++;
    } else {
      this.address();
    }
  }

  private substitute(): void {
    const d = this.s[this.i++];
    if (d === undefined || !this.past(d) || !this.past(d)) {
      if (this.s.includes(UNKNOWN)) this.facts.dynamic ??= DYNAMIC_SED;
      else this.facts.unreadable ??= 'a sed `s` command the gate cannot read';
      this.i = this.s.length;
      return;
    }
    for (;;) {
      const f = this.s[this.i];
      if (f === 'w') {
        this.i++;
        this.facts.writes.push(this.toLineEnd().trim());
        return;
      }
      if (f === 'e') {
        this.facts.unreadable ??= 'the sed `s///e` flag runs the text as a command';
        this.i++;
      } else if (f !== undefined && S_FLAGS.test(f)) {
        this.i++;
      } else {
        return;
      }
    }
  }

  read(): void {
    const { s } = this;
    while (this.i < s.length) {
      while (this.i < s.length && /[\s;]/.test(s[this.i])) this.i++;
      if (this.i >= s.length) return;
      if (s[this.i] === '#') {
        this.toLineEnd();
        continue;
      }
      this.ranges();
      this.blank();
      while (s[this.i] === '!') {
        this.i++;
        this.blank();
      }
      const c = s[this.i++];
      if (c === undefined) return;
      if (SED_PLAIN.has(c)) continue;
      if (c === 'w' || c === 'W') this.facts.writes.push(this.toLineEnd().trim());
      else if (c === 'e') {
        const command = this.toLineEnd().trim();
        if (command === '') this.facts.unreadable ??= 'the sed `e` command runs the text as a command';
        else if (command.includes(UNKNOWN)) this.facts.unreadable ??= 'the sed `e` command runs a command only known when it runs';
        else this.facts.commands.push(command);
      } else if (SED_TO_LINE_END.has(c)) this.toLineEnd();
      else if (SED_LABEL.has(c)) while (this.i < s.length && s[this.i] !== ';' && s[this.i] !== '\n') this.i++;
      else if (SED_NUMBER.has(c)) {
        this.blank();
        while (/[0-9]/.test(s[this.i] ?? '')) this.i++;
      } else if (c === 's') this.substitute();
      else if (c === 'y') {
        const d = s[this.i++];
        if (d === undefined || !this.past(d) || !this.past(d)) {
          if (s.includes(UNKNOWN)) this.facts.dynamic ??= DYNAMIC_SED;
          else this.facts.unreadable ??= 'a sed `y` command the gate cannot read';
        }
      } else if (s.startsWith(UNKNOWN, this.i - 1)) {
        // the rest of the script is only known when it runs
        this.facts.dynamic ??= DYNAMIC_SED;
        return;
      } else {
        this.facts.unreadable ??= `a sed command (\`${c}\`) the gate doesn't know`;
        return;
      }
    }
  }
}

const DYNAMIC_SED = 'a sed script holds text only known when it runs';
const DYNAMIC_AWK = 'an awk script holds text only known when it runs';

function readSed(script: string): ScriptFacts {
  const facts: ScriptFacts = { writes: [], commands: [], unreadable: null, dynamic: null };
  new SedReader(script, facts).read();
  if (script.includes(UNKNOWN)) facts.dynamic ??= DYNAMIC_SED;
  return facts;
}

/** What a sed with these words writes and runs from its script. */
export function sedFacts(args: string[]): ScriptFacts {
  const { scripts, alternates } = sedScripts(args);
  const facts: ScriptFacts = { writes: [], commands: [], unreadable: null, dynamic: null };
  const merge = (read: ScriptFacts): void => {
    facts.writes.push(...read.writes);
    facts.commands.push(...read.commands);
    facts.unreadable ??= read.unreadable;
    facts.dynamic ??= read.dynamic;
  };
  scripts.forEach((script) => merge(readSed(script)));
  // `sed -i '' script f` (BSD): the second word may be the script; counted only when it reads as one
  for (const alternate of alternates) {
    const read = readSed(alternate);
    if (read.unreadable === null && read.dynamic === null) merge(read);
  }
  return facts;
}

/** awk options whose value is the next word unless attached (`-F:`, `-vx=1`), POSIX and gawk. */
const AWK_VALUE_LETTERS = new Set(['F', 'v', 'W']);
const AWK_FILE_LETTERS = new Set(['f', 'E']);
const AWK_LOAD_LETTERS = new Set(['i', 'l']);
const AWK_SOURCE_LETTERS = new Set(['e']);
const AWK_LONG: { full: string; shortest: number; kind: 'value' | 'file' | 'load' | 'source' }[] = [
  { full: '--field-separator', shortest: 3, kind: 'value' },
  { full: '--assign', shortest: 3, kind: 'value' },
  { full: '--file', shortest: 4, kind: 'file' },
  { full: '--exec', shortest: 4, kind: 'file' },
  { full: '--include', shortest: 3, kind: 'load' },
  { full: '--load', shortest: 4, kind: 'load' },
  { full: '--source', shortest: 4, kind: 'source' },
];
/** `@include` / `@load` in a gawk script. */
const AWK_DIRECTIVE = /@(?:include|load)\b/;

/** The awk scripts its words give it, and whether it loads a library. */
function awkScripts(args: string[]): { scripts: string[]; loads: boolean; fromFile: boolean } {
  const scripts: string[] = [];
  let fromFile = false;
  let loads = false;
  let operand: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operand = args[i + 1];
      break;
    }
    if (a.startsWith('--')) {
      const long = AWK_LONG.find((o) => longOption(a, o.full, o.shortest));
      if (long === undefined) continue;
      const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[++i];
      if (long.kind === 'file') fromFile = true;
      if (long.kind === 'load') loads = true;
      if (long.kind === 'source' && value !== undefined) scripts.push(value);
    } else if (a.startsWith('-') && a.length > 1) {
      const letter = a[1];
      const takes = AWK_VALUE_LETTERS.has(letter) || AWK_FILE_LETTERS.has(letter) || AWK_LOAD_LETTERS.has(letter) || AWK_SOURCE_LETTERS.has(letter);
      const value = takes ? (a.length > 2 ? a.slice(2) : args[++i]) : undefined;
      if (AWK_FILE_LETTERS.has(letter)) fromFile = true;
      if (AWK_LOAD_LETTERS.has(letter)) loads = true;
      if (AWK_SOURCE_LETTERS.has(letter) && value !== undefined) scripts.push(value);
    } else {
      operand = a;
      break;
    }
  }
  if (scripts.length === 0 && !fromFile && operand !== undefined) scripts.push(operand);
  return { scripts, loads: loads || scripts.some((s) => AWK_DIRECTIVE.test(s)), fromFile };
}

type AwkToken = { kind: 'str'; text: string } | { kind: 'word'; text: string } | { kind: 'op'; text: string };

/** awk's tokens, enough to find redirects, pipes and `system`: strings, names, and operators; regexes are skipped. */
function awkTokens(s: string): AwkToken[] {
  const tokens: AwkToken[] = [];
  /** A `/` starts a regex unless it follows an operand (a name, number, string, `)` or `]`). */
  const afterOperand = (): boolean => {
    const last = tokens[tokens.length - 1];
    return last !== undefined && (last.kind !== 'op' || last.text === ')' || last.text === ']');
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c) && c !== '\n') {
      i++;
    } else if (c === '#') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '"') {
      let text = '';
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && i + 1 < s.length) i++;
        text += s[i];
      }
      i++;
      tokens.push({ kind: 'str', text });
    } else if (c === '/' && !afterOperand()) {
      for (i++; i < s.length && s[i] !== '/'; i++) if (s[i] === '\\') i++;
      i++;
      tokens.push({ kind: 'word', text: '/regex/' });
    } else if (/[A-Za-z0-9_$.]/.test(c)) {
      const start = i;
      while (i < s.length && /[A-Za-z0-9_$.]/.test(s[i])) i++;
      tokens.push({ kind: 'word', text: s.slice(start, i) });
    } else {
      const two = s.slice(i, i + 2);
      const op = ['>>', '||', '|&', '>=', '&&', '==', '!=', '<='].includes(two) ? two : c;
      i += op.length;
      tokens.push({ kind: 'op', text: op });
    }
  }
  return tokens;
}

/**
 * Programs that run what they read on stdin (shells, interpreters) or take it as their arguments
 * (`xargs`): fed awk's printed output through `print | "cmd"`, they run text the gate can't read
 * (fix round 4, K8). Matched against every word of the command, so `env sh`, `/bin/sh`, `bash -s` count.
 */
const STDIN_RUNNERS = /^(?:(?:ba|z|da|k|fi|c|tc)?sh|python[0-9.]*|node|perl|ruby|php|osascript|expect|tclsh|deno|bun|lua|xargs|eval|source)$/;

/** True when a piped command runs awk's output as a script or as arguments. */
function runsItsInput(command: string): boolean {
  return command.split(/\s+/).some((word) => STDIN_RUNNERS.test(word.slice(word.lastIndexOf('/') + 1)));
}

/** Ends a print statement (at its own paren depth). */
const STATEMENT_END = new Set([';', '\n', '}', '{']);

function readAwk(script: string, facts: ScriptFacts): void {
  const tokens = awkTokens(script);
  /** The paren depth a `print`/`printf` statement started at, while in one. */
  let printDepth: number | null = null;
  let depth = 0;
  tokens.forEach((t, n) => {
    const next = tokens[n + 1];
    const prev = tokens[n - 1];
    if (t.kind === 'word' && (t.text === 'print' || t.text === 'printf')) printDepth = depth;
    if (t.kind === 'word' && t.text === 'system' && next?.kind === 'op' && next.text === '(') {
      const arg = tokens[n + 2];
      if (arg?.kind === 'str' && tokens[n + 3]?.text === ')' && !arg.text.includes(UNKNOWN)) facts.commands.push(arg.text);
      else facts.unreadable ??= 'awk `system()` runs a command the gate cannot read';
    }
    if (t.kind !== 'op') return;
    if (t.text === '(') depth++;
    else if (t.text === ')') depth--;
    else if (STATEMENT_END.has(t.text) && depth === printDepth) printDepth = null;
    else if (t.text === '|' || t.text === '|&') {
      if (next?.kind === 'str' && printDepth !== null && runsItsInput(next.text)) facts.unreadable ??= `awk prints into \`${next.text}\`, which runs what awk prints`;
      if (next?.kind === 'str' && !next.text.includes(UNKNOWN)) facts.commands.push(next.text);
      else if (prev?.kind === 'str' && !prev.text.includes(UNKNOWN) && next?.kind === 'word' && next.text === 'getline') facts.commands.push(prev.text);
      else facts.unreadable ??= 'an awk pipe runs a command the gate cannot read';
    } else if ((t.text === '>' || t.text === '>>') && printDepth !== null && depth === printDepth) {
      if (next?.kind === 'str') facts.writes.push(next.text);
      else facts.unreadable ??= 'an awk `print >` writes a file the gate cannot read';
    }
  });
}

/** What an awk with these words writes and runs from its script, and whether it loads a library. */
export function awkFacts(args: string[]): AwkFacts {
  const { scripts, loads } = awkScripts(args);
  const facts: AwkFacts = { writes: [], commands: [], unreadable: null, dynamic: null, loads };
  for (const script of scripts) {
    readAwk(script, facts);
    if (script.includes(UNKNOWN)) facts.dynamic ??= DYNAMIC_AWK;
  }
  return facts;
}

/** The sed and awk programs (GNU, BSD, mawk, nawk). */
const SED_NAMES = new Set(['sed', 'gsed']);
const AWK_NAMES = new Set(['awk', 'gawk', 'mawk', 'nawk']);

/**
 * True when a sed or awk runs a script read from a file (`sed -f`, `awk -f|-E|--exec`): text the gate
 * doesn't read, which can write or edit its operands in place (gawk `@include "inplace"`), K8.
 */
export function runsScriptFile(name: string, args: string[]): boolean {
  if (SED_NAMES.has(name)) return sedScripts(args).fromFile;
  return AWK_NAMES.has(name) && awkScripts(args).fromFile;
}

/** What the script of a sed or awk with these words writes and runs; null for any other program. */
export function scriptFactsOf(name: string | null, args: string[]): ScriptFacts | null {
  if (name === null) return null;
  if (SED_NAMES.has(name)) return sedFacts(args);
  return AWK_NAMES.has(name) ? awkFacts(args) : null;
}
