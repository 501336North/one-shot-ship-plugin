/**
 * @file Ollama Integration for Benchmark
 * @description Routes requests through proxy to local Ollama server
 *
 * @behavior OllamaIntegration routes requests via OllamaHandler for local model benchmarking
 * @acceptance-criteria AC-OLLAMA.1 through AC-OLLAMA.3
 */

import { OllamaHandler } from '../handlers/ollama-handler.js';
import type { AnthropicRequest, AnthropicResponse } from '../api-transformer.js';
import type { BenchmarkTask, BenchmarkResult } from './types.js';

/**
 * Configuration for Ollama Integration
 */
export interface OllamaIntegrationConfig {
  /** Model to use (e.g., 'qwen2.5-coder:7b', 'codellama:7b') */
  model: string;
  /** Base URL for Ollama server (default: http://localhost:11434) */
  baseUrl?: string;
}

/**
 * Extended result with error handling info
 */
export interface OllamaTaskResult extends BenchmarkResult {
  /** Whether an error occurred */
  error?: boolean;
  /** Type of error if any */
  errorType?: 'connection_error' | 'model_not_found' | 'api_error';
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * OllamaIntegration - Routes benchmark tasks through OllamaHandler
 *
 * This uses the OllamaHandler to transform requests to Ollama format
 * and route them to the local Ollama server.
 */
export class OllamaIntegration {
  private config: OllamaIntegrationConfig;
  private handler: OllamaHandler;
  private model: string;

  constructor(config: OllamaIntegrationConfig) {
    this.config = config;
    this.model = config.model;
    this.handler = new OllamaHandler({
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    });
  }

  /**
   * Get the provider type
   */
  getProvider(): string {
    return 'ollama';
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
    return this.handler.getBaseUrl();
  }

  /**
   * Execute a benchmark task against Ollama
   */
  async executeTask(task: BenchmarkTask): Promise<OllamaTaskResult> {
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

      // Execute via handler (transforms to Ollama format internally)
      const response: AnthropicResponse = await this.handler.handle(request);
      const latencyMs = Date.now() - startTime;

      // Extract output from response
      const output =
        response.content?.[0]?.type === 'text'
          ? (response.content[0] as { type: 'text'; text: string }).text
          : '';

      return {
        taskId: task.id,
        provider: 'ollama',
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
      let errorType: OllamaTaskResult['errorType'] = 'api_error';
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('not running')) {
        errorType = 'connection_error';
      } else if (errorMessage.includes('model') && errorMessage.includes('not found')) {
        errorType = 'model_not_found';
      }

      return {
        taskId: task.id,
        provider: 'ollama',
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

  /**
   * Check if Ollama server is healthy
   */
  async checkHealth(): Promise<boolean> {
    return this.handler.checkHealth();
  }
}
