#!/usr/bin/env node
/**
 * Chain Trigger CLI
 *
 * Outputs structured chain instructions when a workflow command completes.
 * Called by oss-notify.sh on 'complete' events. Claude reads the output
 * and invokes each command as a skill.
 *
 * @behavior Fetches workflow config, outputs CHAIN: lines for Claude to invoke
 * @acceptance-criteria AC-CHAIN-TRIGGER.1 through AC-CHAIN-TRIGGER.8
 *
 * Usage:
 *   node chain-trigger.js --workflow build    # Output chain instructions for 'build'
 *
 * Exit codes:
 *   0 - Success (or no commands to output)
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
 * Result of outputting chain instructions
 */
export interface ChainExecutionResult {
    executed: number;
    skipped: number;
    errors: string[];
    error?: string;
}
/** Maximum number of chain commands to output (H-4: prevent runaway chains) */
export declare const MAX_CHAIN_COMMANDS = 10;
/**
 * Read API credentials from config file
 *
 * @param configDir - The config directory (defaults to ~/.oss)
 * @returns Credentials or null if not configured
 */
export declare function readApiCredentials(configDir?: string): ApiCredentials | null;
/**
 * Output structured chain instructions for a workflow's chains_to.
 *
 * Prints CHAIN: lines to stdout so Claude can read them in the Bash tool
 * result and invoke each command as a skill.
 *
 * For team:X commands → CHAIN: /oss:oss-custom X (always|condition: Y)
 * For standard commands → CHAIN: /oss:X (always|condition: Y)
 *
 * @param workflowName - The workflow command name (e.g., 'build')
 * @param _credentials - API credentials (used for getCachedOrFetch auth)
 * @returns Chain execution result with count of commands output
 */
export declare function executeChainForWorkflow(workflowName: string, _credentials: ApiCredentials): Promise<ChainExecutionResult>;
//# sourceMappingURL=chain-trigger.d.ts.map