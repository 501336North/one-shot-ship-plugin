/**
 * Confirmation Flow
 * Presents root causes to user and captures selection
 */

import type { RootCause } from './investigation.js';

export interface QuestionParams {
  question: string;
  header: string;
  options: Array<{
    label: string;
    description: string;
  }>;
}

/**
 * Format root causes as markdown list with evidence
 */
export function formatRootCauses(causes: RootCause[]): string {
  return causes
    .map((cause, index) => {
      return `${index + 1}. ${cause.cause}\n   Evidence: ${cause.evidence}`;
    })
    .join('\n');
}

/**
 * Create question params for AskUserQuestion tool
 */
export function createConfirmationQuestion(causes: RootCause[]): QuestionParams {
  return {
    question: 'Which root cause should we investigate?',
    header: 'Root Causes Found',
    options: causes.map((cause) => ({
      label: cause.cause,
      description: cause.evidence,
    })),
  };
}

/**
 * Check if auto-confirm is appropriate (single cause)
 */
export function shouldAutoConfirm(causes: RootCause[]): boolean {
  return causes.length === 1;
}
