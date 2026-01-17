/**
 * @file Claude Integration for Benchmark
 * @description Direct Claude API calls for baseline benchmarking
 *
 * @behavior ClaudeIntegration calls Claude API directly (not via proxy) for baseline comparisons
 * @acceptance-criteria AC-CLAUDE.1 through AC-CLAUDE.3
 */

import type { BenchmarkTask, BenchmarkResult } from './types.js';

/**
 * Configuration for Claude Integration
 */
export interface ClaudeIntegrationConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use (default: claude-3-sonnet-20240229) */
  model?: string;
  /** Base URL for API (default: https://api.anthropic.com) */
  baseUrl?: string;
}

/**
 * Extended result with error handling info
 */
export interface ClaudeTaskResult extends BenchmarkResult {
  /** Whether an error occurred */
  error?: boolean;
  /** Type of error if any */
  errorType?: 'rate_limit' | 'api_error' | 'network_error';
  /** Milliseconds to wait before retry (for rate limits) */
  retryAfterMs?: number;
}

/**
 * Claude API response structure
 */
interface ClaudeApiResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Claude error response structure
 */
interface ClaudeErrorResponse {
  type: string;
  error: {
    type: string;
    message: string;
  };
}

const DEFAULT_MODEL = 'claude-3-sonnet-20240229';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * ClaudeIntegration - Direct calls to Claude API for baseline benchmarking
 *
 * This bypasses any proxy and calls the Anthropic API directly to establish
 * a baseline for comparing other model providers.
 */
export class ClaudeIntegration {
  private config: ClaudeIntegrationConfig;
  private model: string;
  private baseUrl: string;

  constructor(config: ClaudeIntegrationConfig) {
    this.config = config;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Execute a benchmark task against Claude API
   */
  async executeTask(task: BenchmarkTask): Promise<ClaudeTaskResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: task.prompt,
            },
          ],
        }),
      });

      const latencyMs = Date.now() - startTime;

      // Handle rate limit errors
      if (response.status === 429) {
        const errorData = (await response.json()) as ClaudeErrorResponse;
        const retryAfterHeader = response.headers?.get?.('retry-after');
        const retryAfterMs = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : 60000; // Default to 60 seconds

        return {
          taskId: task.id,
          provider: 'claude',
          model: this.model,
          output: `Error: rate limit exceeded - ${errorData.error?.message || 'Too many requests'}`,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
          timestamp: new Date().toISOString(),
          error: true,
          errorType: 'rate_limit',
          retryAfterMs,
        };
      }

      // Handle other API errors
      if (!response.ok) {
        const errorData = (await response.json()) as ClaudeErrorResponse;
        return {
          taskId: task.id,
          provider: 'claude',
          model: this.model,
          output: `Error: ${response.status} - ${errorData.error?.message || response.statusText}`,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
          timestamp: new Date().toISOString(),
          error: true,
          errorType: 'api_error',
        };
      }

      // Parse successful response
      const data = (await response.json()) as ClaudeApiResponse;
      const output = data.content?.[0]?.text ?? '';

      return {
        taskId: task.id,
        provider: 'claude',
        model: this.model,
        output,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return {
        taskId: task.id,
        provider: 'claude',
        model: this.model,
        output: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        timestamp: new Date().toISOString(),
        error: true,
        errorType: 'network_error',
      };
    }
  }

  /**
   * Get the model being used
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the base URL being used
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
