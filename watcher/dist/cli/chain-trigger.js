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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getCachedOrFetch } from '../api/workflow-config.js';
const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';
/** Maximum number of chain commands to output (H-4: prevent runaway chains) */
export const MAX_CHAIN_COMMANDS = 10;
/**
 * Read API credentials from config file
 *
 * @param configDir - The config directory (defaults to ~/.oss)
 * @returns Credentials or null if not configured
 */
export function readApiCredentials(configDir) {
    const dir = configDir || path.join(os.homedir(), '.oss');
    const configPath = path.join(dir, 'config.json');
    if (!fs.existsSync(configPath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);
        if (!config.apiKey) {
            return null;
        }
        // M-2: Validate API URL protocol - reject non-HTTPS to prevent MitM
        const apiUrl = config.apiUrl || DEFAULT_API_URL;
        try {
            const parsed = new URL(apiUrl);
            if (parsed.protocol !== 'https:') {
                return null;
            }
        }
        catch {
            return null;
        }
        return {
            apiKey: config.apiKey,
            apiUrl,
        };
    }
    catch {
        return null;
    }
}
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
export async function executeChainForWorkflow(workflowName, _credentials) {
    try {
        const config = await getCachedOrFetch(workflowName);
        if (!config.chains_to || config.chains_to.length === 0) {
            return { executed: 0, skipped: 0, errors: [] };
        }
        let executed = 0;
        const lines = [];
        for (const step of config.chains_to) {
            // H-4: Cap output to prevent runaway chains from malicious config
            if (executed >= MAX_CHAIN_COMMANDS) {
                break;
            }
            const condition = step.always ? 'always' : step.condition ? `condition: ${step.condition}` : 'always';
            if (step.command.startsWith('team:')) {
                const cmdName = step.command.substring(5);
                lines.push(`CHAIN: /oss:oss-custom ${cmdName} (${condition})`);
            }
            else {
                lines.push(`CHAIN: /oss:${step.command} (${condition})`);
            }
            executed++;
        }
        if (lines.length > 0) {
            console.log('---CHAIN_COMMANDS---');
            for (const line of lines) {
                console.log(line);
            }
            console.log('---END_CHAIN_COMMANDS---');
        }
        return { executed, skipped: 0, errors: [] };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return { executed: 0, skipped: 0, errors: [], error: msg };
    }
}
// =============================================================================
// CLI Entry Point
// =============================================================================
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: chain-trigger.js --workflow <cmd>');
        process.exit(1);
    }
    const credentials = readApiCredentials();
    if (!credentials) {
        console.error('No API key configured. Run /oss:login');
        process.exit(1);
    }
    const flagIndex = args.indexOf('--workflow');
    if (flagIndex !== -1 && args[flagIndex + 1]) {
        const workflowName = args[flagIndex + 1];
        const result = await executeChainForWorkflow(workflowName, credentials);
        if (result.error) {
            console.error(`Chain trigger error: ${result.error}`);
            process.exit(1);
        }
        process.exit(0);
    }
    console.error('Usage: chain-trigger.js --workflow <cmd>');
    process.exit(1);
}
// Only run main when executed directly (not imported by tests)
const isDirectExecution = process.argv[1]?.endsWith('chain-trigger.js');
if (isDirectExecution) {
    main().catch((error) => {
        console.error(`Chain trigger fatal error: ${error}`);
        process.exit(1);
    });
}
//# sourceMappingURL=chain-trigger.js.map