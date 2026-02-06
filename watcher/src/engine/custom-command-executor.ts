/**
 * CustomCommandExecutor - Executes custom team commands with 'team:' prefix
 *
 * @behavior Detects commands with 'team:' prefix, fetches from API, executes
 * @responsibility Workflow engine integration for custom commands
 *
 * Custom commands are team-scoped commands created via the dashboard.
 * They are detected by the 'team:' prefix (e.g., 'team:review-standards').
 *
 * The executor:
 * 1. Detects if a command is a custom command
 * 2. Fetches the prompt from the API
 * 3. Returns the result with blocking behavior
 * 4. Workflow engine decides whether to stop or continue based on result
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * Configuration for the custom command executor
 */
export interface CustomCommandExecutorConfig {
  apiKey: string;
  apiUrl: string;
}

/**
 * Response from the custom command API
 */
export interface CustomCommandResponse {
  prompt: string;
  name: string;
  displayName?: string;
  isBlocking?: boolean;
}

/**
 * Result of executing a custom command
 */
export interface CustomCommandResult {
  success: boolean;
  commandName: string;
  displayName?: string;
  prompt?: string;
  error?: string;
  isBlocking: boolean;
}

/**
 * The prefix that identifies custom team commands
 */
const CUSTOM_COMMAND_PREFIX = 'team:';

/**
 * Check if a command is a custom team command
 *
 * @param command - The command name to check
 * @returns true if the command has the 'team:' prefix
 */
export function isCustomCommand(command: string): boolean {
  if (!command || command.length <= CUSTOM_COMMAND_PREFIX.length) {
    return false;
  }
  return command.startsWith(CUSTOM_COMMAND_PREFIX);
}

/**
 * Parse the custom command name from the prefixed format
 *
 * @param command - The full command string (e.g., 'team:review-standards')
 * @returns The command name without prefix, or null if not a custom command
 */
export function parseCustomCommand(command: string): string | null {
  if (!isCustomCommand(command)) {
    return null;
  }
  return command.substring(CUSTOM_COMMAND_PREFIX.length);
}

/**
 * Executor for custom team commands
 */
export class CustomCommandExecutor {
  private apiKey: string;
  private apiUrl: string;

  constructor(config: CustomCommandExecutorConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl;
  }

  /**
   * Fetch a custom command prompt from the API
   *
   * @param commandName - The command name (without 'team:' prefix)
   * @returns The custom command response or null if not found
   * @throws Error on authentication or subscription failures
   */
  async fetchCustomCommand(commandName: string): Promise<CustomCommandResponse | null> {
    const url = `${this.apiUrl}/api/v1/prompts/custom/${commandName}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      if (response.status === 401) {
        throw new Error('Authentication failed. Run /oss:login to refresh credentials.');
      }
      if (response.status === 403) {
        throw new Error('Subscription expired. Upgrade at: https://www.oneshotship.com/pricing');
      }
      const errorData = (await response.json().catch(() => ({ error: 'Request failed' }))) as {
        error?: string;
      };
      throw new Error(errorData.error || 'Request failed');
    }

    return response.json() as Promise<CustomCommandResponse>;
  }

  /**
   * Execute a command (custom or standard detection)
   *
   * @param command - The full command string (e.g., 'team:review-standards' or 'build')
   * @returns The execution result
   */
  async execute(command: string): Promise<CustomCommandResult> {
    // Check if it's a custom command
    const commandName = parseCustomCommand(command);

    if (!commandName) {
      // Not a custom command
      return {
        success: false,
        commandName: command,
        error: 'Not a custom command',
        isBlocking: false,
      };
    }

    try {
      const customCommand = await this.fetchCustomCommand(commandName);

      if (!customCommand) {
        return {
          success: false,
          commandName,
          error: `Custom command '${commandName}' not found`,
          isBlocking: false,
        };
      }

      return {
        success: true,
        commandName: customCommand.name,
        displayName: customCommand.displayName,
        prompt: customCommand.prompt,
        // Default to blocking=true if not specified
        isBlocking: customCommand.isBlocking !== false,
      };
    } catch (error) {
      return {
        success: false,
        commandName,
        error: error instanceof Error ? error.message : 'Unknown error',
        isBlocking: false,
      };
    }
  }

  /**
   * Determine if a workflow should stop based on the command result
   *
   * @param result - The custom command execution result
   * @returns true if the workflow should stop (blocking command failed)
   */
  shouldStopWorkflow(result: CustomCommandResult): boolean {
    // Stop workflow only if:
    // 1. Command failed (success === false)
    // 2. Command is blocking (isBlocking === true)
    return !result.success && result.isBlocking;
  }

  /**
   * Execute a shell command with error handling
   *
   * @param command - The shell command to execute
   * @returns Promise that resolves when command completes
   */
  private async runShellCommand(command: string): Promise<void> {
    try {
      await execAsync(command);
    } catch {
      // Shell command failures are non-fatal for logging/status
    }
  }

  /**
   * Invoke a custom command using the standard OSS command pattern
   *
   * This method:
   * 1. Initializes logging for supervisor visibility
   * 2. Updates status line to show command start
   * 3. Fetches the custom command prompt from API
   * 4. Updates status on completion or failure
   *
   * @param commandName - The command name (without 'team:' prefix)
   * @returns The execution result with prompt content
   */
  async invokeCommand(commandName: string): Promise<CustomCommandResult> {
    const hooksDir = join(homedir(), '.oss', 'hooks');
    const logScript = join(hooksDir, 'oss-log.sh');
    const notifyScript = join(hooksDir, 'oss-notify.sh');

    // Step 1: Initialize logging
    await this.runShellCommand(`${logScript} init custom`);

    // Step 2: Update status line (start)
    const startPayload = JSON.stringify({ command: commandName });
    await this.runShellCommand(
      `${notifyScript} --workflow custom start '${startPayload}'`
    );

    try {
      // Step 3: Fetch custom command from API
      const customCommand = await this.fetchCustomCommand(commandName);

      if (!customCommand) {
        // Command not found - update status with failure
        const failPayload = JSON.stringify({
          command: commandName,
          error: `Custom command '${commandName}' not found`,
        });
        await this.runShellCommand(
          `${notifyScript} --workflow custom failed '${failPayload}'`
        );

        return {
          success: false,
          commandName,
          error: `Custom command '${commandName}' not found`,
          isBlocking: false,
        };
      }

      // Step 4: Update status line (complete)
      const completePayload = JSON.stringify({ command: commandName });
      await this.runShellCommand(
        `${notifyScript} --workflow custom complete '${completePayload}'`
      );

      return {
        success: true,
        commandName: customCommand.name,
        displayName: customCommand.displayName,
        prompt: customCommand.prompt,
        isBlocking: customCommand.isBlocking !== false,
      };
    } catch (error) {
      // Update status with failure
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const failPayload = JSON.stringify({
        command: commandName,
        error: errorMsg,
      });
      await this.runShellCommand(
        `${notifyScript} --workflow custom failed '${failPayload}'`
      );

      return {
        success: false,
        commandName,
        error: errorMsg,
        isBlocking: false,
      };
    }
  }
}
