/**
 * Workflow Engine - Agent Spawner
 *
 * Spawns agents based on configuration with condition evaluation.
 *
 * @behavior Agents are spawned individually or in parallel, with optional
 *           agents skipped based on condition evaluation.
 */

import { AgentConfig, WorkflowContext, AgentResult } from './types.js';
import { evaluateCondition } from './conditions.js';

/**
 * Type for agent spawner function
 */
type AgentSpawner = (agentType: string) => Promise<AgentResult>;

/**
 * Default agent spawner - logs to console
 * In production, this would call the Task tool
 */
const defaultSpawner: AgentSpawner = async (agentType: string): Promise<AgentResult> => {
  console.log(`[WorkflowEngine] Spawning agent: ${agentType}`);
  return {
    agent: agentType,
    success: true,
    output: `Agent ${agentType} spawned (default implementation)`,
  };
};

/**
 * The current agent spawner (can be overridden for testing)
 */
let currentSpawner: AgentSpawner = defaultSpawner;

/**
 * Set the agent spawner (for testing or custom implementations)
 *
 * @param spawner - The function to call when spawning agents
 */
export function setAgentSpawner(spawner: AgentSpawner): void {
  currentSpawner = spawner;
}

/**
 * Reset the agent spawner to the default
 */
export function resetAgentSpawner(): void {
  currentSpawner = defaultSpawner;
}

/**
 * Check if an agent should be spawned based on conditions
 *
 * @param config - The agent configuration
 * @param context - The workflow context for condition evaluation
 * @returns true if the agent should be spawned
 */
function shouldSpawn(config: AgentConfig, context: WorkflowContext): boolean {
  // Always spawn if 'always' is true
  if (config.always) {
    return true;
  }

  // Evaluate condition if specified
  if (config.condition) {
    return evaluateCondition(config.condition, context);
  }

  // Default to not spawning if neither always nor condition is specified
  return false;
}

/**
 * Spawn a single agent
 *
 * @param config - The agent configuration
 * @param context - The workflow context for condition evaluation
 * @returns The result of the agent execution
 */
export async function spawnAgent(
  config: AgentConfig,
  context: WorkflowContext
): Promise<AgentResult> {
  // Check if this agent should be spawned
  if (!shouldSpawn(config, context)) {
    return {
      agent: config.agent,
      success: true,
      output: `Agent ${config.agent} skipped - condition not met`,
    };
  }

  try {
    return await currentSpawner(config.agent);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      agent: config.agent,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Spawn multiple agents in parallel
 *
 * @param configs - Array of agent configurations
 * @param context - The workflow context for condition evaluation
 * @param allMustPass - If true, all agents must pass for overall success
 * @returns Array of agent results
 */
export async function spawnParallelAgents(
  configs: AgentConfig[],
  context: WorkflowContext,
  allMustPass: boolean
): Promise<AgentResult[]> {
  if (configs.length === 0) {
    return [];
  }

  // Spawn all agents in parallel
  const promises = configs.map((config) => spawnAgent(config, context));
  const results = await Promise.all(promises);

  // If allMustPass is true, we just return all results
  // The caller can check if any failed
  // This is by design - we want to show ALL failures, not just the first one

  return results;
}
