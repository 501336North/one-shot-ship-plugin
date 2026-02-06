/**
 * WorkflowChainExecutor - Executes workflow chains with custom command support
 *
 * @behavior Executes chain steps, handling custom commands via CustomCommandExecutor
 * @responsibility Integration of custom commands into workflow orchestration
 *
 * The executor:
 * 1. Classifies chain steps as custom or standard
 * 2. Evaluates conditions for conditional steps
 * 3. Executes custom commands via CustomCommandExecutor
 * 4. Handles blocking/non-blocking behavior
 * 5. Returns execution results for workflow engine
 */

import {
  CustomCommandExecutor,
  CustomCommandResult,
  isCustomCommand,
  parseCustomCommand,
  CustomCommandExecutorConfig,
} from './custom-command-executor.js';

/**
 * Configuration for a chain step
 */
export interface ChainStep {
  command: string;
  always?: boolean;
  condition?: string;
}

/**
 * Classified chain step with custom command flag
 */
export interface ClassifiedStep {
  step: ChainStep;
  isCustom: boolean;
}

/**
 * Result of executing a single step
 */
export interface StepExecutionResult {
  command: string;
  skipped: boolean;
  skipReason?: string;
  customCommandResult?: CustomCommandResult;
  error?: string;
}

/**
 * Result of executing an entire chain
 */
export interface ChainExecutionResult {
  success: boolean;
  executedSteps: StepExecutionResult[];
  warnings: string[];
  stoppedAt?: string;
}

/**
 * Context for condition evaluation
 */
export type WorkflowContext = Record<string, boolean | string | number>;

/**
 * Executor for workflow chains including custom commands
 */
export class WorkflowChainExecutor {
  private customExecutor: CustomCommandExecutor;

  constructor(config: CustomCommandExecutorConfig) {
    this.customExecutor = new CustomCommandExecutor(config);
  }

  /**
   * Classify chain steps as custom or standard
   *
   * @param chain - The chain steps to classify
   * @returns Classified steps with isCustom flag
   */
  classifyChainSteps(chain: ChainStep[]): ClassifiedStep[] {
    return chain.map((step) => ({
      step,
      isCustom: isCustomCommand(step.command),
    }));
  }

  /**
   * Evaluate if a condition is met
   *
   * @param condition - The condition name
   * @param context - The workflow context
   * @returns true if condition is met
   */
  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
    // Check if condition exists in context and is truthy
    return !!context[condition];
  }

  /**
   * Check if a step should be executed
   *
   * @param step - The chain step
   * @param context - The workflow context
   * @returns Object with shouldExecute and skipReason
   */
  private shouldExecuteStep(
    step: ChainStep,
    context: WorkflowContext
  ): { shouldExecute: boolean; skipReason?: string } {
    // Always execute if always=true
    if (step.always) {
      return { shouldExecute: true };
    }

    // Check condition
    if (step.condition) {
      const conditionMet = this.evaluateCondition(step.condition, context);
      if (!conditionMet) {
        return {
          shouldExecute: false,
          skipReason: `Condition ${step.condition} not met`,
        };
      }
    }

    return { shouldExecute: true };
  }

  /**
   * Execute a single step in the workflow chain
   *
   * @param step - The chain step to execute
   * @param context - The workflow context for condition evaluation
   * @returns Step execution result
   */
  async executeStep(step: ChainStep, context: WorkflowContext): Promise<StepExecutionResult> {
    // Check if step should be executed
    const { shouldExecute, skipReason } = this.shouldExecuteStep(step, context);

    if (!shouldExecute) {
      return {
        command: step.command,
        skipped: true,
        skipReason,
      };
    }

    // Check if it's a custom command (team: prefix)
    const commandName = parseCustomCommand(step.command);

    if (!commandName) {
      // Not a custom command - skip, handled by workflow engine
      return {
        command: step.command,
        skipped: true,
        skipReason: 'Standard command - handled by workflow engine',
      };
    }

    // Execute custom command using invokeCommand for team: prefixed commands
    try {
      const result = await this.customExecutor.invokeCommand(commandName);

      return {
        command: step.command,
        skipped: false,
        customCommandResult: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        command: step.command,
        skipped: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a workflow chain
   *
   * @param chain - The chain steps to execute
   * @param context - Optional workflow context for condition evaluation
   * @returns Chain execution result
   */
  async executeChain(
    chain: ChainStep[],
    context: WorkflowContext = {}
  ): Promise<ChainExecutionResult> {
    const executedSteps: StepExecutionResult[] = [];
    const warnings: string[] = [];
    let chainSuccess = true;
    let stoppedAt: string | undefined;

    for (const step of chain) {
      const isCustom = isCustomCommand(step.command);

      // Check if step should be executed
      const { shouldExecute, skipReason } = this.shouldExecuteStep(step, context);

      if (!shouldExecute) {
        executedSteps.push({
          command: step.command,
          skipped: true,
          skipReason,
        });
        continue;
      }

      // For standard commands, skip - they're handled by the workflow engine
      if (!isCustom) {
        executedSteps.push({
          command: step.command,
          skipped: true,
          skipReason: 'Standard command - handled by workflow engine',
        });
        continue;
      }

      // Execute custom command
      try {
        const result = await this.customExecutor.execute(step.command);

        executedSteps.push({
          command: step.command,
          skipped: false,
          customCommandResult: result,
        });

        // Check if we should stop the workflow
        if (this.customExecutor.shouldStopWorkflow(result)) {
          chainSuccess = false;
          stoppedAt = step.command;
          break;
        }

        // Add warning for non-blocking failure
        if (!result.success && !result.isBlocking) {
          warnings.push(
            `Custom command '${result.commandName}' failed (non-blocking): ${result.error}`
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        executedSteps.push({
          command: step.command,
          skipped: false,
          error: errorMessage,
        });

        // Errors are treated as blocking failures
        chainSuccess = false;
        stoppedAt = step.command;
        break;
      }
    }

    return {
      success: chainSuccess,
      executedSteps,
      warnings,
      stoppedAt,
    };
  }
}
