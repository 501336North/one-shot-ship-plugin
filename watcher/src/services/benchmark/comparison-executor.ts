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
 * Token ratio = challenger.outputTokens / baseline.estimatedTokens
 *
 * NOTE: We compare OUTPUT tokens only because:
 * 1. Input tokens (prompt) are identical for both models
 * 2. We don't have Claude's actual input token count (only estimated output)
 * 3. Different tokenizers produce different input counts for the same text
 *
 * A ratio < 1.0 means the challenger produced fewer output tokens than Claude.
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

      // Calculate token ratio (OUTPUT tokens only for fair comparison)
      // Input tokens (prompt) are the same for both models, so we only compare output
      const tokenRatio = baseline.estimatedTokens > 0
        ? challenger.outputTokens / baseline.estimatedTokens
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
