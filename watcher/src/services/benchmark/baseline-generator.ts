/**
 * @file Baseline Generator for Model Comparison
 * @description Stores Claude's responses as baseline for comparison with challenger models
 *
 * @behavior BaselineGenerator creates baseline responses with estimated token counts
 * @acceptance-criteria AC-BASELINE.1 through AC-BASELINE.3
 */

import type { ComparisonTask } from './comparison-tasks.js';

/**
 * A baseline response from Claude for comparison
 */
export interface BaselineResponse {
  /** Task ID this response is for */
  taskId: string;
  /** The full response text */
  response: string;
  /** Estimated token count (chars / 4, rounded up) */
  estimatedTokens: number;
  /** ISO timestamp of when the baseline was generated */
  timestamp: string;
}

/**
 * BaselineGenerator - Creates baseline responses for model comparison
 *
 * This class stores Claude's responses as the baseline (gold standard)
 * against which challenger models (like Ollama) are compared.
 *
 * Token estimation uses chars/4 as an approximation since we don't
 * have direct access to Claude's tokenizer in this context.
 */
export class BaselineGenerator {
  /**
   * Generate a baseline response for a task
   *
   * @param task - The comparison task
   * @param response - Claude's response to the task
   * @returns The baseline response with estimated tokens
   */
  generate(task: ComparisonTask, response: string): BaselineResponse {
    return {
      taskId: task.id,
      response,
      estimatedTokens: Math.ceil(response.length / 4),
      timestamp: new Date().toISOString(),
    };
  }
}
