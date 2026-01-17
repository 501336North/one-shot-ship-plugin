/**
 * HandlerRegistry Tests
 *
 * @behavior Handler registry manages model handlers for different providers
 * @acceptance-criteria AC-HANDLER-REG.1 through AC-HANDLER-REG.16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnthropicRequest, AnthropicResponse } from '../../src/services/api-transformer.js';

// ============================================================================
// Task 1.1: HandlerRegistry Types (4 tests)
// ============================================================================

describe('HandlerRegistry types', () => {
  it('should define Handler interface with handle() method', async () => {
    // Import the Handler type
    const { Handler } = await import('../../src/services/handler-registry.js');

    // A handler must have a handle method that takes AnthropicRequest and returns Promise<AnthropicResponse>
    const mockHandler: typeof Handler = {
      handle: async (request: AnthropicRequest): Promise<AnthropicResponse> => {
        return {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          model: 'test-model',
          content: [{ type: 'text', text: 'response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
        };
      },
    };

    expect(mockHandler.handle).toBeDefined();
    expect(typeof mockHandler.handle).toBe('function');
  });

  it('should define HandlerConfig with provider and optional apiKey', async () => {
    const { HandlerConfig } = await import('../../src/services/handler-registry.js');

    // HandlerConfig should have provider and optional apiKey/baseUrl
    const config: typeof HandlerConfig = {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
    };

    expect(config.provider).toBe('ollama');
    expect(config.baseUrl).toBe('http://localhost:11434');
  });

  it('should define supported providers: ollama, openrouter', async () => {
    const { SupportedProvider, SUPPORTED_PROVIDERS } = await import('../../src/services/handler-registry.js');

    // SupportedProvider should be a union type of 'ollama' | 'openrouter'
    expect(SUPPORTED_PROVIDERS).toContain('ollama');
    expect(SUPPORTED_PROVIDERS).toContain('openrouter');
    expect(SUPPORTED_PROVIDERS).toHaveLength(2);
  });

  it('should export createHandler factory function', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');

    expect(createHandler).toBeDefined();
    expect(typeof createHandler).toBe('function');
  });
});

// ============================================================================
// Task 1.2: createHandler Factory (6 tests)
// ============================================================================

describe('createHandler', () => {
  it('should create OllamaHandler for provider "ollama"', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');
    const { OllamaHandler } = await import('../../src/services/handlers/ollama-handler.js');

    const handler = createHandler({ provider: 'ollama' });

    expect(handler).toBeInstanceOf(OllamaHandler);
  });

  it('should create OpenRouterHandler for provider "openrouter"', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');
    const { OpenRouterHandler } = await import('../../src/services/handlers/openrouter-handler.js');

    const handler = createHandler({ provider: 'openrouter', apiKey: 'sk-or-test-key' });

    expect(handler).toBeInstanceOf(OpenRouterHandler);
  });

  it('should throw for unknown provider', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');

    expect(() => createHandler({ provider: 'unknown' as 'ollama' })).toThrow('Unknown provider: unknown');
  });

  it('should pass apiKey to OpenRouterHandler', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');

    const handler = createHandler({ provider: 'openrouter', apiKey: 'sk-or-my-key' });

    // Verify the handler was created with the API key by checking headers
    const headers = (handler as { getHeaders(): Record<string, string> }).getHeaders();
    expect(headers['Authorization']).toBe('Bearer sk-or-my-key');
  });

  it('should pass baseUrl to OllamaHandler', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');

    const handler = createHandler({ provider: 'ollama', baseUrl: 'http://custom:1234' });

    // Verify the handler was created with the custom base URL
    const baseUrl = (handler as { getBaseUrl(): string }).getBaseUrl();
    expect(baseUrl).toBe('http://custom:1234');
  });

  it('should not require apiKey for Ollama', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');

    // Should not throw when creating Ollama handler without apiKey
    expect(() => createHandler({ provider: 'ollama' })).not.toThrow();
  });

  it('should throw when OpenRouter is missing apiKey', async () => {
    const { createHandler } = await import('../../src/services/handler-registry.js');

    expect(() => createHandler({ provider: 'openrouter' })).toThrow('API key is required for OpenRouter');
  });
});

// ============================================================================
// Task 1.3: HandlerRegistry Class (6 tests)
// ============================================================================

describe('HandlerRegistry', () => {
  it('should register handler for provider', async () => {
    const { HandlerRegistry } = await import('../../src/services/handler-registry.js');

    const registry = new HandlerRegistry();
    const mockHandler = {
      handle: vi.fn().mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'test',
        content: [],
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    };

    registry.register('ollama', mockHandler);

    const retrieved = registry.get('ollama');
    expect(retrieved).toBe(mockHandler);
  });

  it('should get handler by provider', async () => {
    const { HandlerRegistry } = await import('../../src/services/handler-registry.js');

    const registry = new HandlerRegistry();
    const mockHandler = {
      handle: vi.fn(),
    };

    registry.register('openrouter', mockHandler);

    const retrieved = registry.get('openrouter');
    expect(retrieved).toBe(mockHandler);
  });

  it('should throw if handler not registered', async () => {
    const { HandlerRegistry } = await import('../../src/services/handler-registry.js');

    const registry = new HandlerRegistry();

    expect(() => registry.get('ollama')).toThrow('No handler registered for provider: ollama');
  });

  it('should support multiple handlers', async () => {
    const { HandlerRegistry } = await import('../../src/services/handler-registry.js');

    const registry = new HandlerRegistry();
    const ollamaHandler = { handle: vi.fn() };
    const openrouterHandler = { handle: vi.fn() };

    registry.register('ollama', ollamaHandler);
    registry.register('openrouter', openrouterHandler);

    expect(registry.get('ollama')).toBe(ollamaHandler);
    expect(registry.get('openrouter')).toBe(openrouterHandler);
  });

  it('should have getOrCreate() for lazy initialization', async () => {
    const { HandlerRegistry } = await import('../../src/services/handler-registry.js');

    const registry = new HandlerRegistry();

    // getOrCreate should create a handler if not registered
    const handler = registry.getOrCreate({ provider: 'ollama' });

    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });

  it('should cache created handlers', async () => {
    const { HandlerRegistry } = await import('../../src/services/handler-registry.js');

    const registry = new HandlerRegistry();

    // First call creates the handler
    const handler1 = registry.getOrCreate({ provider: 'ollama' });

    // Second call returns the same cached handler
    const handler2 = registry.getOrCreate({ provider: 'ollama' });

    expect(handler1).toBe(handler2);
  });
});
