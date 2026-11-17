/**
 * OSS hook environment rule (R-266 round 12, SEC LOW-A, gate side): OSS's own hook scripts
 * (`~/.oss/hooks/*`) find their files and tools through HOME and PATH, so no agent may run one with a
 * HOME or PATH it chose. Decided from the words the shell reads (round 13, CR L-a), brace expansion
 * included: a word that sets HOME, PATH or zsh's `path` (`HOME=…`, `export {PATH,ZZ}=…`, `path=(…)`), a
 * word that is exactly one of those names (`export HOME`, `read HOME`, `for PATH in`), a `${HOME:=…}`
 * or arithmetic that sets one, the same in a `-c` / `eval` script or a heredoc, or an `env` wrapper
 * (which can also clear them: `env -i`) is refused on a part that names a hook script. A comment, or a
 * word that merely holds the name (`"see HOME docs"`), is not. A name only known when it runs, given
 * to `printf -v`, `declare` and the like, a nameref (`declare -n`), or zsh's `${(P)…}` (which the
 * tokenizer never reads) may be HOME or PATH, so it counts as setting one (round 14, CR LOW-1).
 * Reported under the protected-path rule:
 * the hook folder is protected.
 */

import type { CommandPart } from '../command-reader.js';
import { expansionSet } from '../expansion-scan.js';
import { heredocBodyOf, ReadBudget, tokenize, UNKNOWN, type Token } from '../tokenize.js';
import type { Refusal } from './refusal.js';

/** A word naming a file in OSS's hook folder, as read (`~` and `$HOME` filled in, or a HOME the call set). */
const HOOK_FILE = /\/\.oss\/hooks\/[^/]/;
/** The names that move where a hook looks: HOME, PATH, and zsh's `path` array tied to PATH. */
const MOVERS = new Set(['HOME', 'PATH', 'path']);
/** A word that sets one of them, or names one for a builtin to set: `HOME=x`, `PATH+=x`, `path[1]=x`, `HOME`. */
const SETTING_WORD = /^(?:HOME|PATH|path)(?:$|\[[^\]]*\])?(?:\+?=|$)/;
/** A word that is a script the shell runs: the value after a `-c` flag or `eval`. */
const SCRIPT_FLAG = /^-[A-Za-z]*c$/;
/** Builtins that set the variable a word names (bash and zsh); a name only known when it runs could be HOME or PATH. */
const NAME_SETTERS = new Set(['declare', 'typeset', 'export', 'local', 'readonly', 'read', 'integer', 'float']);
/** Builtins whose `-n` makes a name refer to another variable (a nameref), which may be HOME or PATH. */
const NAMEREF_SETTERS = new Set(['declare', 'typeset', 'local']);
/** Words before a builtin that still run it. */
const PREFIXES = new Set(['builtin', 'command']);
/** How deep scripts in scripts are read; deeper counts as setting (fail closed). */
const MAX_DEPTH = 5;

/** True when the text, as the shell reads it, may set HOME or PATH. */
function setsMover(text: string, depth: number): boolean {
  if (depth > MAX_DEPTH || expansionSet(text, (name) => MOVERS.has(name)) !== null || arithmeticReadsVariable(text)) return true;
  const result = tokenize(text, undefined, new ReadBudget());
  if ('unreadable' in result && result.limit) return true;
  return tokensSet(result.tokens, depth);
}

/**
 * True when a simple command sets a variable through a name it doesn't write out (R-266 round 14, CR
 * LOW-1): `printf -v "$x"`, `declare "$x=…"`, `read "$x"`, or a nameref (`declare -n H=HOME`).
 */
