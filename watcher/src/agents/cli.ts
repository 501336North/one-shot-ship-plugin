/**
 * Agent CLI Commands
 *
 * Provides CLI commands to manage background agents.
 */

import type { AgentRegistry } from './registry';
import type { AgentConfig, AgentStatus } from './types';
import { getAgentConfig, saveAgentConfig } from './config';

/**
 * Agent list entry
 */
export interface AgentListEntry {
  name: string;
  description: string;
  enabled: boolean;
  running: boolean;
  lastPollTime: string | null;
}

/**
 * Agent status with name
 */
export interface AgentStatusWithName extends AgentStatus {
  name: string;
}

/**
 * Default polling interval (5 minutes)
 */
const DEFAULT_INTERVAL = 300000;

/**
 * Parse interval string to milliseconds
 */
function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error('Invalid interval format. Use format like "30s", "5m", "1h"');
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      throw new Error('Invalid interval format');
  }
}

/**
 * Agent CLI
 *
 * Provides commands to manage background agents.
 */
export class AgentCLI {
  constructor(private registry: AgentRegistry) {}

  /**
   * List all registered agents with their status
   */
  async list(): Promise<AgentListEntry[]> {
    const agentNames = this.registry.list();
    const entries: AgentListEntry[] = [];

    for (const name of agentNames) {
      const agent = this.registry.get(name);
      if (!agent) continue;

      const config = await getAgentConfig(name);
      const status = agent.getStatus();

      entries.push({
        name,
        description: agent.metadata.description,
        enabled: config.enabled,
        running: status.isRunning,
        lastPollTime: status.lastPollTime,
      });
    }

    return entries;
  }

  /**
   * Enable an agent
   */
  async enable(agentName: string): Promise<void> {
    if (!this.registry.has(agentName)) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    await saveAgentConfig(agentName, { enabled: true });
    await this.registry.startAgent(agentName, DEFAULT_INTERVAL);
  }

  /**
   * Disable an agent
   */
  async disable(agentName: string): Promise<void> {
    if (!this.registry.has(agentName)) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    await saveAgentConfig(agentName, { enabled: false });
    await this.registry.stopAgent(agentName);
  }

  /**
   * Get or update agent config
   */
  async config(
    agentName: string,
    options?: { interval?: string }
  ): Promise<AgentConfig | void> {
    if (!this.registry.has(agentName)) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    // If no options, return current config
    if (!options || Object.keys(options).length === 0) {
      return getAgentConfig(agentName);
    }

    // Update config
    if (options.interval) {
      const intervalMs = parseInterval(options.interval);
      await saveAgentConfig(agentName, { interval: intervalMs });
    }
  }

  /**
   * Get detailed status for an agent
   */
  async status(agentName: string): Promise<AgentStatus> {
    const agent = this.registry.get(agentName);
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    return agent.getStatus();
  }

  /**
   * Get status for all agents
   */
  async statusAll(): Promise<AgentStatusWithName[]> {
    const agentNames = this.registry.list();
    const statuses: AgentStatusWithName[] = [];

    for (const name of agentNames) {
      const agent = this.registry.get(name);
      if (!agent) continue;

      const status = agent.getStatus();
      statuses.push({
        name,
        ...status,
      });
    }

    return statuses;
  }

  /**
   * Restart an agent
   */
  async restart(agentName: string): Promise<void> {
    if (!this.registry.has(agentName)) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const config = await getAgentConfig(agentName);
    await this.registry.restartAgent(agentName, config.interval || DEFAULT_INTERVAL);
  }
}
