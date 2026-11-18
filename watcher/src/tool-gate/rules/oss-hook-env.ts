/**
 * OSS hook environment rule (R-266 round 12, SEC LOW-A, gate side): OSS's own hook scripts find their
 * files and tools through HOME and PATH, and their shell and tools read variables such as BASH_ENV,
 * NODE_OPTIONS or GIT_DIR, so no agent may run one with a variable it chose. A call that runs a hook
 * script may set only HOOK_CALL_VARIABLES, the names OSS's served commands set there (hook-env-refs
 * Task 2, pinned to the served fixture by a test); HOME, PATH and zsh's `path` are never on it.
 * Hook scripts live in `~/.oss/hooks/*`, the plugin cache (`~/.claude/plugins/cache/<marketplace>/oss/<version>/hooks/*`),
 * a `--plugin-dir` copy or plugin checkout (any `…/hooks/oss-*.sh`), and `$CLAUDE_PLUGIN_ROOT/hooks/*`
 * (or `${CLAUDE_PLUGIN_ROOT}`) as written (hook-env-refs Task 1); a non-OSS `hooks/` script is not one.
 * Decided from the words the shell reads (round 13, CR L-a), brace expansion included, on the whole
 * command when a part names a hook script: an assignment (`X=…`, `X+=…`, `X[i]=…`, before a program or
 * alone), an operand of `export`, `declare`, `local`, `readonly`, `read`, `let`, `env` and the like, a
 * `for` / `select` variable, a `${X:=…}` or arithmetic that sets one, the same in a `-c` / `eval` script
 * or a heredoc, or an `env` wrapper (which can also clear them: `env -i`) is refused when the name is not
 * on the list. A word that is exactly HOME, PATH or `path` anywhere (`printf -v HOME`) counts as setting
 * it. A comment, or a word that merely holds a name (`"see HOME docs"`), is not; `unset X` is allowed. A
 * name only known when it runs, given to `printf -v`, `declare` and the like, a nameref (`declare -n`),
 * or zsh's `${(P)…}` (which the tokenizer never reads) may be any name, so it counts as setting a refused
 * one (round 14, CR LOW-1). Reported under the protected-path rule: the hook folder is protected.
 */

import { sourcesFor, trustedSourceWord, type CommandPart, type TrustedSources } from '../command-reader.js';
import { expansionSet } from '../expansion-scan.js';
import { heredocBodyOf, ReadBudget, sourceOf, tokenize, UNKNOWN, type Token } from '../tokenize.js';
import type { Refusal } from './refusal.js';

/** A word naming a file in OSS's hook folder, as read (`~` and `$HOME` filled in, or a HOME the call set). */
const HOOK_FILE =
  /\/\.oss\/hooks\/[^/]|\/\.claude\/plugins\/cache\/[^/]+\/oss\/[^/]+\/hooks\/[^/]|(?:^|\/)hooks\/oss-[^/]*\.sh$/;
/** `$CLAUDE_PLUGIN_ROOT/hooks/<file>` as written: the reader leaves the variable unknown, so it is read from the command. */
const PLUGIN_HOOK = /\$\{?CLAUDE_PLUGIN_ROOT\}?\/hooks\/[^/]/;
/** The names that move where a hook looks: HOME, PATH, and zsh's `path` array tied to PATH. */
const MOVERS = new Set(['HOME', 'PATH', 'path']);
/** The variables a command may set on a hook call: exactly those OSS's served commands set there (a test pins them to the served fixture). */
export const HOOK_CALL_VARIABLES: ReadonlySet<string> = new Set([
  'CLAUDE_PROJECT_DIR', 'CREDS', 'HAS_PLAYWRIGHT', 'OSS_DIR', 'OSS_ICON_PNG', 'PLAYWRIGHT_RESULT', 'PLIST_PATH',
  'PLUGIN_ROOT', 'SCRIPT_DIR', 'SETTINGS_FILE', 'SOUND', 'STATUSLINE_SCRIPT', 'STYLE', 'V', 'VERBOSITY', 'VERIFY',
  'VOICE', 'WHY', 'd', 'encoding', 'o', 'top', 'version', 'w',
]);
/** A word that assigns a variable: `X=…`, `X+=…`, `X[i]=…`. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=/;
/** A variable name. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Words that may start a simple command before its assignments. */
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '{', '!', 'time']);
/** A word that sets one of them, or names one for a builtin to set: `HOME=x`, `PATH+=x`, `path[1]=x`, `HOME`. */
const SETTING_WORD = /^(?:HOME|PATH|path)(?:$|\[[^\]]*\])?(?:\+?=|$)/;
/** A word that is a script the shell runs: the value after a `-c` flag or `eval`. */
const SCRIPT_FLAG = /^-[A-Za-z]*c$/;
/** Builtins that set the variable a word names (bash and zsh); a name only known when it runs could be HOME or PATH. */
const NAME_SETTERS = new Set(['declare', 'typeset', 'export', 'local', 'readonly', 'read', 'integer', 'float']);
/** Builtins whose `-n` makes a name refer to another variable (a nameref), which may be HOME or PATH. */
const NAMEREF_SETTERS = new Set(['declare', 'typeset', 'local']);
/** Programs that set the variables their operands name (`let X=1`, `env X=1 …`), the name setters included. */
const OPERAND_SETTERS = new Set([...NAME_SETTERS, 'let', 'env']);
/** Words before a builtin that still run it. */
const PREFIXES = new Set(['builtin', 'command']);
/** How deep scripts in scripts are read; deeper counts as setting (fail closed). */
const MAX_DEPTH = 5;

