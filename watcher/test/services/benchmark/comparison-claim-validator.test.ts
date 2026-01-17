/**
 * @file Comparison Claim Validator Tests
 * @description Tests for validating the claim that Ollama achieves 95% quality at 25% tokens
 *
 * @behavior ComparisonClaimValidator validates quality and token efficiency thresholds
 * @acceptance-criteria AC-CLAIM-VALIDATOR.1 through AC-CLAIM-VALIDATOR.5
 */

import { describe, it, expect } from 'vitest';
import {
  ComparisonClaimValidator,
  ClaimValidationResult,
} from '../../../src/services/benchmark/comparison-claim-validator.js';
import type { JudgeResults, TaskJudgeResult } from '../../../src/services/benchmark/judge-executor.js';
import type { ComparisonResult } from '../../../src/services/benchmark/comparison-executor.js';

describe('Comparison Claim Validator', () => {
  // Helper to create judge results with specific scores
  const createJudgeResults = (weightedScores: number[]): JudgeResults => {
    const taskResults: TaskJudgeResult[] = weightedScores.map((score, idx) => ({
      taskId: `task-${idx + 1}`,
      judgeResult: {
        scores: {
          correctness: score,
          completeness: score,
          explanation: score,
          codeQuality: score,
        },
        weightedScore: score,
        reasoning: {
          correctness: 'Test reasoning',
          completeness: 'Test reasoning',
          explanation: 'Test reasoning',
          codeQuality: 'Test reasoning',
        },
      },
    }));

    const averageScore = weightedScores.reduce((a, b) => a + b, 0) / weightedScores.length;

    return {
      taskResults,
      averageScore,
    };
  };

  // Helper to create comparison results with specific token ratios
  const createComparisonResults = (tokenRatios: number[]): ComparisonResult[] => {
    return tokenRatios.map((ratio, idx) => ({
      taskId: `task-${idx + 1}`,
      baseline: {
        taskId: `task-${idx + 1}`,
        response: 'Baseline response',
        estimatedTokens: 100,
        timestamp: '2026-01-17T12:00:00Z',
      },
      challenger: {
        taskId: `task-${idx + 1}`,
        response: 'Challenger response',
        inputTokens: Math.round(100 * ratio * 0.4),
        outputTokens: Math.round(100 * ratio * 0.6),
        latencyMs: 100,
      },
      tokenRatio: ratio,
    }));
  };

  /**
   * @behavior ComparisonClaimValidator calculates average quality percentage from judge results
   * @acceptance-criteria AC-CLAIM-VALIDATOR.1
   */
  it('should calculate average quality percentage from judge results', () => {
    // GIVEN judge results with weighted scores of 90, 95, 100
    // Average = (90 + 95 + 100) / 3 = 95
    const judgeResults = createJudgeResults([90, 95, 100]);
    const comparisons = createComparisonResults([0.20, 0.20, 0.20]);

    // WHEN validating
    const validator = new ComparisonClaimValidator();
    const result = validator.validate(judgeResults, comparisons);

    // THEN average quality should be 95
    expect(result.avgQuality).toBe(95);
  });

  /**
   * @behavior ComparisonClaimValidator calculates average token ratio from comparisons
   * @acceptance-criteria AC-CLAIM-VALIDATOR.2
   */
  it('should calculate average token ratio from comparisons', () => {
    // GIVEN comparisons with token ratios of 0.20, 0.25, 0.30
    // Average = (0.20 + 0.25 + 0.30) / 3 = 0.25
    const judgeResults = createJudgeResults([95, 95, 95]);
    const comparisons = createComparisonResults([0.20, 0.25, 0.30]);

    // WHEN validating
    const validator = new ComparisonClaimValidator();
    const result = validator.validate(judgeResults, comparisons);

    // THEN average token ratio should be 0.25
    expect(result.avgTokenRatio).toBeCloseTo(0.25, 2);
  });

  /**
   * @behavior ComparisonClaimValidator returns CLAIM_VALIDATED if quality >= 95% AND tokens <= 25%
   * @acceptance-criteria AC-CLAIM-VALIDATOR.3
   */
  it('should return CLAIM_VALIDATED if quality >= 95% AND tokens <= 25%', () => {
    // GIVEN exactly meeting thresholds: quality = 95, tokenRatio = 0.25
    const judgeResults = createJudgeResults([95, 95, 95]);
    const comparisons = createComparisonResults([0.25, 0.25, 0.25]);

    // WHEN validating
    const validator = new ComparisonClaimValidator();
    const result = validator.validate(judgeResults, comparisons);

    // THEN verdict should be CLAIM_VALIDATED
    expect(result.verdict).toBe('CLAIM_VALIDATED');
    expect(result.avgQuality).toBe(95);
    expect(result.avgTokenRatio).toBe(0.25);
  });

  /**
   * @behavior ComparisonClaimValidator returns CLAIM_NOT_VALIDATED if quality < 95%
   * @acceptance-criteria AC-CLAIM-VALIDATOR.4
   */
  it('should return CLAIM_NOT_VALIDATED if quality < 95%', () => {
    // GIVEN quality below threshold (94%) but good token ratio
    const judgeResults = createJudgeResults([94, 94, 94]);
    const comparisons = createComparisonResults([0.20, 0.20, 0.20]);

    // WHEN validating
    const validator = new ComparisonClaimValidator();
    const result = validator.validate(judgeResults, comparisons);

    // THEN verdict should be CLAIM_NOT_VALIDATED
    expect(result.verdict).toBe('CLAIM_NOT_VALIDATED');
    expect(result.avgQuality).toBe(94);
    expect(result.avgTokenRatio).toBeCloseTo(0.20, 2);
  });

  /**
   * @behavior ComparisonClaimValidator returns CLAIM_NOT_VALIDATED if tokens > 25%
   * @acceptance-criteria AC-CLAIM-VALIDATOR.5
   */
  it('should return CLAIM_NOT_VALIDATED if tokens > 25%', () => {
    // GIVEN good quality but token ratio above threshold (26%)
    const judgeResults = createJudgeResults([98, 98, 98]);
    const comparisons = createComparisonResults([0.26, 0.26, 0.26]);

    // WHEN validating
    const validator = new ComparisonClaimValidator();
    const result = validator.validate(judgeResults, comparisons);

    // THEN verdict should be CLAIM_NOT_VALIDATED
    expect(result.verdict).toBe('CLAIM_NOT_VALIDATED');
    expect(result.avgQuality).toBe(98);
    expect(result.avgTokenRatio).toBeCloseTo(0.26, 2);
  });
});