function setsIndirectly(words: string[]): boolean {
  let p = 0;
  while (PREFIXES.has(words[p])) p++;
  const [name, ...args] = words.slice(p);
  // round 15, CR L1: `let "$x=1"`, `mapfile "$x"` / `readarray "$x"`, zsh's `set -A "$x" …` / `set +A`
  if (name === 'let') return args.some((a) => a.includes(UNKNOWN));
  // round 16: `getopts optstring name`, zsh's `zparseopts -A name` / `-a name` / `spec=name`, with a name only known when it runs
  if (name === 'getopts') return (args[1] ?? UNKNOWN).includes(UNKNOWN);
  if (name === 'zparseopts') return args.some((a) => a.includes(UNKNOWN));
  if (name === 'mapfile' || name === 'readarray') return arrayOperands(args).some((a) => a.includes(UNKNOWN));
  if (name === 'set') {
    const at = args.findIndex((a) => /^[-+][A-Za-z]*A/.test(a));
    return at !== -1 && (args[at + 1] ?? UNKNOWN).includes(UNKNOWN);
  }
  if (name === 'printf' || name === 'print') {
    return args.some((a, i) => (a === '-v' && (args[i + 1] ?? UNKNOWN).includes(UNKNOWN)) || (/^-v./.test(a) && a.includes(UNKNOWN)));
  }
  if (name === undefined || !NAME_SETTERS.has(name)) return false;
  if (NAMEREF_SETTERS.has(name) && args.some((a) => /^-[A-Za-z]*n/.test(a))) return true;
  return args.some((a) => !a.startsWith('-') && a.split('=')[0].includes(UNKNOWN));
}

/** mapfile / readarray options that take a value (bash syntax): the array name is the operand left. */
const ARRAY_VALUE_OPTIONS = new Set(['-d', '-n', '-O', '-s', '-u', '-C', '-c']);

function arrayOperands(args: string[]): string[] {
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (ARRAY_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith('-') || args[i].includes(UNKNOWN)) operands.push(args[i]);
  }
  return operands;
}

/** The text with its single-quoted pieces (outside double quotes) left out: what the shell expands. */
function unquotedText(text: string): string {
  let out = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') {
      out += text.slice(i, i + 2);
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

/**
 * True when arithmetic (`((…))`, `$((…))`, `$[…]`) reads a variable with `$` (round 15, CR L1): the value
 * can name the variable it sets (`x=HOME; (( $x = 1 ))`, `: $(( $x = 1 ))`). Brackets are matched in one
 * pass (round 16), so a `$` after an inner `)` or `]` counts too (`(( (0), $x = 1 ))`, `$[ a[0], $x = 1 ]`).
 */
function arithmeticReadsVariable(text: string): boolean {
  const shell = unquotedText(text);
  /** The brackets open, innermost last, and how many of them open arithmetic. */
  const open: boolean[] = [];
  let arithmetic = 0;
  for (let i = 0; i < shell.length; i++) {
    const c = shell[i];
    if (c === '$' && arithmetic > 0) return true;
    if ((c === '(' && shell[i + 1] === '(') || (c === '$' && shell[i + 1] === '[')) {
      // `((` closes with two brackets, the outer one ending the arithmetic; `$[` with one
      open.push(...(c === '(' ? [true, false] : [true]));
      arithmetic++;
      i++;
    } else if (c === '(' || c === '[') {
      open.push(false);
    } else if ((c === ')' || c === ']') && open.length > 0 && open.pop() === true) {
      arithmetic--;
    }
  }
  return false;
}

function tokensSet(tokens: Token[], depth: number): boolean {
  let previous: string | null = null;
  let words: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'op') {
      if (setsIndirectly(words)) return true;
      words = [];
    } else if (token.kind === 'word') {
      words.push(token.value);
    }
    if (token.kind !== 'op' && token.scripts?.some((script) => tokensSet(script, depth))) return true;
    if (token.kind === 'redirect') {
      const body = heredocBodyOf(token);
      if (body !== undefined && setsMover(body, depth + 1)) return true;
    } else if (token.kind === 'word') {
      if (SETTING_WORD.test(token.value)) return true;
      if (previous !== null && (previous === 'eval' || SCRIPT_FLAG.test(previous)) && setsMover(token.value, depth + 1)) return true;
      previous = token.value;
    } else {
      previous = null;
    }
  }
  return setsIndirectly(words);
}

export function checkOssHookEnv(part: CommandPart, command: string): Refusal | null {
  if (!part.words.some((w) => HOOK_FILE.test(w))) return null;
  if (!part.wrappers.includes('env') && !setsMover(command, 0)) return null;
  return {
    rule: 'protected-path',
    reason: 'Refused: runs an OSS hook script (`~/.oss/hooks/…`) with a HOME or PATH this command sets or changes (`HOME=`, `PATH=`, `export`, `env`). Run the hook script as it is, in a command that leaves HOME and PATH alone.',
  };
}
