/**
 * @file OpenRouter Integration for Benchmark
 * @description Routes requests through proxy to OpenRouter API with authentication
 *
 * @behavior OpenRouterIntegration routes requests via OpenRouterHandler with API key auth
 * @acceptance-criteria AC-OPENROUTER.1 through AC-OPENROUTER.3
 */

import { OpenRouterHandler } from '../handlers/openrouter-handler.js';
import type { AnthropicRequest, AnthropicResponse } from '../api-transformer.js';
import type { BenchmarkTask, BenchmarkResult } from './types.js';

/**
 * Configuration for OpenRouter Integration
 */
export interface OpenRouterIntegrationConfig {
  /** OpenRouter API key (required) */
  apiKey: string;
  /** Model to use (e.g., 'anthropic/claude-3-haiku', 'meta-llama/llama-3-70b') */
  model: string;
}

/**
 * Extended result with error handling and cost info
 */
export interface OpenRouterTaskResult extends BenchmarkResult {
  /** Whether an error occurred */
  error?: boolean;
  /** Type of error if any */
  errorType?: 'auth_error' | 'rate_limit' | 'api_error';
  /** Cost in USD for this request (if provided by OpenRouter) */
  costUsd?: number;
}

/**
 * OpenRouterIntegration - Routes benchmark tasks through OpenRouterHandler
 *
 * This uses the OpenRouterHandler to transform requests to OpenAI format
 * and route them to OpenRouter's API with proper authentication.
 */
export class OpenRouterIntegration {
  private config: OpenRouterIntegrationConfig;
  private handler: OpenRouterHandler;
  private model: string;

  constructor(config: OpenRouterIntegrationConfig) {
    this.config = config;
    this.model = config.model;
    this.handler = new OpenRouterHandler({
      apiKey: config.apiKey,
    });
  }

  /**
   * Get the provider type
   */
  getProvider(): string {
    return 'openrouter';
  }

  /**
   * Get the model being used
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the API key (for verification)
   */
  getApiKey(): string {
    return this.config.apiKey;
  }

  /**
   * Execute a benchmark task against OpenRouter
   */
  async executeTask(task: BenchmarkTask): Promise<OpenRouterTaskResult> {
    const startTime = Date.now();

    try {
      // Build Anthropic-format request
      const request: AnthropicRequest = {
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: task.prompt,
          },
        ],
      };

      // Execute via handler (transforms to OpenAI format and adds auth)
      const response: AnthropicResponse = await this.handler.handle(request);
      const latencyMs = Date.now() - startTime;

      // Extract output from response
      const output =
        response.content?.[0]?.type === 'text'
          ? (response.content[0] as { type: 'text'; text: string }).text
          : '';

      return {
        taskId: task.id,
        provider: 'openrouter',
        model: this.model,
        output,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      // Determine error type based on message
      let errorType: OpenRouterTaskResult['errorType'] = 'api_error';
      if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('Invalid API')) {
        errorType = 'auth_error';
      } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        errorType = 'rate_limit';
      }

      return {
        taskId: task.id,
        provider: 'openrouter',
        model: this.model,
        output: `Error: ${errorMessage}`,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        timestamp: new Date().toISOString(),
        error: true,
        errorType,
      };
    }
  }
}
