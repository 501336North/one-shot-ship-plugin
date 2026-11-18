/**
 * OSS hook environment rule (R-266 round 12, SEC LOW-A, gate side): OSS's own hook scripts find their
 * files and tools through HOME and PATH, and their shell and tools read variables such as BASH_ENV,
 * NODE_OPTIONS or GIT_DIR, so no agent may run one with a variable it chose. A call that runs a hook
 * script may set only HOOK_CALL_VARIABLES, the names OSS's served commands set there (hook-env-refs
 * Task 2, pinned to the served fixture by a test); HOME, PATH and zsh's `path` are never on it.
 * Hook scripts live in `~/.oss/hooks/*`, the plugin cache (any `~/.claude/plugins/cache/…/hooks/*`),
 * a `--plugin-dir` copy (any `…/hooks/oss-*.sh`), a plugin checkout (any `hooks/*` below a folder that holds
 * `.claude-plugin/plugin.json`, looked up on disk from the call's cwd), and `$CLAUDE_PLUGIN_ROOT/hooks/*`
 * (or `${CLAUDE_PLUGIN_ROOT}`) as written (hook-env-refs Tasks 1 and 7), in any case; a glob word that
 * could expand to one counts as one. Another repo's `hooks/` script is not one. A relative word is read
 * from the part's cwd, and a variable's value that names one counts too (Task 10).
 * Decided from the words the shell reads (round 13, CR L-a), brace expansion included, on the whole
 * command when a part names a hook script: an assignment (`X=…`, `X+=…`, `X[i]=…`, before a program or
 * alone), an operand of `export`, `declare`, `local`, `readonly`, `read`, `let`, `env` and the like, a
 * `for` / `select` variable, a `${X:=…}` or arithmetic that sets one, the same in a `-c` / `eval` script
 * or a heredoc, or an `env` wrapper (which can also clear them: `env -i`) is refused when the name is not
 * on the list. A word that is exactly HOME, PATH or `path` anywhere (`printf -v HOME`) counts as setting
 * it. A comment, or a word that merely holds a name (`"see HOME docs"`), is not; `unset X` is allowed. A
 * name only known when it runs, given to `printf -v`, `declare` and the like, a nameref (`declare -n`),
 * or zsh's `${(P)…}` (which the tokenizer never reads) may be any name, so it counts as setting a refused
 * one (round 14, CR LOW-1). Variables set from elsewhere count too (hook-env-refs Task 6): a `source` /
 * `.` (so `set -a` too), unless its file is written out in full directly in `~/.oss/hooks` or is one the
 * reader already trusts (`trustedSourceWord`); `set -k` / `-o keyword` and `set -T` / `-o functrace`; a
 * trap body, read like an eval script; and `exec -c`, read like `env -i`. `set -a` / `-o allexport` and
 * any function definition are refused too (Task 9); a lower-case plain variable, never exported, is not.
 * So are `alias`, `enable`, `disable`, a `hash` that sets a path, a key set in a zsh command map
 * (`aliases[x]=…`, `options[…]`), allexport in any spelling (`setopt ALL_EXPORT`, `shopt -os allexport`),
 * and a zsh array tied to an exported variable (`manpath`, `fpath`, …) (Task 13).
 * Reported under the
 * protected-path rule: the hook folder is protected.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sourcesFor, trustedSourceWord, type CommandPart, type TrustedSources } from '../command-reader.js';
import { expansionSet } from '../expansion-scan.js';
import { heredocBodyOf, ReadBudget, sourceOf, tokenize, UNKNOWN, type Token } from '../tokenize.js';
import type { Refusal } from './refusal.js';

/** A word naming a hook script, in any case, as read (`~` and `$HOME` filled in, or a HOME the call set). */
const HOOK_FILE =
  /\/\.oss\/hooks\/[^/]|\/\.claude\/plugins\/cache\/.*\/hooks\/[^/]|(?:^|\/)hooks\/oss-[^/]*\.sh$/i;
/** A `hooks/<file>` part of a path, in any case. */
const HOOKS_PART = /(?:^|\/)hooks\/[^/]/i;
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
/** A name the agent's environment may already export, so a plain assignment reaches a child: upper case, or a `*_proxy` name. */
const MAYBE_EXPORTED = /[A-Z]|_proxy$|^(?:manpath|fpath|cdpath|module_path|mailpath|psvar|fignore)$/;
/** zsh's special maps: setting a key redirects a command name, function, builtin or option (hook-env-refs Task 13). */
const COMMAND_MAPS = /^(?:dis_)?(?:aliases|galiases|saliases|functions|commands|builtins|options)$/;
/** An option name as the shell matches it: any case, `_` ignored. */
function optionName(word: string | undefined): string {
  return (word ?? '').toLowerCase().replace(/_/g, '');
}
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

