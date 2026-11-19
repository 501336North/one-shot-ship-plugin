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
 * Reported under the protected-path rule: the hook folder is protected.
 */

import type { CommandPart } from '../command-reader.js';
import type { Refusal } from './refusal.js';

/** The capture's entry points, lower case: the hook, the bundle and its tsc output (D44). */
const NAMES = ['oss-verdict-capture.sh', 'verdict-capture.cjs', 'verdict-capture.js'];
/** The capture's own name, which a glob's literal text must be part of to count outside a hooks or cli folder. */
const STEM = 'oss-verdict-capture';
/** Characters that end a path word in shell text. */
const SEPARATORS = /[\s'"`;|&()<>=${}\\,]+/;
/** A shell glob character. */
const GLOB = /[*?[]/;

/** One glob token: `*` (any run), or a test for one character (`?`, a `[..]` set, or a literal). */
type Token = '*' | ((c: string) => boolean);

/** The tokens a glob piece stands for. An unclosed `[` matches any one character, as before (fails closed). */
function globTokens(piece: string): Token[] {
  const tokens: Token[] = [];
  for (const m of piece.matchAll(/\[[^\]]*\]?|[*?]|[^*?[]/g)) {
    const c = m[0];
    if (c === '*') tokens.push('*');
    else if (c === '?' || (c.startsWith('[') && !c.endsWith(']'))) tokens.push(() => true);
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
function globMatch(tokens: Token[], name: string): boolean {
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
  const literals = piece.split(/\[[^\]]*\]?|[*?]/).map((l) => l.replace(/\.(?:sh|c?js)$/, ''));
  return literals.some((l) => l.length >= 3 && STEM.includes(l)) || (folder !== undefined && /^(?:hooks|cli)$/.test(folder));
}

/** True when the text names the capture: a path segment equal to a name, or a glob segment that could be one. */
export function namesVerdictCapture(text: string): boolean {
  for (const word of text.toLowerCase().split(SEPARATORS)) {
    const segments = word.split('/');
    for (const [i, segment] of segments.entries()) {
      if (NAMES.includes(segment)) return true;
      if (GLOB.test(segment) && globNames(segment, segments[i - 1])) return true;
    }
  }
  return false;
}

export function checkVerdictCaptureCall(part: CommandPart, command: string): Refusal | null {
  const texts = [command, ...part.words, ...part.assignmentValues, ...part.stdinScripts];
  if (!texts.some(namesVerdictCapture)) return null;
  return {
    rule: 'protected-path',
    reason: 'Refused: runs or names the OSS verdict capture (`oss-verdict-capture.sh`, `verdict-capture.cjs`, `verdict-capture.js`). Only Claude Code\'s own subagent hook runs it; a review verdict is captured when the review agent stops.',
  };
}
