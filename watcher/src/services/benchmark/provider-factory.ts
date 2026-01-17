/**
 * @file Provider Factory
 * @description Factory for creating provider integration instances based on configuration
 *
 * @behavior ProviderFactory creates appropriate integration instances based on provider config
 * @acceptance-criteria AC-FACTORY.1 through AC-FACTORY.4
 */

import { ClaudeIntegration } from './claude-integration.js';
import { OllamaIntegration } from './ollama-integration.js';
import { OpenRouterIntegration } from './openrouter-integration.js';
import type { ProviderConfig } from './runner.js';
import type { BenchmarkTask, BenchmarkResult } from './types.js';

/**
 * Common interface for all provider integrations
 */
export interface ProviderIntegration {
  /** Execute a benchmark task and return the result */
  executeTask(task: BenchmarkTask): Promise<BenchmarkResult>;
}

/**
 * Factory for creating provider integration instances
 *
 * This factory encapsulates the logic for creating the appropriate
 * integration instance based on the provider configuration.
 */
export class ProviderFactory {
  /**
   * Create a provider integration based on the provider configuration
   *
   * @param config - The provider configuration
   * @returns The appropriate integration instance
   * @throws Error if the provider is unknown
   */
  create(config: ProviderConfig): ProviderIntegration {
    switch (config.name) {
      case 'claude':
        return new ClaudeIntegration({
          apiKey: config.apiKey ?? '',
          model: config.model,
          baseUrl: config.baseUrl,
        });

      case 'ollama':
        return new OllamaIntegration({
          model: config.model,
          baseUrl: config.baseUrl,
        });

      case 'openrouter':
        return new OpenRouterIntegration({
          apiKey: config.apiKey ?? '',
          model: config.model,
        });

      default:
        throw new Error(`Unknown provider: ${config.name}`);
    }
  }
}
