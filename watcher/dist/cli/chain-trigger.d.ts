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
import { readApiCredentials, type ApiCredentials } from '../api/api-credentials.js';
export { readApiCredentials, type ApiCredentials };
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
/** The only shape a printed CHAIN line can take (both name rules, G1) */
export declare const CHAIN_LINE_PATTERN: RegExp;
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