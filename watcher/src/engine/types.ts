/**
 * Workflow Engine Types
 *
 * Types for configurable workflow orchestration.
 * Workflow configs are fetched from API and control command chains, agents, and checkpoints.
 */

/**
 * A command chain configuration item
 */
export interface ChainItem {
  /** The command to execute (e.g., "requirements", "api-design") */
  command: string;
  /** If true, always execute this command */
  always?: boolean;
  /** Condition to evaluate for conditional execution */
  condition?: string;
}

/**
 * An agent configuration item
 */
export interface AgentConfig {
  /** The agent identifier (e.g., "code-reviewer", "security-auditor") */
  agent: string;
  /** If true, always spawn this agent */
  always?: boolean;
  /** Condition to evaluate for conditional spawning */
  condition?: string;
}

/**
 * Quality gates configuration
 */
export interface QualityGates {
  /** Whether to run agents in parallel */
  parallel: boolean;
  /** List of agents to run */
  agents: string[];
  /** If true, all agents must pass for the gate to pass */
  all_must_pass: boolean;
}

/**
 * Checkpoint type - determines whether to pause for human review
 */
export type CheckpointType = 'human' | 'auto';

/**
 * The TDD task loop phases
 */
export type TddPhase = 'red' | 'green' | 'refactor';

/**
 * Complete workflow configuration
 */
export interface WorkflowConfig {
  /** Commands to chain after this workflow completes */
  chains_to?: ChainItem[];
  /** The TDD task loop phases */
  task_loop?: TddPhase[];
  /** Agents to spawn during this workflow */
  agents?: AgentConfig[];
  /** Quality gates configuration */
  quality_gates?: QualityGates;
  /** Whether to pause for human review */
  checkpoint?: CheckpointType;
}

/**
 * Encrypted workflow config from API
 */
export interface EncryptedWorkflowConfig {
  /** The encrypted config data */
  encrypted: string;
  /** Initialization vector for decryption */
  iv: string;
  /** Authentication tag for decryption */
  authTag: string;
}

/**
 * Context for evaluating workflow conditions
 */
export interface WorkflowContext {
  /** Content from the design phase (DESIGN.md) */
  designContent?: string;
  /** List of files changed in the current session */
  changedFiles?: string[];
  /** Result from the last test run */
  lastTestResult?: TestResult;
}

/**
 * Test result structure
 */
export interface TestResult {
  /** Whether all tests passed */
  passed: boolean;
  /** List of failure messages if any */
  failures: string[];
}

/**
 * Result of executing a command chain
 */
export type ChainResult =
  | { status: 'completed' }
  | { status: 'checkpoint'; message: string }
  | { status: 'error'; error: string };

/**
 * Result from an agent execution
 */
export interface AgentResult {
  /** The agent that was executed */
  agent: string;
  /** Whether the agent succeeded */
  success: boolean;
  /** Any output or findings from the agent */
  output?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Type for condition evaluator functions
 */
export type ConditionFn = (context: WorkflowContext) => boolean;

/**
 * Default workflow configs for fallback when API is unavailable
 */
export const DEFAULT_WORKFLOW_CONFIGS: Record<string, WorkflowConfig> = {
  ideate: {
    chains_to: [
      { command: 'requirements', always: true },
      { command: 'api-design', condition: 'has_api_work' },
      { command: 'data-model', condition: 'has_db_work' },
      { command: 'adr', always: true },
    ],
    checkpoint: 'human',
  },
  plan: {
    chains_to: [
      { command: 'acceptance', always: true },
    ],
    checkpoint: 'human',
  },
  build: {
    task_loop: ['red', 'green', 'refactor'],
    agents: [
      { agent: 'code-simplifier', always: true },
      { agent: 'frontend-design', condition: 'has_ui_work' },
    ],
    checkpoint: 'auto',
  },
  ship: {
    quality_gates: {
      parallel: true,
      agents: ['code-reviewer', 'performance-engineer', 'security-auditor'],
      all_must_pass: true,
    },
    checkpoint: 'human',
  },
};
