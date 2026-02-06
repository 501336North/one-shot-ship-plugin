/**
 * CustomCommandExecutor Tests
 *
 * @behavior Detects and executes custom commands with 'team:' prefix
 * @acceptance-criteria AC-CUSTOM-COMMAND.1 through AC-CUSTOM-COMMAND.8
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { exec } from 'child_process';

// Import implementation (will be created in GREEN phase)
import {
  CustomCommandExecutor,
  CustomCommandResult,
  isCustomCommand,
  parseCustomCommand,
} from '../../src/engine/custom-command-executor.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock child_process.exec for shell script calls
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

const mockExec = vi.mocked(exec);

describe('CustomCommandExecutor', () => {
  let executor: CustomCommandExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new CustomCommandExecutor({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.example.com',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Custom command detection
  // ==========================================================================

  describe('Command Detection', () => {
    /**
     * @behavior Detects commands with 'team:' prefix as custom commands
     * @acceptance-criteria AC-CUSTOM-COMMAND.1
     */
    test('should detect command with team: prefix as custom', () => {
      expect(isCustomCommand('team:review-standards')).toBe(true);
      expect(isCustomCommand('team:code-lint')).toBe(true);
      expect(isCustomCommand('team:notify-slack')).toBe(true);
    });

    /**
     * @behavior Does not detect standard commands as custom
     * @acceptance-criteria AC-CUSTOM-COMMAND.1
     */
    test('should not detect standard commands as custom', () => {
      expect(isCustomCommand('build')).toBe(false);
      expect(isCustomCommand('ship')).toBe(false);
      expect(isCustomCommand('ideate')).toBe(false);
      expect(isCustomCommand('plan')).toBe(false);
    });

    /**
     * @behavior Handles edge cases in command detection
     * @acceptance-criteria AC-CUSTOM-COMMAND.1
     */
    test('should handle edge cases in command names', () => {
      expect(isCustomCommand('')).toBe(false);
      expect(isCustomCommand('team:')).toBe(false);
      expect(isCustomCommand('TEAM:uppercase')).toBe(false); // Case sensitive
      expect(isCustomCommand('  team:with-spaces')).toBe(false); // No leading spaces
    });
  });

  // ==========================================================================
  // Custom command parsing
  // ==========================================================================

  describe('Command Parsing', () => {
    /**
     * @behavior Parses custom command name from prefixed format
     * @acceptance-criteria AC-CUSTOM-COMMAND.2
     */
    test('should parse command name from team: prefix', () => {
      expect(parseCustomCommand('team:review-standards')).toBe('review-standards');
      expect(parseCustomCommand('team:code-lint')).toBe('code-lint');
      expect(parseCustomCommand('team:my-custom-workflow')).toBe('my-custom-workflow');
    });

    /**
     * @behavior Returns null for non-custom commands
     * @acceptance-criteria AC-CUSTOM-COMMAND.2
     */
    test('should return null for non-custom commands', () => {
      expect(parseCustomCommand('build')).toBeNull();
      expect(parseCustomCommand('ship')).toBeNull();
      expect(parseCustomCommand('')).toBeNull();
    });
  });

  // ==========================================================================
  // API fetching
  // ==========================================================================

  describe('API Fetching', () => {
    /**
     * @behavior Fetches custom command prompt from API
     * @acceptance-criteria AC-CUSTOM-COMMAND.3
     */
    test('should fetch custom command prompt from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Custom Command\n\nDo the custom thing.',
          name: 'review-standards',
          displayName: 'Review Standards',
        }),
      });

      const result = await executor.fetchCustomCommand('review-standards');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/prompts/custom/review-standards',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
      expect(result).toEqual({
        prompt: '# Custom Command\n\nDo the custom thing.',
        name: 'review-standards',
        displayName: 'Review Standards',
      });
    });

    /**
     * @behavior Returns null when custom command not found
     * @acceptance-criteria AC-CUSTOM-COMMAND.4
     */
    test('should return null when custom command not found (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Custom command 'nonexistent' not found" }),
      });

      const result = await executor.fetchCustomCommand('nonexistent');

      expect(result).toBeNull();
    });

    /**
     * @behavior Throws on authentication failure
     * @acceptance-criteria AC-CUSTOM-COMMAND.4
     */
    test('should throw on authentication failure (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(executor.fetchCustomCommand('review-standards')).rejects.toThrow(
        'Authentication failed. Run /oss:login to refresh credentials.'
      );
    });

    /**
     * @behavior Throws on subscription expiry
     * @acceptance-criteria AC-CUSTOM-COMMAND.4
     */
    test('should throw on subscription expiry (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Subscription expired' }),
      });

      await expect(executor.fetchCustomCommand('review-standards')).rejects.toThrow(
        'Subscription expired. Upgrade at: https://www.oneshotship.com/pricing'
      );
    });
  });

  // ==========================================================================
  // Command execution
  // ==========================================================================

  describe('Command Execution', () => {
    /**
     * @behavior Executes custom command and returns success result
     * @acceptance-criteria AC-CUSTOM-COMMAND.5
     */
    test('should execute custom command and return success result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Review Standards\n\nCheck code quality.',
          name: 'review-standards',
          displayName: 'Review Standards',
          isBlocking: true,
        }),
      });

      const result = await executor.execute('team:review-standards');

      expect(result).toEqual({
        success: true,
        commandName: 'review-standards',
        displayName: 'Review Standards',
        prompt: '# Review Standards\n\nCheck code quality.',
        isBlocking: true,
      });
    });

    /**
     * @behavior Returns failure result when command not found
     * @acceptance-criteria AC-CUSTOM-COMMAND.6
     */
    test('should return failure result when command not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      });

      const result = await executor.execute('team:nonexistent');

      expect(result).toEqual({
        success: false,
        commandName: 'nonexistent',
        error: "Custom command 'nonexistent' not found",
        isBlocking: false,
      });
    });

    /**
     * @behavior Returns not-custom result for standard commands
     * @acceptance-criteria AC-CUSTOM-COMMAND.6
     */
    test('should return not-custom result for standard commands', async () => {
      const result = await executor.execute('build');

      expect(result).toEqual({
        success: false,
        commandName: 'build',
        error: 'Not a custom command',
        isBlocking: false,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Blocking behavior
  // ==========================================================================

  describe('Blocking Behavior', () => {
    /**
     * @behavior Correctly reports isBlocking=true for blocking commands
     * @acceptance-criteria AC-CUSTOM-COMMAND.7
     */
    test('should report isBlocking=true for blocking commands', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Blocking Command',
          name: 'must-pass',
          isBlocking: true,
        }),
      });

      const result = await executor.execute('team:must-pass');

      expect(result.isBlocking).toBe(true);
    });

    /**
     * @behavior Correctly reports isBlocking=false for warning-only commands
     * @acceptance-criteria AC-CUSTOM-COMMAND.8
     */
    test('should report isBlocking=false for warning-only commands', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Optional Command',
          name: 'optional-check',
          isBlocking: false,
        }),
      });

      const result = await executor.execute('team:optional-check');

      expect(result.isBlocking).toBe(false);
    });

    /**
     * @behavior Defaults to isBlocking=true when not specified
     * @acceptance-criteria AC-CUSTOM-COMMAND.7
     */
    test('should default to isBlocking=true when not specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Command',
          name: 'no-blocking-flag',
          // isBlocking not specified
        }),
      });

      const result = await executor.execute('team:no-blocking-flag');

      expect(result.isBlocking).toBe(true); // Default to blocking
    });
  });

  // ==========================================================================
  // Workflow chain integration
  // ==========================================================================

  describe('Workflow Chain Integration', () => {
    /**
     * @behavior shouldStopWorkflow returns true for blocking command failure
     * @acceptance-criteria AC-CUSTOM-COMMAND.7
     */
    test('shouldStopWorkflow returns true for blocking command failure', () => {
      const failedBlockingResult: CustomCommandResult = {
        success: false,
        commandName: 'must-pass',
        error: 'Command failed',
        isBlocking: true,
      };

      expect(executor.shouldStopWorkflow(failedBlockingResult)).toBe(true);
    });

    /**
     * @behavior shouldStopWorkflow returns false for non-blocking command failure
     * @acceptance-criteria AC-CUSTOM-COMMAND.8
     */
    test('shouldStopWorkflow returns false for non-blocking command failure', () => {
      const failedNonBlockingResult: CustomCommandResult = {
        success: false,
        commandName: 'optional-check',
        error: 'Command failed',
        isBlocking: false,
      };

      expect(executor.shouldStopWorkflow(failedNonBlockingResult)).toBe(false);
    });

    /**
     * @behavior shouldStopWorkflow returns false for successful command
     * @acceptance-criteria AC-CUSTOM-COMMAND.7
     */
    test('shouldStopWorkflow returns false for successful command', () => {
      const successResult: CustomCommandResult = {
        success: true,
        commandName: 'any-command',
        prompt: '# Command',
        isBlocking: true,
      };

      expect(executor.shouldStopWorkflow(successResult)).toBe(false);
    });
  });

  // ==========================================================================
  // invokeCommand - Command pattern with logging and status
  // ==========================================================================

  describe('invokeCommand', () => {
    beforeEach(() => {
      // Reset exec mock for each test
      mockExec.mockReset();
      // Default: shell commands succeed
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });
    });

    /**
     * @behavior invokeCommand initializes logging before execution
     * @acceptance-criteria AC-CUSTOM-COMMAND.9
     */
    test('invokeCommand initializes logging', async () => {
      // GIVEN - API returns valid command
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Custom Command',
          name: 'review-standards',
        }),
      });

      // WHEN - invokeCommand is called
      await executor.invokeCommand('review-standards');

      // THEN - oss-log.sh init custom should be called
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('oss-log.sh init custom'),
        expect.any(Function)
      );
    });

    /**
     * @behavior invokeCommand updates status line on start
     * @acceptance-criteria AC-CUSTOM-COMMAND.10
     */
    test('invokeCommand updates status on start', async () => {
      // GIVEN - API returns valid command
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Custom Command',
          name: 'review-standards',
        }),
      });

      // WHEN - invokeCommand is called
      await executor.invokeCommand('review-standards');

      // THEN - oss-notify.sh --workflow custom start should be called
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('oss-notify.sh --workflow custom start'),
        expect.any(Function)
      );
    });

    /**
     * @behavior invokeCommand returns prompt content on success
     * @acceptance-criteria AC-CUSTOM-COMMAND.11
     */
    test('invokeCommand returns prompt on success', async () => {
      // GIVEN - API returns valid command
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Review Standards\n\nCheck code quality.',
          name: 'review-standards',
          displayName: 'Review Standards',
          isBlocking: true,
        }),
      });

      // WHEN - invokeCommand is called
      const result = await executor.invokeCommand('review-standards');

      // THEN - Result contains prompt and success
      expect(result.success).toBe(true);
      expect(result.prompt).toBe('# Review Standards\n\nCheck code quality.');
      expect(result.commandName).toBe('review-standards');
      expect(result.displayName).toBe('Review Standards');
    });

    /**
     * @behavior invokeCommand updates status on failure
     * @acceptance-criteria AC-CUSTOM-COMMAND.12
     */
    test('invokeCommand updates status on failure', async () => {
      // GIVEN - API returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      });

      // WHEN - invokeCommand is called
      await executor.invokeCommand('nonexistent');

      // THEN - oss-notify.sh --workflow custom failed should be called
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('oss-notify.sh --workflow custom failed'),
        expect.any(Function)
      );
    });
  });

  // ==========================================================================
  // Integration: command pattern observability
  // ==========================================================================

  describe('Integration: command pattern observability', () => {
    beforeEach(() => {
      // Reset exec mock for each test
      mockExec.mockReset();
      // Default: shell commands succeed
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });
    });

    /**
     * @behavior invokeCommand calls oss-log.sh for logging integration
     * @acceptance-criteria AC-CUSTOM-COMMAND.13
     * @business-rule Custom commands must be observable via supervisor logging
     */
    test('invokeCommand calls oss-log.sh for logging', async () => {
      // GIVEN - API returns valid custom command
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Team Review Standards\n\nValidate code quality.',
          name: 'review-standards',
          displayName: 'Review Standards',
          isBlocking: true,
        }),
      });

      // WHEN - invokeCommand is called
      await executor.invokeCommand('review-standards');

      // THEN - oss-log.sh init custom is called for supervisor visibility
      const logCalls = mockExec.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('oss-log.sh')
      );

      expect(logCalls.length).toBeGreaterThanOrEqual(1);
      expect(logCalls[0][0]).toContain('oss-log.sh init custom');
    });

    /**
     * @behavior invokeCommand calls oss-notify.sh for status updates
     * @acceptance-criteria AC-CUSTOM-COMMAND.14
     * @business-rule Custom commands must update status line for user feedback
     */
    test('invokeCommand calls oss-notify.sh for status updates', async () => {
      // GIVEN - API returns valid custom command
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompt: '# Team Lint Check\n\nRun linting rules.',
          name: 'lint-check',
          displayName: 'Lint Check',
          isBlocking: false,
        }),
      });

      // WHEN - invokeCommand is called
      await executor.invokeCommand('lint-check');

      // THEN - oss-notify.sh is called with start and complete statuses
      const notifyCalls = mockExec.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('oss-notify.sh')
      );

      expect(notifyCalls.length).toBeGreaterThanOrEqual(2);

      // Verify start notification
      const startCall = notifyCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('--workflow custom start')
      );
      expect(startCall).toBeDefined();

      // Verify complete notification
      const completeCall = notifyCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('--workflow custom complete')
      );
      expect(completeCall).toBeDefined();
    });
  });
});
