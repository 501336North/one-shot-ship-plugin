/**
 * Workflow Engine - Chain Executor
 *
 * Executes command chains in sequence with condition evaluation.
 *
 * @behavior Commands are invoked in order, with optional steps skipped
 *           based on condition evaluation. Execution stops at human checkpoints.
 */

import { WorkflowConfig, WorkflowContext, ChainResult, ChainItem } from './types.js';
import { evaluateCondition } from './conditions.js';

/**
 * Type for command invoker function
 */
type CommandInvoker = (command: string) => Promise<void>;

/**
 * Type for log function
 */
type LogFn = (message: string) => void;

/**
 * Default command invoker - logs to console
 * In production, this would call the Skill tool
 */
const defaultInvoker: CommandInvoker = async (command: string) => {
  console.log(`[WorkflowEngine] Invoking command: /oss:${command}`);
};

/**
 * The current command invoker (can be overridden for testing)
 */
let currentInvoker: CommandInvoker = defaultInvoker;

/**
 * Set the command invoker (for testing or custom implementations)
 *
 * @param invoker - The function to call when invoking commands
 */
export function setCommandInvoker(invoker: CommandInvoker): void {
  currentInvoker = invoker;
}

/**
 * Reset the command invoker to the default
 */
export function resetCommandInvoker(): void {
  currentInvoker = defaultInvoker;
}

/**
 * Invoke a command using the current invoker
 *
 * @param command - The command name (without /oss: prefix)
 */
export async function invokeCommand(command: string): Promise<void> {
  return currentInvoker(command);
}

/**
 * Check if a chain item should be executed based on conditions
 *
 * @param item - The chain item to check
 * @param context - The workflow context for condition evaluation
 * @returns true if the item should be executed
 */
function shouldExecute(item: ChainItem, context: WorkflowContext): boolean {
  // Always execute if 'always' is true
  if (item.always) {
    return true;
  }

  // Evaluate condition if specified
  if (item.condition) {
    return evaluateCondition(item.condition, context);
  }

  // Default to not executing if neither always nor condition is specified
  return false;
}

/**
 * Execute a workflow chain
 *
 * @param config - The workflow configuration
 * @param context - The workflow context for condition evaluation
 * @param logger - Optional log function for execution logging
 * @returns The result of chain execution
 */
export async function executeChain(
  config: WorkflowConfig,
  context: WorkflowContext,
  logger?: LogFn
): Promise<ChainResult> {
  const log = logger || (() => {});

  // Handle missing or empty chains
  const chains = config.chains_to || [];

  // Execute each chain item in order
  for (const item of chains) {
    // Check if this item should be executed
    if (!shouldExecute(item, context)) {
      log(`[skip] ${item.command} - condition not met`);
      continue;
    }

    log(`[exec] ${item.command}`);

    try {
      await invokeCommand(item.command);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`[error] ${item.command} - ${errorMessage}`);
      return {
        status: 'error',
        error: errorMessage,
      };
    }
  }

  // Check checkpoint type
  if (config.checkpoint === 'human') {
    return {
      status: 'checkpoint',
      message: 'Waiting for human review before continuing.',
    };
  }

  return { status: 'completed' };
}
