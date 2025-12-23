/**
 * Background Agent Types
 *
 * Core type definitions for the pluggable background agent system.
 * All background agents implement the BackgroundAgent interface.
 */

/**
 * Static metadata about an agent
 */
export interface AgentMetadata {
  name: string;
  description: string;
  version: string;
}

/**
 * Runtime status of an agent
 */
export interface AgentStatus {
  isRunning: boolean;
  lastPollTime: string | null;
  errorCount: number;
  lastError: string | null;
}

/**
 * Configuration for an agent
 */
export interface AgentConfig {
  enabled: boolean;
  interval: number; // milliseconds between polls
  maxRetries: number;
  retryOnFailure: boolean;
  name?: string; // optional name override
}

/**
 * Default configuration for agents
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  enabled: false,
  interval: 300000, // 5 minutes
  maxRetries: 3,
  retryOnFailure: true,
};

/**
 * Core interface that all background agents must implement
 */
export interface BackgroundAgent {
  metadata: AgentMetadata;
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  poll(): Promise<void>;
  getStatus(): AgentStatus;
}

/**
 * Type guard to check if an object implements BackgroundAgent
 */
export function isBackgroundAgent(obj: unknown): obj is BackgroundAgent {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const agent = obj as Record<string, unknown>;

  // Check metadata
  if (!agent.metadata || typeof agent.metadata !== 'object') {
    return false;
  }

  const metadata = agent.metadata as Record<string, unknown>;
  if (
    typeof metadata.name !== 'string' ||
    typeof metadata.description !== 'string' ||
    typeof metadata.version !== 'string'
  ) {
    return false;
  }

  // Check required methods
  if (
    typeof agent.initialize !== 'function' ||
    typeof agent.start !== 'function' ||
    typeof agent.stop !== 'function' ||
    typeof agent.poll !== 'function' ||
    typeof agent.getStatus !== 'function'
  ) {
    return false;
  }

  return true;
}
