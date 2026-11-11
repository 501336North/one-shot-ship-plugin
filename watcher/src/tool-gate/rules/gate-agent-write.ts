/**
 * Gate-agent-write rule (R-266 US-004): a review (gate) agent may not change the repo it judges.
 * Its edit-tool writes and the Bash writes the command reader sees are refused when they land in
 * the repo, or on a folder holding it, checked as written (`..` collapsed) and as they really are
 * on disk (symlinks followed), against the repo root as given and as resolved. A wildcard is
 * judged by its folder part before the first wildcard. A write whose path is only known when the
 * command runs is refused, since the gate can't tell where it lands. Reads are never refused, nor
 * any call from a builder, the main agent or an agent the gate doesn't know.
 */

import path from 'node:path';
import type { CommandPart } from '../command-reader.js';
import type { EditCall } from '../edit-call.js';
import type { PathResolver } from '../path-resolver.js';
import type { GateSettings } from '../rule-file.js';
import { UNKNOWN } from '../tokenize.js';
import { isGateAgent } from '../calling-agent.js';
import { isSameOrAncestor } from './protected-path.js';
import type { Refusal } from './refusal.js';

const WILDCARD_SEGMENT = /[*?[]/;

const REPORT_ONLY =
  'Review agents review and report only: report the problem and the fix, and the stack\'s builder agent (for example oss:typescript-pro) makes the change.';

/** The path up to its first wildcard segment. */
function fixedPart(p: string): string {
  const segments = p.split('/');
  const first = segments.findIndex((segment) => WILDCARD_SEGMENT.test(segment));
  return first === -1 ? p : segments.slice(0, first).join('/') || '/';
}

/** True when the path is in the repo or is a folder holding it, as written or as it is on disk. */
function touchesRepo(absPath: string, root: string, paths: PathResolver, caseInsensitive: boolean): boolean {
  const fixed = fixedPart(absPath);
  const forms = [path.normalize(fixed), paths.realpath(fixed)];
  const roots = [root, paths.realpath(root)];
  return forms.some((p) =>
    roots.some((r) => isSameOrAncestor(r, p, caseInsensitive) || isSameOrAncestor(p, r, caseInsensitive)),
  );
}

function refusal(what: string): Refusal {
  return { rule: 'gate-agent-write', reason: `Refused by gate-agent-write: ${what}. ${REPORT_ONLY}` };
}

export function checkGateAgentEdit(
  call: Pick<EditCall, 'filePath'>,
  agent: string | undefined,
  settings: GateSettings,
  root: string,
  paths: PathResolver,
  caseInsensitive = false,
): Refusal | null {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  if (!touchesRepo(call.filePath, root, paths, caseInsensitive)) return null;
  return refusal(`a review agent may not write \`${call.filePath}\`, inside the repo it reviews`);
}

export function checkGateAgentBash(
  part: CommandPart,
  agent: string | undefined,
  settings: GateSettings,
  root: string,
  paths: PathResolver,
  caseInsensitive = false,
): Refusal | null {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  for (const target of [...part.writeTargets, ...part.writeGlobs]) {
    if (target.includes(UNKNOWN)) {
      return refusal('a review agent may not write a path only known when the command runs; write the path out in full');
    }
    if (touchesRepo(target, root, paths, caseInsensitive)) {
      return refusal(`a review agent may not write \`${target}\`, inside the repo it reviews`);
    }
  }
  return null;
}
