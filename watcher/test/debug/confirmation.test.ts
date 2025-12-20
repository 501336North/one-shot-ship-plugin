/**
 * Confirmation Flow Tests
 *
 * @behavior Users can review and confirm root causes from investigation
 * @acceptance-criteria DBG-003
 * @boundary User Confirmation
 */

import { describe, it, expect } from 'vitest';
import type { RootCause } from '../../src/debug/investigation.js';
import {
  formatRootCauses,
  createConfirmationQuestion,
  shouldAutoConfirm,
  type QuestionParams,
} from '../../src/debug/confirmation.js';

describe('formatRootCauses', () => {
  /**
   * @behavior Format root causes as numbered markdown list with evidence
   * @acceptance-criteria DBG-003
   */
  it('should format root causes for user display', () => {
    const causes: RootCause[] = [
      { cause: 'Null pointer dereference', evidence: 'Line 42 in auth.ts' },
      { cause: 'Invalid state transition', evidence: 'State machine logs' },
    ];

    const result = formatRootCauses(causes);

    expect(result).toContain('1. Null pointer dereference');
    expect(result).toContain('   Evidence: Line 42 in auth.ts');
    expect(result).toContain('2. Invalid state transition');
    expect(result).toContain('   Evidence: State machine logs');
  });
});

describe('createConfirmationQuestion', () => {
  /**
   * @behavior Create valid question params for AskUserQuestion tool
   * @acceptance-criteria DBG-003
   */
  it('should create question for AskUserQuestion tool', () => {
    const causes: RootCause[] = [
      { cause: 'Null pointer', evidence: 'Line 42' },
      { cause: 'Invalid state', evidence: 'Logs' },
    ];

    const result = createConfirmationQuestion(causes);

    expect(result.question).toBeDefined();
    expect(result.header).toBeDefined();
    expect(result.options).toBeDefined();
    expect(result.options.length).toBe(2);
    expect(result.options[0].label).toContain('Null pointer');
    expect(result.options[0].description).toContain('Line 42');
    expect(result.options[1].label).toContain('Invalid state');
    expect(result.options[1].description).toContain('Logs');
  });
});

describe('shouldAutoConfirm', () => {
  /**
   * @behavior Skip confirmation when only one root cause exists
   * @acceptance-criteria DBG-003
   */
  it('should handle single root cause (skip confirmation)', () => {
    const singleCause: RootCause[] = [
      { cause: 'Null pointer', evidence: 'Line 42' },
    ];

    const result = shouldAutoConfirm(singleCause);

    expect(result).toBe(true);
  });

  /**
   * @behavior Require confirmation when multiple root causes exist
   * @acceptance-criteria DBG-003
   */
  it('should not auto-confirm with multiple causes', () => {
    const multipleCauses: RootCause[] = [
      { cause: 'Null pointer', evidence: 'Line 42' },
      { cause: 'Invalid state', evidence: 'Logs' },
    ];

    const result = shouldAutoConfirm(multipleCauses);

    expect(result).toBe(false);
  });
});
