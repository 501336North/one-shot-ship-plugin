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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CustomCommandExecutor, isCustomCommand, parseCustomCommand, } from '../engine/custom-command-executor.js';
import { getCachedOrFetch } from '../api/workflow-config.js';
const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';
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
        return {
            apiKey: config.apiKey,
            apiUrl: config.apiUrl || DEFAULT_API_URL,
        };
    }
    catch {
        return null;
    }
}
/**
 * Execute a single custom command
 *
 * @param commandName - The command name (without team: prefix)
 * @param credentials - API credentials
 * @returns Execution result
 */
export async function executeSingleCommand(commandName, credentials) {
    const executor = new CustomCommandExecutor({
        apiKey: credentials.apiKey,
        apiUrl: credentials.apiUrl,
    });
    const result = await executor.invokeCommand(commandName);
    return { success: result.success, error: result.error };
}
/**
 * Execute all custom commands in a workflow's chains_to
 *
 * @param workflowName - The workflow command name (e.g., 'build')
 * @param credentials - API credentials
 * @returns Chain execution result
 */
export async function executeChainForWorkflow(workflowName, credentials) {
    try {
        const config = await getCachedOrFetch(workflowName);
        if (!config.chains_to || config.chains_to.length === 0) {
            return { executed: 0, skipped: 0, errors: [] };
        }
        let executed = 0;
        let skipped = 0;
        const errors = [];
        const executor = new CustomCommandExecutor({
            apiKey: credentials.apiKey,
            apiUrl: credentials.apiUrl,
        });
        for (const step of config.chains_to) {
            if (!isCustomCommand(step.command)) {
                skipped++;
                continue;
            }
            const commandName = parseCustomCommand(step.command);
            if (!commandName) {
                skipped++;
                continue;
            }
            executed++;
            try {
                await executor.invokeCommand(commandName);
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                errors.push(`${commandName}: ${msg}`);
            }
        }
        return { executed, skipped, errors };
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
        console.error('Usage: chain-trigger.js --workflow <cmd> | --command <name>');
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
        if (result.executed > 0) {
            console.log(`Chain trigger: ${result.executed} custom command(s) executed, ${result.skipped} skipped`);
        }
        process.exit(0);
    }
    const cmdIndex = args.indexOf('--command');
    if (cmdIndex !== -1 && args[cmdIndex + 1]) {
        const commandName = args[cmdIndex + 1];
        const result = await executeSingleCommand(commandName, credentials);
        if (!result.success) {
            console.error(`Command failed: ${result.error}`);
            process.exit(1);
        }
        process.exit(0);
    }
    console.error('Usage: chain-trigger.js --workflow <cmd> | --command <name>');
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