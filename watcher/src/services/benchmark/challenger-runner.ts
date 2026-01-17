/**
 * @file Challenger Runner for Model Comparison
 * @description Executes comparison tasks against Ollama and captures responses with token counts
 *
 * @behavior ChallengerRunner calls Ollama API directly and captures actual token counts
 * @acceptance-criteria AC-CHALLENGER.1 through AC-CHALLENGER.3
 */

import type { ComparisonTask } from './comparison-tasks.js';

/**
 * Configuration for ChallengerRunner
 */
export interface ChallengerRunnerConfig {
  /** Model to use (e.g., 'qwen2.5-coder:7b') */
  model: string;
  /** Base URL for Ollama server (default: http://localhost:11434) */
  baseUrl?: string;
}

/**
 * Response from the challenger model (Ollama)
 */
export interface ChallengerResponse {
  /** Task ID this response is for */
  taskId: string;
  /** The full response text */
  response: string;
  /** Input tokens (prompt_eval_count from Ollama) */
  inputTokens: number;
  /** Output tokens (eval_count from Ollama) */
  outputTokens: number;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Whether an error occurred */
  error?: boolean;
  /** Type of error if any */
  errorType?: 'connection_error' | 'api_error' | 'model_not_found';
}

/**
 * Raw Ollama API response structure
 */
interface OllamaGenerateResponse {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
  model?: string;
  error?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * ChallengerRunner - Executes tasks against Ollama for comparison
 *
 * This class directly calls the Ollama `/api/generate` endpoint
 * to capture actual token counts (prompt_eval_count + eval_count).
 */
export class ChallengerRunner {
  private model: string;
  private baseUrl: string;

  constructor(config: ChallengerRunnerConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Run a comparison task against Ollama
   *
   * @param task - The comparison task to run
   * @returns The challenger response with actual token counts
   */
  async run(task: ComparisonTask): Promise<ChallengerResponse> {
    const startTime = Date.now();

    // Build prompt combining task prompt and code snippet
    const fullPrompt = `${task.prompt}\n\nCode:\n\`\`\`\n${task.codeSnippet}\n\`\`\``;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: fullPrompt,
          stream: false,
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          taskId: task.id,
          response: `Error: ${response.status} ${response.statusText}`,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
          error: true,
          errorType: 'api_error',
        };
      }

      const data = (await response.json()) as OllamaGenerateResponse;

      return {
        taskId: task.id,
        response: data.response,
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      // Determine error type based on message
      let errorType: ChallengerResponse['errorType'] = 'api_error';
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
        errorType = 'connection_error';
      } else if (errorMessage.includes('model') && errorMessage.includes('not found')) {
        errorType = 'model_not_found';
      }

      return {
        taskId: task.id,
        response: `Error: ${errorMessage}`,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        error: true,
        errorType,
      };
    }
  }
}
