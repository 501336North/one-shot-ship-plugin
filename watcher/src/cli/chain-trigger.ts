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

import { getCachedOrFetch } from '../api/workflow-config.js';
import { readApiCredentials, type ApiCredentials } from '../api/api-credentials.js';
import { isSafeChainName, isSafeTeamCommandName } from '../utils/safe-chain-name.js';

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
export const MAX_CHAIN_COMMANDS = 10;

/** A chains_to condition is a plain identifier (T1: no CR/LF, delimiters or parens) */
const SAFE_CONDITION = /^[a-z0-9_-]{1,64}$/;

/** The only shape a printed CHAIN line can take (both name rules, G1) */
export const CHAIN_LINE_PATTERN =
  /^CHAIN: \/oss:([a-z][a-z0-9-]{0,40}|oss-custom [a-z0-9-]{1,128}) \((always|condition: [a-z0-9_-]{1,64})\)$/;

/** Strip control characters and truncate so a rejected value cannot shape stderr */
function safeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 60);
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
export async function executeChainForWorkflow(
  workflowName: string,
  _credentials: ApiCredentials
): Promise<ChainExecutionResult> {
  try {
    const config = await getCachedOrFetch(workflowName);

    if (!config.chains_to || config.chains_to.length === 0) {
      return { executed: 0, skipped: 0, errors: [] };
    }

    let executed = 0;
    let skipped = 0;
    const lines: string[] = [];

    for (const step of config.chains_to) {
      // H-4: Cap printed lines to prevent runaway chains from malicious config
      if (executed >= MAX_CHAIN_COMMANDS) {
        break;
      }

      // G2: "never" switches a step off; it is not an invalid step
      if (step.condition === 'never') {
        continue;
      }

      const isTeam = step.command.startsWith('team:');
      const cmdName = isTeam ? step.command.substring(5) : step.command;

      // T1: config values are untrusted; never copy a non-slug into a CHAIN line
      if (!(isTeam ? isSafeTeamCommandName(cmdName) : isSafeChainName(cmdName)) || (step.condition !== undefined && !SAFE_CONDITION.test(step.condition))) {
        console.error(`chain-trigger: skipping invalid chains_to step "${safeForLog(step.command)}"`);
        skipped++;
        continue;
      }

      const condition = step.always ? 'always' : step.condition ? `condition: ${step.condition}` : 'always';

      if (isTeam) {
        lines.push(`CHAIN: /oss:oss-custom ${cmdName} (${condition})`);
      } else {
        lines.push(`CHAIN: /oss:${cmdName} (${condition})`);
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

    return { executed, skipped, errors: [] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { executed: 0, skipped: 0, errors: [], error: msg };
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main(): Promise<void> {
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
// Matches both .js (tsc) and .cjs (esbuild bundle) extensions
const isDirectExecution = /chain-trigger\.(js|cjs)$/.test(process.argv[1] || '');
if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Chain trigger fatal error: ${error}`);
    process.exit(1);
  });
}
