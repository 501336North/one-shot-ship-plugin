/**
 * Force-push rule (US-002): refuses `git push` with a force flag (`--force`, `--force-with-lease`,
 * `--force-if-includes`, a short cluster holding `f`) or a `+` refspec, on any branch.
 */

import type { CommandPart } from '../command-reader.js';
import type { GateSettings } from '../rule-file.js';
import type { Refusal } from './refusal.js';
import { readPushWords } from './push-words.js';

/** A single-dash cluster of short flags that includes `f` (`-f`, `-fu`, `-uf`). */
const SHORT_FORCE = /^-(?=[A-Za-z]*f)[A-Za-z]+$/;

function isForce(option: string): boolean {
  return option === '--force' || option.startsWith('--force-') || SHORT_FORCE.test(option);
}

export function checkForcePush(part: CommandPart, _settings: GateSettings): Refusal | null {
  if (part.git?.subcommand !== 'push') return null;
  const { options, positional } = readPushWords(part.git.args);
  const found = options.find(isForce) ?? positional.find((word) => word.startsWith('+'));
  if (found === undefined) return null;
  return {
    rule: 'force-push',
    reason: `Refused: \`git push ${found}\` rewrites history. Push without force; if the branch diverged, ask the user.`,
  };
}
