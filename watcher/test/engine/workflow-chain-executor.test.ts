/**
 * WorkflowChainExecutor Tests
 *
 * @behavior Executes workflow chains including custom commands
 * @acceptance-criteria AC-WORKFLOW-CHAIN.1 through AC-WORKFLOW-CHAIN.8
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

// Import implementation (will be created in GREEN phase)
import {
  WorkflowChainExecutor,
  ChainExecutionResult,
  ChainStep,
} from '../../src/engine/workflow-chain-executor.js';

// Mock the custom command executor
vi.mock('../../src/engine/custom-command-executor.js', () => ({
  CustomCommandExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
    invokeCommand: vi.fn(),
    shouldStopWorkflow: vi.fn(),
  })),
  isCustomCommand: vi.fn(),
  parseCustomCommand: vi.fn(),
}));

import { CustomCommandExecutor, isCustomCommand, parseCustomCommand } from '../../src/engine/custom-command-executor.js';

describe('WorkflowChainExecutor', () => {
  let executor: WorkflowChainExecutor;
  let mockCustomExecutor: {
    execute: ReturnType<typeof vi.fn>;
    invokeCommand: ReturnType<typeof vi.fn>;
    shouldStopWorkflow: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up mock custom executor
    mockCustomExecutor = {
      execute: vi.fn(),
      invokeCommand: vi.fn(),
      shouldStopWorkflow: vi.fn(),
    };

    (CustomCommandExecutor as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockCustomExecutor);

    executor = new WorkflowChainExecutor({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.example.com',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Chain step classification
  // ==========================================================================

  describe('Chain Step Classification', () => {
    /**
     * @behavior Identifies custom command steps in chain
     * @acceptance-criteria AC-WORKFLOW-CHAIN.1
     */
    test('should identify custom command steps', () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string) => cmd.startsWith('team:')
      );

      const chain: ChainStep[] = [
        { command: 'build', always: true },
        { command: 'team:review-standards', always: true },
        { command: 'ship', always: true },
      ];

      const classified = executor.classifyChainSteps(chain);

      expect(classified).toEqual([
        { step: chain[0], isCustom: false },
        { step: chain[1], isCustom: true },
        { step: chain[2], isCustom: false },
      ]);
    });
  });

  // ==========================================================================
  // Chain execution with custom commands
  // ==========================================================================

  describe('Chain Execution', () => {
    /**
     * @behavior Executes chain with custom commands in sequence
     * @acceptance-criteria AC-WORKFLOW-CHAIN.2
     */
    test('should execute chain with custom commands in sequence', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string) => cmd.startsWith('team:')
      );

      mockCustomExecutor.execute.mockResolvedValue({
        success: true,
        commandName: 'review-standards',
        prompt: '# Review',
        isBlocking: true,
      });
      mockCustomExecutor.shouldStopWorkflow.mockReturnValue(false);

      const chain: ChainStep[] = [
        { command: 'team:review-standards', always: true },
      ];

      const result = await executor.executeChain(chain);

      expect(result.success).toBe(true);
      expect(result.executedSteps).toHaveLength(1);
      expect(result.executedSteps[0].command).toBe('team:review-standards');
      expect(result.executedSteps[0].customCommandResult).toBeDefined();
    });

    /**
     * @behavior Skips custom command execution for standard commands
     * @acceptance-criteria AC-WORKFLOW-CHAIN.3
     */
    test('should skip custom executor for standard commands', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const chain: ChainStep[] = [
        { command: 'build', always: true },
      ];

      const result = await executor.executeChain(chain);

      expect(mockCustomExecutor.execute).not.toHaveBeenCalled();
      expect(result.executedSteps[0].skipped).toBe(true);
      expect(result.executedSteps[0].skipReason).toBe('Standard command - handled by workflow engine');
    });
  });

  // ==========================================================================
  // Blocking behavior
  // ==========================================================================

  describe('Blocking Behavior', () => {
    /**
     * @behavior Stops chain when blocking custom command fails
     * @acceptance-criteria AC-WORKFLOW-CHAIN.4
     */
    test('should stop chain when blocking custom command fails', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

      mockCustomExecutor.execute.mockResolvedValue({
        success: false,
        commandName: 'must-pass',
        error: 'Command failed',
        isBlocking: true,
      });
      mockCustomExecutor.shouldStopWorkflow.mockReturnValue(true);

      const chain: ChainStep[] = [
        { command: 'team:must-pass', always: true },
        { command: 'team:next-step', always: true },
      ];

      const result = await executor.executeChain(chain);

      expect(result.success).toBe(false);
      expect(result.stoppedAt).toBe('team:must-pass');
      expect(result.executedSteps).toHaveLength(1);
      expect(mockCustomExecutor.execute).toHaveBeenCalledTimes(1);
    });

    /**
     * @behavior Continues chain when non-blocking custom command fails
     * @acceptance-criteria AC-WORKFLOW-CHAIN.5
     */
    test('should continue chain when non-blocking custom command fails', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

      mockCustomExecutor.execute
        .mockResolvedValueOnce({
          success: false,
          commandName: 'optional-check',
          error: 'Check failed',
          isBlocking: false,
        })
        .mockResolvedValueOnce({
          success: true,
          commandName: 'next-step',
          prompt: '# Next',
          isBlocking: true,
        });
      mockCustomExecutor.shouldStopWorkflow.mockReturnValue(false);

      const chain: ChainStep[] = [
        { command: 'team:optional-check', always: true },
        { command: 'team:next-step', always: true },
      ];

      const result = await executor.executeChain(chain);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain("Custom command 'optional-check' failed (non-blocking): Check failed");
      expect(mockCustomExecutor.execute).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // Condition evaluation
  // ==========================================================================

  describe('Condition Evaluation', () => {
    /**
     * @behavior Skips conditional step when condition is false
     * @acceptance-criteria AC-WORKFLOW-CHAIN.6
     */
    test('should skip conditional step when condition is false', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const chain: ChainStep[] = [
        { command: 'team:ui-review', condition: 'has_ui_work' },
      ];

      const context = { has_ui_work: false };
      const result = await executor.executeChain(chain, context);

      expect(result.executedSteps[0].skipped).toBe(true);
      expect(result.executedSteps[0].skipReason).toBe('Condition has_ui_work not met');
      expect(mockCustomExecutor.execute).not.toHaveBeenCalled();
    });

    /**
     * @behavior Executes conditional step when condition is true
     * @acceptance-criteria AC-WORKFLOW-CHAIN.6
     */
    test('should execute conditional step when condition is true', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

      mockCustomExecutor.execute.mockResolvedValue({
        success: true,
        commandName: 'ui-review',
        prompt: '# UI Review',
        isBlocking: true,
      });
      mockCustomExecutor.shouldStopWorkflow.mockReturnValue(false);

      const chain: ChainStep[] = [
        { command: 'team:ui-review', condition: 'has_ui_work' },
      ];

      const context = { has_ui_work: true };
      const result = await executor.executeChain(chain, context);

      expect(result.executedSteps[0].skipped).toBe(false);
      expect(mockCustomExecutor.execute).toHaveBeenCalled();
    });

    /**
     * @behavior Executes step with always=true regardless of conditions
     * @acceptance-criteria AC-WORKFLOW-CHAIN.6
     */
    test('should execute step with always=true', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

      mockCustomExecutor.execute.mockResolvedValue({
        success: true,
        commandName: 'mandatory-check',
        prompt: '# Check',
        isBlocking: true,
      });
      mockCustomExecutor.shouldStopWorkflow.mockReturnValue(false);

      const chain: ChainStep[] = [
        { command: 'team:mandatory-check', always: true },
      ];

      const context = {}; // No conditions set
      const result = await executor.executeChain(chain, context);

      expect(result.executedSteps[0].skipped).toBe(false);
      expect(mockCustomExecutor.execute).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Error handling
  // ==========================================================================

  describe('Error Handling', () => {
    /**
     * @behavior Handles API errors gracefully
     * @acceptance-criteria AC-WORKFLOW-CHAIN.7
     */
    test('should handle API errors gracefully', async () => {
      (isCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

      mockCustomExecutor.execute.mockRejectedValue(new Error('Network error'));

      const chain: ChainStep[] = [
        { command: 'team:failing-command', always: true },
      ];

      const result = await executor.executeChain(chain);

      expect(result.success).toBe(false);
      expect(result.executedSteps[0].error).toBe('Network error');
    });

    /**
     * @behavior Returns empty result for empty chain
     * @acceptance-criteria AC-WORKFLOW-CHAIN.8
     */
    test('should return success for empty chain', async () => {
      const result = await executor.executeChain([]);

      expect(result.success).toBe(true);
      expect(result.executedSteps).toHaveLength(0);
    });
  });

  // ==========================================================================
  // executeStep with invokeCommand for custom commands
  // ==========================================================================

  describe('executeStep with invokeCommand', () => {
    /**
     * @behavior executeStep detects team: prefix
     * @acceptance-criteria AC-WORKFLOW-CHAIN.9
     */
    test('executeStep detects team: prefix', async () => {
      const step: ChainStep = { command: 'team:review-standards', always: true };
      const context = {};

      // Mock parseCustomCommand to return the command name (detects team: prefix)
      (parseCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue('review-standards');

      // Mock invokeCommand to verify it's called
      mockCustomExecutor.invokeCommand.mockResolvedValue({
        success: true,
        commandName: 'review-standards',
        prompt: '# Review Standards',
        isBlocking: true,
      });

      const result = await executor.executeStep(step, context);

      // Should detect team: prefix and call invokeCommand
      expect(result.customCommandResult).toBeDefined();
      expect(result.command).toBe('team:review-standards');
    });

    /**
     * @behavior executeStep uses invokeCommand for custom commands
     * @acceptance-criteria AC-WORKFLOW-CHAIN.10
     */
    test('executeStep uses invokeCommand for custom commands', async () => {
      const step: ChainStep = { command: 'team:code-review', always: true };
      const context = {};

      // Mock parseCustomCommand to return the command name
      (parseCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue('code-review');

      // Mock invokeCommand
      mockCustomExecutor.invokeCommand.mockResolvedValue({
        success: true,
        commandName: 'code-review',
        prompt: '# Code Review Prompt',
        isBlocking: false,
      });

      await executor.executeStep(step, context);

      // Should call invokeCommand with the command name (without team: prefix)
      expect(mockCustomExecutor.invokeCommand).toHaveBeenCalledWith('code-review');
      // Should NOT call execute (the old method)
      expect(mockCustomExecutor.execute).not.toHaveBeenCalled();
    });

    /**
     * @behavior executeStep handles blocking custom commands
     * @acceptance-criteria AC-WORKFLOW-CHAIN.11
     */
    test('executeStep handles blocking custom commands', async () => {
      const step: ChainStep = { command: 'team:blocking-check', always: true };
      const context = {};

      // Mock parseCustomCommand to return the command name
      (parseCustomCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue('blocking-check');

      // Mock invokeCommand returning a blocking result
      mockCustomExecutor.invokeCommand.mockResolvedValue({
        success: false,
        commandName: 'blocking-check',
        error: 'Check failed',
        isBlocking: true,
      });

      const result = await executor.executeStep(step, context);

      // Should return the result with isBlocking=true for workflow to handle
      expect(result.customCommandResult).toBeDefined();
      expect(result.customCommandResult!.isBlocking).toBe(true);
      expect(result.customCommandResult!.success).toBe(false);
    });
  });
});
