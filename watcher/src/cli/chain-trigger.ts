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
import { isSafeTeamCommandName } from '../utils/safe-chain-name.js';
import { WORKFLOW_NAME_PATTERN, isValidWorkflowName } from '../utils/workflow-name.js';
import type { ChainItem } from '../engine/types.js';

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

/** G4: bound the steps a hostile config can make us look at, and the skip lines it can log */
const MAX_STEPS_ITERATED = MAX_CHAIN_COMMANDS * 10;
const MAX_SKIP_LOG_LINES = 5;

/** A chains_to condition is a plain identifier (T1: no CR/LF, delimiters or parens) */
const SAFE_CONDITION = /^[a-z0-9_-]{1,64}$/;

/** The only shape a printed CHAIN line can take (both name rules, G1) */
export const CHAIN_LINE_PATTERN = new RegExp(
  `^CHAIN: \\/oss:(${WORKFLOW_NAME_PATTERN.source.slice(1, -1)}|oss-custom [a-z0-9-]{1,100}) \\((always|condition: [a-z0-9_-]{1,64})\\)$`
);

/** Keep printable ASCII only and truncate so a rejected value cannot shape stderr (G4) */
function safeForLog(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?').slice(0, 60);
}

/** G3: config is untrusted JSON - a step must be an object with a string command and string-or-absent condition */
function isChainItemShape(value: unknown): value is ChainItem {
  if (typeof value !== 'object' || value === null) return false;
  const { command, condition } = value as Record<string, unknown>;
  return typeof command === 'string' && (condition === undefined || typeof condition === 'string');
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

    const rawSteps: unknown = config.chains_to;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return { executed: 0, skipped: 0, errors: [] };
    }
    const steps: readonly unknown[] = rawSteps;

    let executed = 0;
    let skipped = 0;
    const lines: string[] = [];
    const skip = (message: string): void => {
      skipped++;
      if (skipped <= MAX_SKIP_LOG_LINES) {
        console.error(message);
      }
    };

    const stepCount = Math.min(steps.length, MAX_STEPS_ITERATED);
    for (let i = 0; i < stepCount; i++) {
      // H-4: Cap printed lines to prevent runaway chains from malicious config
      if (executed >= MAX_CHAIN_COMMANDS) {
        break;
      }

      const step = steps[i];

      if (!isChainItemShape(step)) {
        skip('chain-trigger: skipping malformed chains_to step');
        continue;
      }

      // G2: "never" switches a step off; it is not an invalid step
      if (step.condition === 'never') {
        continue;
      }

      const isTeam = step.command.startsWith('team:');
      const cmdName = isTeam ? step.command.substring(5) : step.command;

      // T1: config values are untrusted; never copy a non-slug into a CHAIN line
      const nameIsSafe = isTeam ? isSafeTeamCommandName(cmdName) : isValidWorkflowName(cmdName);
      const conditionIsSafe = step.condition === undefined || SAFE_CONDITION.test(step.condition);
      if (!nameIsSafe || !conditionIsSafe) {
        skip(`chain-trigger: skipping invalid chains_to step "${safeForLog(step.command)}"`);
        continue;
      }

      const condition = step.always === true ? 'always' : step.condition ? `condition: ${step.condition}` : 'always';

      if (isTeam) {
        lines.push(`CHAIN: /oss:oss-custom ${cmdName} (${condition})`);
      } else {
        lines.push(`CHAIN: /oss:${cmdName} (${condition})`);
      }

      executed++;
    }

    if (skipped > MAX_SKIP_LOG_LINES) {
      console.error(`chain-trigger: ${skipped - MAX_SKIP_LOG_LINES} more invalid steps skipped`);
    }

    // D3: say how many steps past the read limit were never looked at (not a skip, no cap)
    if (steps.length > MAX_STEPS_ITERATED) {
      console.error(
        `chain-trigger: ${steps.length - MAX_STEPS_ITERATED} steps beyond the ${MAX_STEPS_ITERATED}-step read limit ignored`
      );
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
