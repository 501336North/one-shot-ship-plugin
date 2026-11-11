/**
 * The agent that made a tool call. A subagent's hook input carries its name in `agent_type`
 * (plugin agents as `oss:<name>`, project agents as `<name>`); the main agent's carries none.
 */

/** The calling agent's name, or undefined for the main agent. */
export function callingAgentOf(record: Record<string, unknown>): string | undefined {
  const name = record.agent_type;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** True when the agent is one of the gate (review) agents, with or without one leading `oss:`. */
export function isGateAgent(agent: string | undefined, gateAgents: readonly string[]): boolean {
  if (agent === undefined) return false;
  const bare = agent.startsWith('oss:') ? agent.slice('oss:'.length) : agent;
  return gateAgents.includes(bare);
}
