/**
 * Verdict capture call rule (R-257 D41, security M2): only Claude Code's own SubagentStart/SubagentStop hook runs
 * the verdict capture (`hooks/oss-verdict-capture.sh`, which runs `watcher/dist/cli/verdict-capture.cjs`; D44 adds its tsc output
 * `watcher/dist/cli/verdict-capture.js`). A Bash call that names any of these files is refused for every agent, so a model cannot feed the capture hand-made hook input
 * and mint captured review verdicts.
 * Decided from the call as written (so a `-c` / `eval` script, a heredoc, `$CLAUDE_PLUGIN_ROOT/…` and an unfilled
 * variable count) and from each part's words, assignment values and stdin scripts as the reader resolved them (so
 * `~`, `$HOME`, a variable the reader filled in, a relative path, and a word after `node`, `bash`, `env`, `command`
 * or `exec` count), in any case. A glob counts when it could match any name and either writes part of the
 * capture's own name (`oss-v*`, `*capture*`) or sits in a `hooks/` or `cli/` folder (`~/.oss/hooks/*`).
 * A `find` that runs the files it finds (`-exec`, `-execdir`, `-ok`, `-okdir`, `{}` as the program or as an
 * interpreter's script, `env` included) is refused when a name or path test's glob could match the capture or
 * an OSS hook (`oss-*.sh`), in any case (gate-gaps-r3 Task 10); with no such test it is decided as before.
 * Only when the find could reach them (Task 10b): a start at, above or inside the plugin folder or ~/.oss, read
 * as the protected-path rule reads paths; a start or cwd only known when it runs; or `-L` / `-H` / `-follow`.
 * Reported under the protected-path rule: the hook folder is protected.
 */

import path from 'node:path';
import { findStarts, type CommandPart } from '../command-reader.js';
import type { PathResolver } from '../path-resolver.js';
import { joinRaw } from '../raw-path.js';
import { UNKNOWN } from '../tokenize.js';
import { formsOf, isSameOrAncestor } from './protected-path.js';
import { expandTilde } from './protected-path-mention.js';
import type { Refusal } from './refusal.js';

/** Where the call runs, for reading a find's start folders as the protected-path rule does. */
export interface FindPlaces {
  home: string;
  /** The plugin folder Claude Code names (CLAUDE_PLUGIN_ROOT). */
  pluginRoot: string;
  paths: PathResolver;
  caseInsensitive: boolean;
}

/** The capture's entry points, lower case: the hook, the bundle and its tsc output (D44). */
const NAMES = ['oss-verdict-capture.sh', 'verdict-capture.cjs', 'verdict-capture.js'];
/** Characters that end a path word in shell text. */
const SEPARATORS = /[\s'"`;|&()<>=${}\\,]+/;
/** A shell glob character. */
const GLOB = /[*?[]/;
/** A `[..]` set as the shell reads it: `!`/`^` first, then `]` first as a member, then up to the closing `]`. */
const SET = /\[[!^]?\]?[^\]]*\]?/;
/**
 * Characters that end a `[..]` set and the search for a form's close: shell word ends plus `$`, `{` and `}`, so neither
 * spans two expansions (security INFO-1, gate round 7; a backslash set, security LOW, gate round 8).
 */
