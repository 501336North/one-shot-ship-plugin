/**
 * Workflow Engine - Chain Executor Tests
 *
 * @behavior Command chains are executed in order with condition evaluation
 * @acceptance-criteria AC-WF-EXEC.1 through AC-WF-EXEC.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeChain,
  invokeCommand,
  setCommandInvoker,
  resetCommandInvoker,
} from '../../src/engine/executor.js';
import { WorkflowConfig, WorkflowContext, ChainResult } from '../../src/engine/types.js';

describe('ChainExecutor', () => {
  // Track invoked commands for testing
  const invokedCommands: string[] = [];
  const mockInvoker = vi.fn(async (command: string) => {
    invokedCommands.push(command);
  });

  beforeEach(() => {
    // Reset tracking
    invokedCommands.length = 0;
    mockInvoker.mockClear();
    // Set up mock invoker for testing
    setCommandInvoker(mockInvoker);
  });

  afterEach(() => {
    // Reset to default invoker
    resetCommandInvoker();
  });

  describe('executeChain', () => {
    it('should invoke Skill tool for command chains', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [
          { command: 'requirements', always: true },
        ],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {};

      // Act
      await executeChain(config, context);

      // Assert
      expect(mockInvoker).toHaveBeenCalledWith('requirements');
      expect(invokedCommands).toContain('requirements');
    });

    it('should skip optional chains when condition is false', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [
          { command: 'requirements', always: true },
          { command: 'api-design', condition: 'has_api_work' },
          { command: 'data-model', condition: 'has_db_work' },
          { command: 'adr', always: true },
        ],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {
        designContent: 'A simple UI-only feature with buttons and forms.',
      };

      // Act
      await executeChain(config, context);

      // Assert
      expect(invokedCommands).toContain('requirements');
      expect(invokedCommands).not.toContain('api-design');
      expect(invokedCommands).not.toContain('data-model');
      expect(invokedCommands).toContain('adr');
    });

    it('should execute chains in order', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [
          { command: 'first', always: true },
          { command: 'second', always: true },
          { command: 'third', always: true },
        ],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {};

      // Act
      await executeChain(config, context);

      // Assert
      expect(invokedCommands).toEqual(['first', 'second', 'third']);
    });

    it('should stop at human checkpoint', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [
          { command: 'requirements', always: true },
        ],
        checkpoint: 'human',
      };
      const context: WorkflowContext = {};

      // Act
      const result = await executeChain(config, context);

      // Assert
      expect(result.status).toBe('checkpoint');
      if (result.status === 'checkpoint') {
        expect(result.message).toContain('human');
      }
    });

    it('should continue at auto checkpoint', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [
          { command: 'requirements', always: true },
        ],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {};

      // Act
      const result = await executeChain(config, context);

      // Assert
      expect(result.status).toBe('completed');
    });

    it('should log chain execution', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [
          { command: 'requirements', always: true },
          { command: 'api-design', condition: 'has_api_work' },
        ],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {
        designContent: 'REST API with endpoints for user management.',
      };
      const logEntries: string[] = [];
      const mockLogger = (message: string) => {
        logEntries.push(message);
      };

      // Act
      await executeChain(config, context, mockLogger);

      // Assert
      expect(logEntries.length).toBeGreaterThan(0);
      expect(logEntries.some((entry) => entry.includes('requirements'))).toBe(true);
      expect(logEntries.some((entry) => entry.includes('api-design'))).toBe(true);
    });

    it('should handle empty chains gracefully', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {};

      // Act
      const result = await executeChain(config, context);

      // Assert
      expect(result.status).toBe('completed');
      expect(invokedCommands).toEqual([]);
    });

    it('should handle missing chains_to gracefully', async () => {
      // Arrange
      const config: WorkflowConfig = {
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {};

      // Act
      const result = await executeChain(config, context);

      // Assert
      expect(result.status).toBe('completed');
    });

    it('should handle command errors gracefully', async () => {
      // Arrange
      const errorInvoker = vi.fn(async (command: string) => {
        if (command === 'failing-command') {
          throw new Error('Command failed');
        }
      });
      setCommandInvoker(errorInvoker);

      const config: WorkflowConfig = {
        chains_to: [
          { command: 'failing-command', always: true },
        ],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {};

      // Act
      const result = await executeChain(config, context);

      // Assert
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Command failed');
      }
    });

    it('should execute conditional chains when condition is true', async () => {
      // Arrange
      const config: WorkflowConfig = {
        chains_to: [
          { command: 'api-design', condition: 'has_api_work' },
          { command: 'data-model', condition: 'has_db_work' },
        ],
        checkpoint: 'auto',
      };
      const context: WorkflowContext = {
        designContent: 'REST API with PostgreSQL database schema.',
      };

      // Act
      await executeChain(config, context);

      // Assert
      expect(invokedCommands).toContain('api-design');
      expect(invokedCommands).toContain('data-model');
    });
  });

  describe('invokeCommand', () => {
    it('should call the configured invoker', async () => {
      // Arrange
      const testInvoker = vi.fn();
      setCommandInvoker(testInvoker);

      // Act
      await invokeCommand('test-command');

      // Assert
      expect(testInvoker).toHaveBeenCalledWith('test-command');
    });
  });
});
