/**
 * @file Provider Factory Tests
 * @behavior ProviderFactory creates appropriate integration instances based on provider config
 * @acceptance-criteria AC-FACTORY.1 through AC-FACTORY.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderFactory } from '../../../src/services/benchmark/provider-factory.js';
import { ClaudeIntegration } from '../../../src/services/benchmark/claude-integration.js';
import { OllamaIntegration } from '../../../src/services/benchmark/ollama-integration.js';
import { OpenRouterIntegration } from '../../../src/services/benchmark/openrouter-integration.js';
import type { ProviderConfig } from '../../../src/services/benchmark/runner.js';

// Mock the integrations to avoid actual API calls
vi.mock('../../../src/services/benchmark/claude-integration.js');
vi.mock('../../../src/services/benchmark/ollama-integration.js');
vi.mock('../../../src/services/benchmark/openrouter-integration.js');

describe('Provider Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @behavior ProviderFactory creates ClaudeIntegration for claude provider
   * @acceptance-criteria AC-FACTORY.1
   */
  it('should create ClaudeIntegration for claude provider', () => {
    // GIVEN a claude provider config
    const providerConfig: ProviderConfig = {
      name: 'claude',
      model: 'claude-3-sonnet-20240229',
      apiKey: 'test-api-key',
      isBaseline: true,
    };

    // WHEN creating an integration via the factory
    const factory = new ProviderFactory();
    const integration = factory.create(providerConfig);

    // THEN it should create a ClaudeIntegration instance
    expect(ClaudeIntegration).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      model: 'claude-3-sonnet-20240229',
      baseUrl: undefined,
    });
    expect(integration).toBeInstanceOf(ClaudeIntegration);
  });

  /**
   * @behavior ProviderFactory creates OllamaIntegration for ollama provider
   * @acceptance-criteria AC-FACTORY.2
   */
  it('should create OllamaIntegration for ollama provider', () => {
    // GIVEN an ollama provider config
    const providerConfig: ProviderConfig = {
      name: 'ollama',
      model: 'qwen2.5-coder:7b',
      baseUrl: 'http://localhost:11434',
    };

    // WHEN creating an integration via the factory
    const factory = new ProviderFactory();
    const integration = factory.create(providerConfig);

    // THEN it should create an OllamaIntegration instance
    expect(OllamaIntegration).toHaveBeenCalledWith({
      model: 'qwen2.5-coder:7b',
      baseUrl: 'http://localhost:11434',
    });
    expect(integration).toBeInstanceOf(OllamaIntegration);
  });

  /**
   * @behavior ProviderFactory creates OpenRouterIntegration for openrouter provider
   * @acceptance-criteria AC-FACTORY.3
   */
  it('should create OpenRouterIntegration for openrouter provider', () => {
    // GIVEN an openrouter provider config
    const providerConfig: ProviderConfig = {
      name: 'openrouter',
      model: 'anthropic/claude-3-haiku',
      apiKey: 'openrouter-api-key',
    };

    // WHEN creating an integration via the factory
    const factory = new ProviderFactory();
    const integration = factory.create(providerConfig);

    // THEN it should create an OpenRouterIntegration instance
    expect(OpenRouterIntegration).toHaveBeenCalledWith({
      apiKey: 'openrouter-api-key',
      model: 'anthropic/claude-3-haiku',
    });
    expect(integration).toBeInstanceOf(OpenRouterIntegration);
  });

  /**
   * @behavior ProviderFactory throws error for unknown provider
   * @acceptance-criteria AC-FACTORY.4
   */
  it('should throw error for unknown provider', () => {
    // GIVEN an unknown provider config
    const providerConfig: ProviderConfig = {
      name: 'unknown-provider',
      model: 'some-model',
    };

    // WHEN creating an integration via the factory
    const factory = new ProviderFactory();

    // THEN it should throw an error
    expect(() => factory.create(providerConfig)).toThrow('Unknown provider: unknown-provider');
  });
});
