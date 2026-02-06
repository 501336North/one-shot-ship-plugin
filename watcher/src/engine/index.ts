/**
 * Workflow Engine - Public API
 *
 * Exports all workflow engine components for use by commands and hooks.
 */

// Types
export * from './types.js';

// Condition evaluator
export { evaluateCondition, getBuiltInConditions } from './conditions.js';

// Chain executor
export {
  executeChain,
  invokeCommand,
  setCommandInvoker,
  resetCommandInvoker,
} from './executor.js';

// Agent spawner
export {
  spawnAgent,
  spawnParallelAgents,
  setAgentSpawner,
  resetAgentSpawner,
} from './agents.js';

// Custom command executor
export {
  CustomCommandExecutor,
  isCustomCommand,
  parseCustomCommand,
} from './custom-command-executor.js';
export type {
  CustomCommandExecutorConfig,
  CustomCommandResponse,
  CustomCommandResult,
} from './custom-command-executor.js';

// Workflow chain executor (includes custom command support)
export { WorkflowChainExecutor } from './workflow-chain-executor.js';
export type {
  ChainStep,
  ClassifiedStep,
  StepExecutionResult,
  ChainExecutionResult,
  WorkflowContext,
} from './workflow-chain-executor.js';