/** True when the text, as the shell reads it, may set HOME or PATH or a variable not on the hook-call list. */
/** The call's home and the files a `source` / `.` may run (OSS's own hook files). */
interface Call {
  home: string;
  sources: TrustedSources;
}

function setsRefusedVariable(text: string, depth: number, call: Call): boolean {
  if (depth > MAX_DEPTH || expansionSet(text, (name) => !HOOK_CALL_VARIABLES.has(name)) !== null || arithmeticReadsVariable(text)) return true;
  const result = tokenize(text, call.home, new ReadBudget());
  if ('unreadable' in result && result.limit) return true;
  return tokensSet(result.tokens, depth, call, text);
}

/** True when a sourced word is a file directly in ~/.oss/hooks, written out in full: no variable, pattern or `.` / `..` part. */
function sourcesOssHook(word: string | undefined, home: string): boolean {
  if (word === undefined || word.includes(UNKNOWN) || /[*?[]/.test(word) || word.split('/').some((p) => p === '.' || p === '..')) return false;
  const name = word.startsWith('~/.oss/hooks/') ? word.slice('~/.oss/hooks/'.length) : word.startsWith(`${home}/.oss/hooks/`) ? word.slice(`${home}/.oss/hooks/`.length) : '';
  return name !== '' && !name.includes('/');
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

/** True when a simple command sets a variable it names that is not on the hook-call list: an assignment, a setter's operand, a `for` variable. */
function setsUnlisted(words: string[]): boolean {
  let p = 0;
  while (RESERVED.has(words[p])) p++;
  const names: string[] = [];
  while (p < words.length && ASSIGNMENT.test(words[p])) names.push(words[p++]);
  while (PREFIXES.has(words[p])) p++;
  const [name, ...args] = words.slice(p);
  if (name === 'for' || name === 'select') names.push(args[0] ?? '');
  else if (name !== undefined && OPERAND_SETTERS.has(name)) names.push(...args.filter((a) => !a.startsWith('-')));
  return names.some((word) => {
    const variable = word.split(/[=[+]/)[0];
    return VARIABLE_NAME.test(variable) && !HOOK_CALL_VARIABLES.has(variable);
  });
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

/** True when a simple command sets variables from elsewhere: a sourced file, keyword words (`set -k`), a function trace (`set -T`), a trap body. */
function setsFromElsewhere(words: string[], depth: number, call: Call, raws: Array<string | undefined>): boolean {
  let p = 0;
  while (RESERVED.has(words[p])) p++;
  while (p < words.length && ASSIGNMENT.test(words[p])) p++;
  while (PREFIXES.has(words[p])) p++;
  const [name, ...args] = words.slice(p);
  if (name === 'source' || name === '.') {
    return !sourcesOssHook(args[0], call.home) && !(args[0] !== undefined && trustedSourceWord(args[0], raws[p + 1], call.home, call.sources));
  }
  if (name === 'set') return args.some((a, i) => /^-[A-Za-z]*[kT]/.test(a) || (a === '-o' && (args[i + 1] === 'keyword' || args[i + 1] === 'functrace')));
  if (name === 'trap') return args.some((a) => !a.startsWith('-') && setsRefusedVariable(a, depth + 1, call));
  return false;
}

/** `text`: what the tokens were read from, so a word's raw text is known; a script inside a word has none. */
function tokensSet(tokens: Token[], depth: number, call: Call, text?: string): boolean {
  let previous: string | null = null;
  let words: string[] = [];
  let raws: Array<string | undefined> = [];
  for (const token of tokens) {
    if (token.kind === 'op') {
      if (setsIndirectly(words) || setsUnlisted(words) || setsFromElsewhere(words, depth, call, raws)) return true;
      words = [];
      raws = [];
    } else if (token.kind === 'word') {
      words.push(token.value);
      const at = sourceOf(token);
      raws.push(text === undefined || at === undefined ? undefined : text.slice(at.start, at.end));
    }
    if (token.kind !== 'op' && token.scripts?.some((script) => tokensSet(script, depth, call))) return true;
    if (token.kind === 'redirect') {
      const body = heredocBodyOf(token);
      if (body !== undefined && setsRefusedVariable(body, depth + 1, call)) return true;
    } else if (token.kind === 'word') {
      if (SETTING_WORD.test(token.value)) return true;
      if (previous !== null && (previous === 'eval' || SCRIPT_FLAG.test(previous)) && setsRefusedVariable(token.value, depth + 1, call)) return true;
      previous = token.value;
    } else {
      previous = null;
    }
  }
  return setsIndirectly(words) || setsUnlisted(words) || setsFromElsewhere(words, depth, call, raws);
}

export function checkOssHookEnv(part: CommandPart, command: string, home: string, sources: TrustedSources): Refusal | null {
  if (!part.words.some((w) => HOOK_FILE.test(w)) && !PLUGIN_HOOK.test(command)) return null;
  const clears = part.wrappers.some((w, i) => w === 'env' || (w === 'exec' && part.wrapperOptions[i].some((o) => /^-[A-Za-z]*c/.test(o))));
  if (!clears && !setsRefusedVariable(command, 0, { home, sources: sourcesFor(command, sources) })) return null;
  return {
    rule: 'protected-path',
    reason: 'Refused: runs an OSS hook script (`~/.oss/hooks/…`) with a HOME or PATH, or another variable, this command sets or changes (`X=`, `export`, `env`) that is not on the list of variables OSS\'s own commands set on a hook call. Run the hook script as it is, in a command that sets no other variable.',
  };
}
