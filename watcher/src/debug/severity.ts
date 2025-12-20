/**
 * Severity Inference
 * Infers bug severity from error type and context
 */

import type { ParsedBug } from './bug-parser.js';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface SeverityResult {
  severity: SeverityLevel;
  confidence: number;
}

export interface QuestionParams {
  question: string;
  header: string;
  options: Array<{
    label: string;
    description: string;
  }>;
}

/**
 * Infer severity from bug details
 */
export function inferSeverity(bug: Partial<ParsedBug>): SeverityResult {
  // Security errors are critical
  if (bug.errorType?.includes('Security')) {
    return { severity: 'critical', confidence: 0.95 };
  }

  // Payment/data loss scenarios are high
  if (bug.component === 'payment') {
    return { severity: 'high', confidence: 0.8 };
  }

  // Default to medium with low confidence
  return { severity: 'medium', confidence: 0.6 };
}

/**
 * Create override question if confidence is low
 */
export function createSeverityQuestion(
  inferred: SeverityResult
): QuestionParams | null {
  if (inferred.confidence >= 0.7) {
    return null;
  }

  return {
    question: 'Please confirm or override the severity level:',
    header: `Inferred Severity: ${inferred.severity} (confidence: ${inferred.confidence})`,
    options: [
      { label: 'critical', description: 'Security, data loss, or system down' },
      { label: 'high', description: 'Major feature broken, no workaround' },
      { label: 'medium', description: 'Feature impaired, workaround exists' },
      { label: 'low', description: 'Minor issue, cosmetic' },
    ],
  };
}
