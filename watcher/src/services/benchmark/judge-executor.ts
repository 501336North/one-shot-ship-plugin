/**
 * @file Judge Executor for Model Comparison
 * @description Orchestrates quality judging across all comparison pairs
 *
 * @behavior JudgeExecutor judges all comparison pairs and calculates aggregate scores
 * @acceptance-criteria AC-JUDGE-EXEC.1 through AC-JUDGE-EXEC.3
 */

import type { ComparisonResult } from './comparison-executor.js';
import type { ComparisonTask } from './comparison-tasks.js';
import type { QualityJudge, JudgeResult } from './quality-judge.js';

/**
 * Result of judging a single task
 */
export interface TaskJudgeResult {
  /** Task ID */
  taskId: string;
  /** The full judge result with scores and reasoning */
  judgeResult: JudgeResult;
}

/**
 * Aggregate results from judging all comparison pairs
 */
export interface JudgeResults {
  /** Individual results for each task */
  taskResults: TaskJudgeResult[];
  /** Average weighted score across all tasks (0-100) */
  averageScore: number;
}

/**
 * JudgeExecutor - Orchestrates quality judging across comparison pairs
 *
 * This class takes a set of comparison results (baseline vs challenger)
 * and uses a QualityJudge to score each pair. It then aggregates the
 * results and calculates the average quality score.
 *
 * The judge is passed in at runtime, allowing for:
 * - Claude to act as the LLM judge in production
 * - Mock judges in tests for deterministic results
 */
export class JudgeExecutor {
  /**
   * Judge all comparison pairs
   *
   * @param comparisons - Array of comparison results (baseline vs challenger)
   * @param tasks - Array of comparison tasks (needed for context)
   * @param judge - The QualityJudge to use for scoring
   * @returns JudgeResults with individual scores and average
   */
  async judgeAll(
    comparisons: ComparisonResult[],
    tasks: ComparisonTask[],
    judge: QualityJudge
  ): Promise<JudgeResults> {
    // Handle empty input
    if (comparisons.length === 0) {
      return {
        taskResults: [],
        averageScore: 0,
      };
    }

    // Index tasks by ID for efficient lookup
    const tasksByID = new Map<string, ComparisonTask>();
    for (const task of tasks) {
      tasksByID.set(task.id, task);
    }

    // Judge each comparison pair
    const taskResults: TaskJudgeResult[] = [];

    for (const comparison of comparisons) {
      const task = tasksByID.get(comparison.taskId);

      // Skip if no matching task
      if (!task) {
        continue;
      }

      // Score the challenger against the baseline
      const judgeResult = await judge.score(
        comparison.baseline,
        comparison.challenger,
        task
      );

      taskResults.push({
        taskId: comparison.taskId,
        judgeResult,
      });
    }

    // Calculate average score
    const averageScore = this.calculateAverageScore(taskResults);

    return {
      taskResults,
      averageScore,
    };
  }

  /**
   * Calculate the average weighted score across all task results
   *
   * @param taskResults - Array of task judge results
   * @returns Average score (0-100), or 0 if no results
   */
  private calculateAverageScore(taskResults: TaskJudgeResult[]): number {
    if (taskResults.length === 0) {
      return 0;
    }

    const totalScore = taskResults.reduce(
      (sum, result) => sum + result.judgeResult.weightedScore,
      0
    );

    return totalScore / taskResults.length;
  }
}
