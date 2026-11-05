/**
 * A repo's leftover agent model mappings (T88). Since 2.0.97 (T71b) a project's .oss/config.json no longer picks an
 * agent's model; this reads it only to tell the customer which mappings were ignored and how to keep them. It never
 * feeds routing. The repo is untrusted: the file is read hang-safe, and every value is cleaned before it is shown.
 */

import * as path from 'path';
import { readRegularFileSync } from './regular-file.js';
import { safeForLog } from './safe-for-log.js';

interface RepoModels {
  default?: unknown;
  agents?: Record<string, unknown>;
}

const isNonClaude = (model: unknown): model is string =>
  typeof model === 'string' && model !== '' && model !== 'claude' && model !== 'default';

/** The project's `models` object; undefined when the file is missing, not a regular file, unreadable or malformed. */
function repoModels(projectDir: string): RepoModels | undefined {
  try {
    const models = (JSON.parse(readRegularFileSync(path.join(projectDir, '.oss', 'config.json'))) as { models?: unknown })
      .models;
    return typeof models === 'object' && models !== null ? (models as RepoModels) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One plain token each: the notice reaches Claude's context, so the repo must not be able to shape the command.
 * Each is also what `oss-value.sh models-set` (run by /oss:models set) accepts, capped at 60: its prompt rule
 * `^[a-z0-9_./:-]{1,100}$` (the agent rule here is stricter) and its model rule `^[A-Za-z0-9_./:-]{1,100}$`
 * with no `..`.
 */
const COMMAND_AGENT = /^[a-z0-9][a-z0-9:_-]{0,59}$/;
const COMMAND_MODEL = /^[A-Za-z0-9_./:-]{1,60}$/;

/**
 * `subject` is what the repo set ("maps <agent> to <model>" or "sets models.default to <model>"). The command is
 * offered only when cleaning changed neither value and each is one plain token, so the repo cannot shape it.
 */
function note(agent: string, model: string, verb: 'ran' | 'runs', fromDefault = false): string {
  const a = safeForLog(agent);
  const m = safeForLog(model);
  const subject = fromDefault ? `sets models.default to ${m}` : `maps ${a} to ${m}`;
  const keep =
    a === agent && m === model && COMMAND_AGENT.test(agent) && COMMAND_MODEL.test(model) && !model.includes('..')
      ? `To keep ${m}, you can run /oss:models set ${a} ${m} yourself`
      : 'To keep it, add it under models.agents in ~/.oss/config.json';
  return (
    `⚠️ This repo's .oss/config.json ${subject}, but since OSS 2.0.97 agent models are read only from ` +
    `~/.oss/config.json, so this agent ${verb} on Claude. ${keep}`
  );
}

/** The notice for an agent that ran on Claude while the repo maps it (or its default) to another model; else undefined. */
export function repoAgentModelNotice(projectDir: string, agentName: string): string | undefined {
  const models = repoModels(projectDir);
  const agents = models?.agents;
  const own = typeof agents === 'object' && agents !== null ? agents[agentName] : undefined;
  const model = own || models?.default;
  return isNonClaude(model) ? note(agentName, model, 'ran', !own) : undefined;
}

/** One notice per agent the repo maps to a non-Claude model, at most `limit`. */
export function repoAgentModelNotices(projectDir: string, limit = 10): string[] {
  const agents = repoModels(projectDir)?.agents;
  if (typeof agents !== 'object' || agents === null) return [];
  return Object.entries(agents)
    .filter((entry): entry is [string, string] => isNonClaude(entry[1]))
    .slice(0, limit)
    .map(([agent, model]) => note(agent, model, 'runs'));
}