/** The variable a setting word names: `X` in `X=1`, `X+=1`, `X[0]=1`. */
function variableOf(word: string): string {
  return word.split(/[=[+]/)[0];
}

/**
 * True when a simple command sets a variable it names that is not on the hook-call list: a prefix
 * assignment, a setter's operand (`printf -v`, `mapfile`, `getopts` included). A plain assignment or
 * loop variable is not exported (hook-env-refs Task 9), so it reaches the hook only when the agent's
 * environment may already export the name: an upper-case or `*_proxy` name.
 */
function setsUnlisted(words: string[]): boolean {
  let p = 0;
  while (RESERVED.has(words[p])) p++;
  const assigned: string[] = [];
  while (p < words.length && ASSIGNMENT.test(words[p])) assigned.push(words[p++]);
  while (PREFIXES.has(words[p])) p++;
  const [name, ...args] = words.slice(p);
  if (name === undefined || name === 'for' || name === 'select') {
    const plain = name === undefined ? assigned : [...assigned, args[0] ?? ''];
    return plain.some((w) => (MAYBE_EXPORTED.test(variableOf(w)) || COMMAND_MAPS.test(variableOf(w))) && unlisted(w));
  }
  const names = [...assigned];
  if (OPERAND_SETTERS.has(name)) names.push(...args.filter((a) => !a.startsWith('-')));
  else if (name === 'printf' || name === 'print') args.forEach((a, i) => (a === '-v' ? names.push(args[i + 1] ?? '') : /^-v./.test(a) && names.push(a.slice(2))));
  else if (name === 'mapfile' || name === 'readarray') names.push(...arrayOperands(args));
  else if (name === 'getopts') names.push(args[1] ?? '');
  return names.some(unlisted);
}

/** True when a setting word names a variable not on the hook-call list. */
function unlisted(word: string): boolean {
  const variable = variableOf(word);
  return VARIABLE_NAME.test(variable) && !HOOK_CALL_VARIABLES.has(variable);
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
  // hook-env-refs Task 9: `set -a` / `-o allexport` exports every later assignment; a function can stand in for a program the hook runs
  if (name === 'function') return true;
  if (name === 'set') return args.some((a, i) => /^-[A-Za-z]*[kTa]/.test(a) || (a === '-o' && ['keyword', 'functrace', 'allexport'].includes(optionName(args[i + 1]))));
  // hook-env-refs Task 13: an alias, a hashed path or a switched builtin stands in for a program the hook runs; allexport in any spelling
  if (name === 'alias' || name === 'enable' || name === 'disable') return true;
  if (name === 'hash') return args.some((a) => a.includes('=') || /^-[A-Za-z]*p/.test(a));
  if (name === 'setopt') return args.some((a) => /^[-+][A-Za-z]*a/.test(a) || optionName(a) === 'allexport');
  if (name === 'shopt') return args.some((a) => optionName(a) === 'allexport');
  if (name === 'trap') return args.some((a) => !a.startsWith('-') && setsRefusedVariable(a, depth + 1, call));
  return false;
}

/** `text`: what the tokens were read from, so a word's raw text is known; a script inside a word has none. */
function tokensSet(tokens: Token[], depth: number, call: Call, text?: string): boolean {
  let previous: string | null = null;
  let words: string[] = [];
  let raws: Array<string | undefined> = [];
  /** True right after a word and `(`: a `)` next defines a function. */
  let afterNameParen = false;
  for (const token of tokens) {
    // hook-env-refs Task 9: `name() …` defines a function, which can stand in for a program the hook runs
    if (afterNameParen && token.kind === 'op' && token.value === ')') return true;
    afterNameParen = token.kind === 'op' && token.value === '(' && words.length > 0;
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

/** The names a glob part could stand for that make a path a hook path. */
const HOOK_PATH_NAMES = ['.oss', 'hooks', '.claude', 'plugins', 'cache', 'oss-x.sh'];
/** A shell glob character. */
const GLOB = /[*?[]/;
/** How many readings of a glob word are checked; more counts as a hook path (fail closed). */
const MAX_GLOB_READINGS = 256;

/** True when a glob part could match the name, in any case; a leading dot only when the pattern writes one. */
function globMatches(part: string, name: string): boolean {
  if (name.startsWith('.') && !part.startsWith('.')) return false;
  const pattern = part.replace(/\[[^\]]*\]?|[*?]|[^*?[]/g, (c) => (c === '*' ? '.*' : c === '?' || c.startsWith('[') ? '.' : c.replace(/[.*+?^${}()|\\]/g, '\\$&')));
  return new RegExp(`^${pattern}$`, 'i').test(name);
}

/** The paths a glob word could stand for: each glob part as itself or a hook-path name it matches (`**` also as several folders); null past the cap. */
function globReadings(word: string): string[] | null {
  let readings: string[] = [];
  for (const [i, part] of word.split('/').entries()) {
    const options = GLOB.test(part) ? [part, ...HOOK_PATH_NAMES.filter((n) => globMatches(part, n)), ...(part === '**' ? ['plugins/cache'] : [])] : [part];
    readings = i === 0 ? options : readings.flatMap((r) => options.map((o) => `${r}/${o}`));
    if (readings.length > MAX_GLOB_READINGS) return null;
  }
  return readings;
}

/** True when the word names a hook script, or is a glob that could expand to one. */
function namesHook(word: string, cwd: string): boolean {
  const readings = GLOB.test(word) ? globReadings(word) : [word];
  return readings === null || readings.some((w) => HOOK_FILE.test(w) || inPluginCheckout(w, cwd));
}

/** True when the word is a file in the `hooks/` folder of a plugin checkout: a folder above it holds `.claude-plugin/plugin.json`. */
function inPluginCheckout(word: string, cwd: string): boolean {
  const hooks = HOOKS_PART.exec(word);
  if (hooks === null) return false;
  // the folder that holds `hooks/`, then each folder above it
  let dir = path.dirname(path.resolve(cwd, word.slice(0, hooks.index + hooks[0].length - 1)));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) return true;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * True when a word or assignment value of the part names a hook script from the part's cwd (hook-env-refs
 * Task 10): a relative path is read from the cwd; in a cwd the reader lost, a relative program it runs from
 * a folder counts when its name or folders could be an OSS hook's (`couldBeOssHook`, Task 10b).
 */
function partNamesHook(part: CommandPart): boolean {
  const lost = part.lostDir !== null && part.lostDir.plainKnown !== true;
  if (lost && lostWordsCouldBeHook(part.words)) return true;
  return [...part.words, ...part.assignmentValues].some((w) => {
    if (namesHook(w, part.cwd)) return true;
    if (lost || /^[/~-]/.test(w)) return false;
    return namesHook(path.resolve(part.cwd, w), part.cwd);
  });
}

/** Programs whose first operand is a script they run. */
const SCRIPT_RUNNERS = new Set(['bash', 'sh', 'zsh', '.', 'source']);

/**
 * True when a word of a part run from a folder known only at run time could be an OSS hook (hook-env-refs
 * Tasks 10b and 14): any word, or the program or the script a shell or `source` runs when its last part is unknown.
 */
function lostWordsCouldBeHook(words: string[]): boolean {
  const script = SCRIPT_RUNNERS.has(words[0]) ? words.findIndex((w, i) => i > 0 && !w.startsWith('-')) : -1;
  return words.some((w, i) => couldBeOssHook(w, i === 0 || i === script));
}

/**
 * True when a word could be an OSS hook (hook-env-refs Tasks 10b and 14): a bare `oss-` name (with or without
 * `./`), a part that is `hooks` or `.oss`, in any case or through a glob, or, for a word that runs, an unknown last part.
 */
function couldBeOssHook(word: string, runs: boolean): boolean {
  const parts = word.split('/');
  const last = parts[parts.length - 1].toLowerCase();
  const bare = parts.length === 1 || (parts.length === 2 && parts[0] === '.');
  // the part before its first glob character: `oss-` must start it, or it must start `oss-`
  const literal = last.split(GLOB)[0];
  const ossName = GLOB.test(last) ? literal.startsWith('oss-') || 'oss-'.startsWith(literal) : last.startsWith('oss-');
  return (bare && ossName) || (runs && parts[parts.length - 1].includes(UNKNOWN)) || parts.some((p) => ['hooks', '.oss'].some((name) => (GLOB.test(p) ? globMatches(p, name) : p.toLowerCase() === name)));
}

export function checkOssHookEnv(part: CommandPart, command: string, home: string, sources: TrustedSources): Refusal | null {
  if (!partNamesHook(part) && !PLUGIN_HOOK.test(command)) return null;
  const clears = part.wrappers.some((w, i) => w === 'env' || (w === 'exec' && part.wrapperOptions[i].some((o) => /^-[A-Za-z]*c/.test(o))));
  if (!clears && !setsRefusedVariable(command, 0, { home, sources: sourcesFor(command, sources) })) return null;
  return {
    rule: 'protected-path',
    reason: 'Refused: runs an OSS hook script (`~/.oss/hooks/…`) with a HOME or PATH, or another variable, this command sets or changes (`X=`, `export`, `env`) that is not on the list of variables OSS\'s own commands set on a hook call. Run the hook script as it is, in a command that sets no other variable.',
  };
}