const FORM_END = /[\s;|&()<>'"`${}]/;

/**
 * The text with each closed set that holds a class, equivalence or collating form (`[:alpha:]`, `[=e=]`, `[.e.]`)
 * or a backslash turned into `?` (any one character), before the text is split: it fails closed (code-review L1).
 * One pass: the search for a form's closing `:]`, `=]` or `.]` and for the next word end are cached, and an
 * unclosed set is skipped whole. A close past the current word's end does not close the form (code-review round 8).
 */
export function specialSetsAsAny(text: string): string {
  const closing = new Map<string, number>();
  const closeOf = (delim: string, from: number): number => {
    const cached = closing.get(delim);
    if (cached !== undefined && (cached === -1 || cached >= from)) return cached;
    const at = text.indexOf(`${delim}]`, from);
    closing.set(delim, at);
    return at;
  };
  let wordEnd = -1;
  const wordEndOf = (from: number): number => {
    if (wordEnd >= from) return wordEnd;
    wordEnd = from;
    while (wordEnd < text.length && !FORM_END.test(text[wordEnd])) wordEnd += 1;
    return wordEnd;
  };
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '[') {
      out += text[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    if (text[j] === '!' || text[j] === '^') j += 1;
    if (text[j] === ']') j += 1;
    let special = false;
    for (; j < text.length && text[j] !== ']' && !FORM_END.test(text[j]); j += 1) {
      if (text[j] === '\\') {
        special = true;
        if (j + 1 < text.length && !FORM_END.test(text[j + 1])) j += 1;
      } else if (text[j] === '[' && ':=.'.includes(text[j + 1] ?? 'x')) {
        const at = closeOf(text[j + 1], j + 2);
        if (at >= 0 && at < wordEndOf(j + 2)) {
          special = true;
          j = at + 1;
        }
      }
    }
    if (text[j] !== ']') {
      out += text.slice(i, j);
      i = j;
    } else {
      out += special ? '?' : text.slice(i, j + 1);
      i = j + 1;
    }
  }
  return out;
}

/** One glob token: `*` (any run), or a test for one character (`?`, a `[..]` set, or a literal). */
export type Token = '*' | ((c: string) => boolean);

/** The tokens a glob piece stands for. An unclosed `[` matches any one character, as before (fails closed). */
export function globTokens(piece: string): Token[] {
  const tokens: Token[] = [];
  for (const m of piece.matchAll(new RegExp(`${SET.source}|[*?]|[^*?[]`, 'g'))) {
    const c = m[0];
    if (c === '*') tokens.push('*');
    else if (c === '?' || (c.startsWith('[') && (c.length < 2 || !c.endsWith(']') || /^\[[!^]?\]$/.test(c)))) {
      tokens.push(() => true);
    }
    else if (c.startsWith('[')) tokens.push(bracketTest(c.slice(1, -1)));
    else tokens.push((x) => x === c);
  }
  return tokens;
}

/** The test for a `[..]` set body: ranges, and `!` or `^` first to negate. */
function bracketTest(body: string): (c: string) => boolean {
  const negate = body.startsWith('!') || body.startsWith('^');
  const set = negate ? body.slice(1) : body;
  return (c) => {
    let hit = false;
    for (let i = 0; i < set.length; i += 1) {
      if (set[i + 1] === '-' && i + 2 < set.length) {
        if (c >= set[i] && c <= set[i + 2]) hit = true;
        i += 2;
      } else if (set[i] === c) hit = true;
    }
    return hit !== negate;
  };
}

/** Whole-piece glob match with two pointers, backtracking only to the last `*` (no exponential blow-up). */
export function globMatch(tokens: Token[], name: string): boolean {
  let t = 0;
  let s = 0;
  let star = -1;
  let starS = 0;
  while (s < name.length) {
    const token = tokens[t];
    if (token === '*') {
      star = t;
      starS = s;
      t += 1;
    } else if (token !== undefined && token(name[s])) {
      t += 1;
      s += 1;
    } else if (star >= 0) {
      t = star + 1;
      starS += 1;
      s = starS;
    } else return false;
  }
  while (tokens[t] === '*') t += 1;
  return t === tokens.length;
}

/** True when a glob piece could be one of the names and writes part of it, or its folder is a hooks or cli folder. */
function globNames(piece: string, folder: string | undefined): boolean {
  const tokens = globTokens(piece);
  if (!NAMES.some((name) => globMatch(tokens, name))) return false;
  const literals = piece.split(new RegExp(`${SET.source}|[*?]`));
  return literals.some(writesStem) || (folder !== undefined && /^(?:hooks|cli)$/.test(folder));
}

/** True when a literal sits inside one of the full names with at least 3 of its characters before the extension (perf I3). */
function writesStem(literal: string): boolean {
  if (literal.length < 3) return false;
  return NAMES.some((name) => {
    const stemEnd = name.lastIndexOf('.');
    for (let at = name.indexOf(literal); at >= 0; at = name.indexOf(literal, at + 1)) {
      if (Math.min(at + literal.length, stemEnd) - at >= 3) return true;
    }
    return false;
  });
}

/** True when a path segment of the text, as written, is one of the names. */
function hasLiteralName(text: string): boolean {
  return text.split(SEPARATORS).some((word) => word.split('/').some((segment) => NAMES.includes(segment)));
}

/**
 * True when the text names the capture: a path segment equal to a name, or a glob segment that could be one.
 * A literal name is checked on the raw text first, so turning a set into `?` never hides it (security INFO-1, gate round 7).
 */
export function namesVerdictCapture(text: string): boolean {
  const lower = text.toLowerCase();
  if (hasLiteralName(lower)) return true;
  for (const word of specialSetsAsAny(lower).split(SEPARATORS)) {
    const segments = word.split('/');
    for (const [i, segment] of segments.entries()) {
      if (GLOB.test(segment) && globNames(segment, segments[i - 1])) return true;
    }
  }
  return false;
}

/** find's actions that run a command, ended by `;` or `+`. */
const FIND_RUNNERS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
/** find's tests that take a name or path glob. */
const FIND_GLOBS = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename']);
/** Interpreters whose first non-option word is the script they run. */
const INTERPRETERS = /^(?:node|sh|bash|zsh|dash|python3?|perl|ruby|deno|bun|tsx|ts-node)$/;
/** A variable assignment word, as `env` takes it. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * True when some text made of the pieces, in order with any text between them (and before the first,
 * unless anchored), is matched by the glob's tokens: one pass over the pieces with the set of token positions.
 */
function couldMatch(tokens: Token[], pieces: string[], anchored: boolean): boolean {
  const closure = (at: Set<number>): Set<number> => {
    for (const t of at) if (tokens[t] === '*') at.add(t + 1);
    return at;
  };
  const gap = (at: Set<number>): Set<number> => {
    const from = Math.min(...at);
    const all = new Set<number>();
    for (let t = from; t <= tokens.length; t += 1) all.add(t);
    return all;
  };
  let at = closure(new Set([0]));
  if (!anchored) at = gap(at);
  for (const [k, piece] of pieces.entries()) {
    if (k > 0) at = gap(at);
    for (const c of piece) {
      const next = new Set<number>();
      for (const t of at) {
        const token = tokens[t];
        if (token === '*') next.add(t);
        else if (token !== undefined && token(c)) next.add(t + 1);
      }
      at = closure(next);
      if (at.size === 0) return false;
    }
  }
  return at.has(tokens.length);
}

/** True when a find name or path glob could pick the capture or an OSS hook (`oss-*.sh`), in any case. */
function globCouldPickProtected(test: string, glob: string): boolean {
  const tokens = globTokens(glob.toLowerCase());
  const whole = test === '-name' || test === '-iname';
  return [...NAMES.map((name) => [name]), ['oss-', '.sh']].some((pieces) =>
    couldMatch(tokens, whole ? pieces : [`/${pieces[0]}`, ...pieces.slice(1)], whole),
  );
}

/** True when a find action's command runs `{}` as its program or as an interpreter's script, through `env` too. */
function runsFound(words: string[]): boolean {
  let i = 0;
  if (words[0] === 'env') {
    i = 1;
    while (i < words.length && (words[i].startsWith('-') || ENV_ASSIGNMENT.test(words[i]))) i += 1;
  }
  const program = words[i];
  if (program === undefined) return false;
  if (program.includes('{}')) return true;
  if (!INTERPRETERS.test(program.split('/').pop() ?? '')) return false;
  const script = words.slice(i + 1).find((w) => !w.startsWith('-') && w !== 'run');
  return script?.includes('{}') ?? false;
}

/** find's leading options that follow links: `-L`, `-H` in any cluster, or `-follow` anywhere. */
const FOLLOWS_LINKS = /^(?:-[HLPEXdsx]*[HL][HLPEXdsx]*|-follow)$/;

/**
 * True when the find could reach the plugin folder or ~/.oss, where the protected scripts are (Task 10b): a start
 * at, above or inside one of them (`..` read as on disk), a start or cwd only known when it runs, or links followed.
 */
function findReachesProtected(part: CommandPart, at: FindPlaces): boolean {
  const args = part.words.slice(1);
  if (args.some((w) => FOLLOWS_LINKS.test(w))) return true;
  const folders = [at.pluginRoot, path.join(at.home, '.oss')].filter((f) => path.isAbsolute(f)).flatMap((f) => formsOf(f, at.paths));
  return findStarts(args).some((start) => {
    if (start.includes(UNKNOWN) || part.cwd.includes(UNKNOWN) || (part.lostDir !== null && !start.startsWith('/'))) return true;
    return formsOf(joinRaw(part.cwd, expandTilde(start, at.home)), at.paths).some((form) =>
      folders.some((f) => isSameOrAncestor(form, f, at.caseInsensitive) || isSameOrAncestor(f, form, at.caseInsensitive)),
    );
  });
}

/** True when a find runs a file it found by a glob that could pick a protected script it can reach (gate-gaps-r3 Tasks 10, 10b). */
function findRunsProtected(part: CommandPart, at: FindPlaces): boolean {
  if (part.name !== 'find') return false;
  const words = part.words;
  if (!findReachesProtected(part, at)) return false;
  if (!words.some((word, i) => FIND_GLOBS.has(words[i - 1] ?? '') && globCouldPickProtected(words[i - 1], word))) return false;
  for (let i = 1; i < words.length; i += 1) {
    if (!FIND_RUNNERS.has(words[i])) continue;
    const end = words.findIndex((w, k) => k > i && (w === ';' || w === '+'));
    if (runsFound(words.slice(i + 1, end === -1 ? words.length : end))) return true;
    if (end === -1) break;
    i = end;
  }
  return false;
}

export function checkVerdictCaptureCall(part: CommandPart, command: string, at: FindPlaces): Refusal | null {
  if (findRunsProtected(part, at)) {
    return {
      rule: 'protected-path',
      reason: 'Refused: this `find` runs the files it finds, and its name or path test could pick a protected OSS script (the verdict capture or an OSS hook). Run a file you name in full, or ask the user to run it with `!`.',
    };
  }
  const texts = [command, ...part.words, ...part.assignmentValues, ...part.stdinScripts];
  if (!texts.some(namesVerdictCapture)) return null;
  return {
    rule: 'protected-path',
    reason: 'Refused: runs or names the OSS verdict capture (`oss-verdict-capture.sh`, `verdict-capture.cjs`, `verdict-capture.js`). Only Claude Code\'s own subagent hook runs it; a review verdict is captured when the review agent stops.',
  };
}
