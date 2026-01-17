/**
 * @file Quality Judge for Model Comparison
 * @description Scores model responses on 4 dimensions with weighted scoring
 *
 * @behavior QualityJudge scores challenger responses against baselines on 4 quality dimensions
 * @acceptance-criteria AC-JUDGE.1 through AC-JUDGE.4
 */

import type { BaselineResponse } from './baseline-generator.js';
import type { ChallengerResponse } from './challenger-runner.js';
import type { ComparisonTask } from './comparison-tasks.js';

/**
 * Scoring dimensions for quality evaluation
 */
export type ScoringDimension = 'correctness' | 'completeness' | 'explanation' | 'codeQuality';

/**
 * Reasoning for each scoring dimension
 */
export interface DimensionReasoning {
  correctness: string;
  completeness: string;
  explanation: string;
  codeQuality: string;
}

/**
 * Raw scores from the judge scorer (0-100 for each dimension)
 */
export interface JudgeScore {
  /** Score for correctness (0-100) */
  correctness: number;
  /** Score for completeness (0-100) */
  completeness: number;
  /** Score for explanation clarity (0-100) */
  explanation: number;
  /** Score for code quality suggestions (0-100) */
  codeQuality: number;
  /** Optional reasoning for each dimension */
  reasoning?: DimensionReasoning;
}

/**
 * Complete result from the quality judge
 */
export interface JudgeResult {
  /** Individual dimension scores */
  scores: JudgeScore;
  /** Weighted total score (0-100) */
  weightedScore: number;
  /** Reasoning for each dimension */
  reasoning: DimensionReasoning;
}

/**
 * Function signature for a scorer that evaluates responses
 * This allows injecting Claude or any other judge at runtime
 */
export type JudgeScorer = (
  baseline: BaselineResponse,
  challenger: ChallengerResponse,
  task: ComparisonTask
) => Promise<JudgeScore>;

/**
 * Weights for each scoring dimension
 * - Correctness: 40% (most important - did the model get it right?)
 * - Completeness: 30% (did it address all aspects?)
 * - Explanation: 15% (how well did it explain its reasoning?)
 * - Code Quality: 15% (were the code suggestions well-written?)
 */
const DIMENSION_WEIGHTS: Record<ScoringDimension, number> = {
  correctness: 0.40,
  completeness: 0.30,
  explanation: 0.15,
  codeQuality: 0.15,
};

/**
 * Default reasoning when none is provided
 */
const DEFAULT_REASONING: DimensionReasoning = {
  correctness: 'No reasoning provided.',
  completeness: 'No reasoning provided.',
  explanation: 'No reasoning provided.',
  codeQuality: 'No reasoning provided.',
};

/**
 * QualityJudge - Scores model responses on 4 quality dimensions
 *
 * This class uses a configurable scorer function to evaluate challenger
 * responses against baseline (Claude) responses. The scorer is typically
 * Claude itself acting as an LLM judge, but can be mocked for testing.
 *
 * Dimensions:
 * - correctness (40%): Did the model identify the correct issues/solutions?
 * - completeness (30%): Did it address all relevant aspects?
 * - explanation (15%): How clear and well-structured is the explanation?
 * - codeQuality (15%): How well-written are any code suggestions?
 */
export class QualityJudge {
  private scorer: JudgeScorer;

  /**
   * Create a QualityJudge with a specific scorer function
   *
   * @param scorer - Function that evaluates responses and returns scores
   */
  constructor(scorer: JudgeScorer) {
    this.scorer = scorer;
  }

  /**
   * Score a challenger response against a baseline
   *
   * @param baseline - The baseline (Claude) response
   * @param challenger - The challenger (Ollama) response
   * @param task - The comparison task that was evaluated
   * @returns JudgeResult with scores, weighted score, and reasoning
   */
  async score(
    baseline: BaselineResponse,
    challenger: ChallengerResponse,
    task: ComparisonTask
  ): Promise<JudgeResult> {
    // Get raw scores from the scorer
    const rawScores = await this.scorer(baseline, challenger, task);

    // Calculate weighted score
    const weightedScore = this.calculateWeightedScore(rawScores);

    // Build reasoning (use provided or defaults)
    const reasoning = rawScores.reasoning ?? DEFAULT_REASONING;

    return {
      scores: rawScores,
      weightedScore,
      reasoning,
    };
  }

  /**
   * Calculate the weighted score from raw dimension scores
   *
   * @param scores - Raw scores for each dimension
   * @returns Weighted total score (0-100)
   */
  private calculateWeightedScore(scores: JudgeScore): number {
    const weightedSum =
      scores.correctness * DIMENSION_WEIGHTS.correctness +
      scores.completeness * DIMENSION_WEIGHTS.completeness +
      scores.explanation * DIMENSION_WEIGHTS.explanation +
      scores.codeQuality * DIMENSION_WEIGHTS.codeQuality;

    // Round to avoid floating point issues
    return Math.round(weightedSum * 100) / 100;
  }
}
