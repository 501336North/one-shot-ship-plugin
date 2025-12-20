/**
 * Investigation - Agent Delegation
 * Creates tasks for debugger agent and parses results
 */

import type { ParsedBug } from './bug-parser.js';

export interface TaskParams {
  subagent_type: string;
  prompt: string;
}

export interface RootCause {
  cause: string;
  evidence: string;
}

/**
 * Create investigation task for debugger agent
 */
export function createInvestigationTask(bug: ParsedBug): TaskParams {
  let prompt = `Investigate the following bug:\n\n`;
  prompt += `Error Type: ${bug.errorType}\n`;

  if (bug.message) {
    prompt += `Message: ${bug.message}\n`;
  }

  if (bug.component) {
    prompt += `Component: ${bug.component}\n`;
  }

  return {
    subagent_type: 'debugger',
    prompt,
  };
}

/**
 * Parse investigation results into root causes
 */
export function parseInvestigationResult(output: string): RootCause[] {
  const causes: RootCause[] = [];
  const lines = output.split('\n');

  let currentCause: string | null = null;

  for (const line of lines) {
    const causeMatch = line.match(/^Root Cause \d+:\s*(.+)/);
    if (causeMatch) {
      currentCause = causeMatch[1];
      continue;
    }

    const evidenceMatch = line.match(/^Evidence:\s*(.+)/);
    if (evidenceMatch && currentCause) {
      causes.push({
        cause: currentCause,
        evidence: evidenceMatch[1],
      });
      currentCause = null;
    }
  }

  return causes;
}
