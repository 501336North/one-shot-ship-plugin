/**
 * Chain Trigger CLI Tests
 *
 * @behavior Chain trigger fetches workflow config and executes custom commands
 * @acceptance-criteria AC-CHAIN-TRIGGER.1 through AC-CHAIN-TRIGGER.7
 * @business-rule Custom commands in chains_to with team: prefix are auto-executed on complete
 * @boundary CLI
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../src/engine/custom-command-executor.js', () => {
  const mockInvoke = vi.fn();
  return {
    CustomCommandExecutor: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.invokeCommand = mockInvoke;
      return this;
    }),
    isCustomCommand: vi.fn((cmd: string) => cmd.startsWith('team:')),
    parseCustomCommand: vi.fn((cmd: string) =>
      cmd.startsWith('team:') ? cmd.substring(5) : null
    ),
  };
});

vi.mock('../../src/api/workflow-config.js', () => ({
  getCachedOrFetch: vi.fn(),
}));

import {
  CustomCommandExecutor,
  isCustomCommand,
} from '../../src/engine/custom-command-executor.js';
import { getCachedOrFetch } from '../../src/api/workflow-config.js';

// Import the module under test (will be created in GREEN phase)
import {
  readApiCredentials,
  executeChainForWorkflow,
  executeSingleCommand,
} from '../../src/cli/chain-trigger.js';

describe('Chain Trigger CLI', () => {
  let mockInvokeCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockInvokeCommand = vi.fn().mockResolvedValue({
      success: true,
      commandName: 'test-cmd',
      isBlocking: false,
    });

    (CustomCommandExecutor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (this: Record<string, unknown>) {
        this.invokeCommand = mockInvokeCommand;
        return this;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // AC-CHAIN-TRIGGER.1: Read API credentials
  // ==========================================================================

  describe('readApiCredentials', () => {
    test('should return apiKey and apiUrl from config', () => {
      const result = readApiCredentials('/tmp/test-oss');
      // Function should return { apiKey, apiUrl } or null
      expect(result).toBeDefined();
    });

    test('should return null when config file is missing', () => {
      const result = readApiCredentials('/nonexistent/path');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // AC-CHAIN-TRIGGER.2: Execute single custom command
  // ==========================================================================

  describe('executeSingleCommand', () => {
    test('should invoke CustomCommandExecutor with command name', async () => {
      const result = await executeSingleCommand('my-lint-check', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      expect(CustomCommandExecutor).toHaveBeenCalledWith({
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });
      expect(mockInvokeCommand).toHaveBeenCalledWith('my-lint-check');
      expect(result.success).toBe(true);
    });

    test('should return failure when command execution fails', async () => {
      mockInvokeCommand.mockResolvedValue({
        success: false,
        commandName: 'bad-cmd',
        error: 'Not found',
        isBlocking: false,
      });

      const result = await executeSingleCommand('bad-cmd', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // AC-CHAIN-TRIGGER.3: Execute chain for workflow
  // ==========================================================================

  describe('executeChainForWorkflow', () => {
    test('should fetch workflow config and execute team: commands', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'team:lint-check', always: true },
          { command: 'ship' },
          { command: 'team:notify-slack', always: true },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      const result = await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      expect(getCachedOrFetch).toHaveBeenCalledWith('build');
      // Should invoke 2 custom commands (lint-check, notify-slack), skip 'ship'
      expect(mockInvokeCommand).toHaveBeenCalledTimes(2);
      expect(mockInvokeCommand).toHaveBeenCalledWith('lint-check');
      expect(mockInvokeCommand).toHaveBeenCalledWith('notify-slack');
      expect(result.executed).toBe(2);
      expect(result.skipped).toBe(1);
    });

    test('should skip all when no chains_to configured', async () => {
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const result = await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      expect(mockInvokeCommand).not.toHaveBeenCalled();
      expect(result.executed).toBe(0);
    });

    test('should skip all when chains_to has no team: commands', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'acceptance', always: true },
          { command: 'integration' },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      const result = await executeChainForWorkflow('plan', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      expect(mockInvokeCommand).not.toHaveBeenCalled();
      expect(result.executed).toBe(0);
      expect(result.skipped).toBe(2);
    });

    test('should continue on non-blocking command failure', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'team:failing-cmd', always: true },
          { command: 'team:second-cmd', always: true },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      mockInvokeCommand
        .mockResolvedValueOnce({
          success: false,
          commandName: 'failing-cmd',
          error: 'API error',
          isBlocking: false,
        })
        .mockResolvedValueOnce({
          success: true,
          commandName: 'second-cmd',
          isBlocking: false,
        });

      const result = await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      // Both should be attempted (non-blocking failure doesn't stop chain)
      expect(mockInvokeCommand).toHaveBeenCalledTimes(2);
      expect(result.executed).toBe(2);
    });

    test('should handle workflow config fetch error gracefully', async () => {
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const result = await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      expect(result.executed).toBe(0);
      expect(result.error).toBeDefined();
    });
  });
});
