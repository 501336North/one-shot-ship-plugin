/**
 * @file Comparison Executor for Model Comparison
 * @description Pairs baseline and challenger responses and calculates token ratios
 *
 * @behavior ComparisonExecutor pairs responses by task ID and calculates efficiency metrics
 * @acceptance-criteria AC-COMPARISON-EXEC.1 through AC-COMPARISON-EXEC.3
 */

import type { BaselineResponse } from './baseline-generator.js';
import type { ChallengerResponse } from './challenger-runner.js';

/**
 * Result of comparing baseline and challenger for a single task
 */
export interface ComparisonResult {
  /** Task ID */
  taskId: string;
  /** Baseline response from Claude */
  baseline: BaselineResponse;
  /** Challenger response from Ollama */
  challenger: ChallengerResponse;
  /** Token ratio: challenger total tokens / baseline estimated tokens */
  tokenRatio: number;
}

/**
 * ComparisonExecutor - Pairs and compares baseline/challenger responses
 *
 * This class takes sets of baseline (Claude) and challenger (Ollama) responses,
 * pairs them by task ID, and calculates the token efficiency ratio for each pair.
 *
 * Token ratio = (challenger.inputTokens + challenger.outputTokens) / baseline.estimatedTokens
 *
 * A ratio < 1.0 means the challenger used fewer tokens than estimated for Claude.
 * Our target is <= 0.25 (25% of Claude's tokens).
 */
export class ComparisonExecutor {
  /**
   * Execute comparison between baselines and challenges
   *
   * @param baselines - Array of baseline responses from Claude
   * @param challenges - Array of challenger responses from Ollama
   * @returns Array of comparison results (only for tasks with both baseline and challenger)
   */
  execute(baselines: BaselineResponse[], challenges: ChallengerResponse[]): ComparisonResult[] {
    // Index challenges by task ID for efficient lookup
    const challengesByTaskId = new Map<string, ChallengerResponse>();
    for (const challenge of challenges) {
      challengesByTaskId.set(challenge.taskId, challenge);
    }

    // Pair baselines with challenges
    const results: ComparisonResult[] = [];

    for (const baseline of baselines) {
      const challenger = challengesByTaskId.get(baseline.taskId);

      // Skip if no matching challenger
      if (!challenger) {
        continue;
      }

      // Calculate token ratio
      const challengerTotalTokens = challenger.inputTokens + challenger.outputTokens;
      const tokenRatio = baseline.estimatedTokens > 0
        ? challengerTotalTokens / baseline.estimatedTokens
        : 0;

      results.push({
        taskId: baseline.taskId,
        baseline,
        challenger,
        tokenRatio,
      });
    }

    return results;
  }
}
