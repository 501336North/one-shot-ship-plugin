/**
 * The review (gate) agents, read for the offloader without loading the tool gate (which ships only as a
 * bundle): the plugin's config/tool-gates.json gateAgents, plus any names a repo's .oss/tool-gates.json
 * adds. A repo file can only add; a missing or broken one is ignored. A missing or broken plugin list throws.
 */

import * as path from 'path';
import { readRegularFileSyncOrNull } from './regular-file.js';

function namesIn(file: string): string[] | null {
  try {
    const text = readRegularFileSyncOrNull(file);
    const list: unknown = text === null ? null : (JSON.parse(text) as { gateAgents?: unknown })?.gateAgents;
    return Array.isArray(list) && list.every((n) => typeof n === 'string' && n.length > 0) ? (list as string[]) : null;
  } catch {
    return null;
  }
}

/** True when the agent is one of the gate (review) agents, with or without one leading `oss:`. */
export function isGateAgent(agent: string | undefined, gateAgents: readonly string[]): boolean {
  if (agent === undefined) return false;
  const bare = agent.startsWith('oss:') ? agent.slice('oss:'.length) : agent;
  return gateAgents.includes(bare);
}

export function readGateAgents(pluginRoot: string, repoRoot: string): string[] {
  const base = namesIn(path.join(pluginRoot, 'config', 'tool-gates.json'));
  if (base === null) throw new Error('plugin gateAgents is missing or invalid');
  return [...new Set([...base, ...(namesIn(path.join(repoRoot, '.oss', 'tool-gates.json')) ?? [])])];
}
