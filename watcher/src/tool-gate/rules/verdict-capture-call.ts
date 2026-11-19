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

/** The regular expression a glob piece stands for, whole-piece. */
function globRegex(piece: string): RegExp {
  const source = piece.replace(/\[[^\]]*\]?|[*?]|[^*?[]/g, (c) =>
    c === '*' ? '.*' : c === '?' ? '.' : c.startsWith('[') ? '.' : c.replace(/[.*+?^${}()|\\]/g, '\\$&'));
  return new RegExp(`^${source}$`);
}

/** True when a glob piece could be one of the names and writes part of it, or its folder is a hooks or cli folder. */
function globNames(piece: string, folder: string | undefined): boolean {
  if (!NAMES.some((name) => globRegex(piece).test(name))) return false;
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
