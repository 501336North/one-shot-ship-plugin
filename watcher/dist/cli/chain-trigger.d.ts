#!/usr/bin/env node
/**
 * Chain Trigger CLI
 *
 * Executes custom command chains when a workflow command completes.
 * Called by oss-notify.sh on 'complete' events.
 *
 * @behavior Fetches workflow config, executes team: prefixed commands via CustomCommandExecutor
 * @acceptance-criteria AC-CHAIN-TRIGGER.1 through AC-CHAIN-TRIGGER.7
 *
 * Usage:
 *   node chain-trigger.js --workflow build    # Execute all team: chains for 'build'
 *   node chain-trigger.js --command my-cmd    # Execute a single custom command
 *
 * Exit codes:
 *   0 - Success (or no custom commands to execute)
 *   1 - Failure
 */
/**
 * API credentials structure
 */
export interface ApiCredentials {
    apiKey: string;
    apiUrl: string;
}
/**
 * Result of executing a workflow chain
 */
export interface ChainExecutionResult {
    executed: number;
    skipped: number;
    errors: string[];
    error?: string;
}
/**
 * Read API credentials from config file
 *
 * @param configDir - The config directory (defaults to ~/.oss)
 * @returns Credentials or null if not configured
 */
export declare function readApiCredentials(configDir?: string): ApiCredentials | null;
/**
 * Execute a single custom command
 *
 * @param commandName - The command name (without team: prefix)
 * @param credentials - API credentials
 * @returns Execution result
 */
export declare function executeSingleCommand(commandName: string, credentials: ApiCredentials): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * Execute all custom commands in a workflow's chains_to
 *
 * @param workflowName - The workflow command name (e.g., 'build')
 * @param credentials - API credentials
 * @returns Chain execution result
 */
export declare function executeChainForWorkflow(workflowName: string, credentials: ApiCredentials): Promise<ChainExecutionResult>;
//# sourceMappingURL=chain-trigger.d.ts.map