/**
 * Severity Inference Tests
 *
 * @behavior System infers bug severity from error type and context
 * @acceptance-criteria DBG-004
 * @boundary Severity Assessment
 */

import { describe, it, expect } from 'vitest';
import type { ParsedBug } from '../../src/debug/bug-parser.js';
import {
  inferSeverity,
  createSeverityQuestion,
  type SeverityLevel,
  type SeverityResult,
  type QuestionParams,
} from '../../src/debug/severity.js';

describe('inferSeverity', () => {
  /**
   * @behavior Infer critical severity from security-related errors
   * @acceptance-criteria DBG-004
   * @business-rule Security errors are always critical
   */
  it('should infer critical severity from error type', () => {
    const bug: Partial<ParsedBug> = {
      errorType: 'SecurityError',
      message: 'Unauthorized access',
    };

    const result = inferSeverity(bug);

    expect(result.severity).toBe('critical');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  /**
   * @behavior Infer high severity for payment/data loss scenarios
   * @acceptance-criteria DBG-004
   * @business-rule Payment bugs are high severity
   */
  it('should infer high severity for data loss scenarios', () => {
    const bug: Partial<ParsedBug> = {
      errorType: 'TypeError',
      component: 'payment',
    };

    const result = inferSeverity(bug);

    expect(result.severity).toBe('high');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  /**
   * @behavior Infer medium severity for non-critical errors
   * @acceptance-criteria DBG-004
   */
  it('should infer medium severity for generic errors', () => {
    const bug: Partial<ParsedBug> = {
      errorType: 'TypeError',
      component: 'ui',
    };

    const result = inferSeverity(bug);

    expect(result.severity).toBe('medium');
    expect(result.confidence).toBeLessThanOrEqual(0.7);
  });
});

describe('createSeverityQuestion', () => {
  /**
   * @behavior Create override question when confidence is low
   * @acceptance-criteria DBG-004
   */
  it('should create override question when confidence low', () => {
    const inferred: SeverityResult = {
      severity: 'medium',
      confidence: 0.5,
    };

    const result = createSeverityQuestion(inferred);

    expect(result).not.toBeNull();
    expect(result?.question).toBeDefined();
    expect(result?.options).toBeDefined();
    expect(result?.options.length).toBe(4); // critical, high, medium, low
  });

  /**
   * @behavior Skip override question when confidence is high
   * @acceptance-criteria DBG-004
   */
  it('should not create question when confidence high', () => {
    const inferred: SeverityResult = {
      severity: 'critical',
      confidence: 0.95,
    };

    const result = createSeverityQuestion(inferred);

    expect(result).toBeNull();
  });
});
