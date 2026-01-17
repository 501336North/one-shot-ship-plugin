/**
 * @file Comparison Claim Validator
 * @description Validates the claim that challenger achieves 95% quality at 25% tokens
 *
 * @behavior ComparisonClaimValidator validates quality and token efficiency thresholds
 * @acceptance-criteria AC-CLAIM-VALIDATOR.1 through AC-CLAIM-VALIDATOR.5
 */

import type { JudgeResults } from './judge-executor.js';
import type { ComparisonResult } from './comparison-executor.js';

/**
 * Verdict for claim validation
 */
export type ClaimVerdict = 'CLAIM_VALIDATED' | 'CLAIM_NOT_VALIDATED';

/**
 * Result of validating the comparison claim
 */
export interface ClaimValidationResult {
  /** Overall verdict: validated or not */
  verdict: ClaimVerdict;
  /** Average quality score (0-100) */
  avgQuality: number;
  /** Average token ratio (challenger tokens / baseline tokens) */
  avgTokenRatio: number;
}

/**
 * Threshold constants for claim validation
 */
const QUALITY_THRESHOLD = 95; // >= 95% quality required
const TOKEN_RATIO_THRESHOLD = 0.25; // <= 25% tokens required

/**
 * ComparisonClaimValidator - Validates the challenger model meets quality/efficiency thresholds
 *
 * The claim being validated:
 * "Challenger achieves >= 95% of Claude's quality while using <= 25% of Claude's tokens"
 *
 * Thresholds:
 * - Quality: >= 95% (weighted average score)
 * - Token Ratio: <= 0.25 (average challenger tokens / baseline tokens)
 */
export class ComparisonClaimValidator {
  /**
   * Validate the claim based on judge results and comparison data
   *
   * @param judgeResults - Results from the quality judge (scores per task)
   * @param comparisons - Comparison results with token ratios
   * @returns ClaimValidationResult with verdict and metrics
   */
  validate(judgeResults: JudgeResults, comparisons: ComparisonResult[]): ClaimValidationResult {
    // Calculate average quality from judge results
    const avgQuality = judgeResults.averageScore;

    // Calculate average token ratio from comparisons
    const avgTokenRatio = this.calculateAverageTokenRatio(comparisons);

    // Determine verdict based on thresholds
    const meetsQualityThreshold = avgQuality >= QUALITY_THRESHOLD;
    const meetsTokenThreshold = avgTokenRatio <= TOKEN_RATIO_THRESHOLD;
    const verdict: ClaimVerdict =
      meetsQualityThreshold && meetsTokenThreshold
        ? 'CLAIM_VALIDATED'
        : 'CLAIM_NOT_VALIDATED';

    return {
      verdict,
      avgQuality,
      avgTokenRatio,
    };
  }

  /**
   * Calculate the average token ratio across all comparisons
   *
   * @param comparisons - Array of comparison results
   * @returns Average token ratio (0-1+)
   */
  private calculateAverageTokenRatio(comparisons: ComparisonResult[]): number {
    if (comparisons.length === 0) {
      return 0;
    }

    const totalRatio = comparisons.reduce((sum, c) => sum + c.tokenRatio, 0);
    return totalRatio / comparisons.length;
  }
}
