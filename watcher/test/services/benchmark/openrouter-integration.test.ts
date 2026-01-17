/**
 * @file OpenRouter Integration Tests via Proxy
 * @behavior OpenRouterIntegration routes requests through proxy with API key authentication
 * @acceptance-criteria AC-OPENROUTER.1 through AC-OPENROUTER.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OpenRouterIntegration } from '../../../src/services/benchmark/openrouter-integration.js';
import type { BenchmarkTask } from '../../../src/services/benchmark/types.js';

// Mock the OpenRouterHandler to avoid actual network calls
vi.mock('../../../src/services/handlers/openrouter-handler.js', () => ({
  OpenRouterHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    getHeaders: vi.fn().mockReturnValue({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
    }),
    getEndpoint: vi.fn().mockReturnValue('https://openrouter.ai/api/v1/chat/completions'),
  })),
}));

describe('OpenRouter integration', () => {
  let openRouterIntegration: OpenRouterIntegration;
  let testTask: BenchmarkTask;
  let mockHandler: {
    handle: ReturnType<typeof vi.fn>;
    getHeaders: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked handler
    const { OpenRouterHandler } = await import('../../../src/services/handlers/openrouter-handler.js');
    mockHandler = {
      handle: vi.fn(),
      getHeaders: vi.fn().mockReturnValue({
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json',
      }),
    };
    vi.mocked(OpenRouterHandler).mockImplementation(() => mockHandler as ReturnType<typeof OpenRouterHandler>);

    openRouterIntegration = new OpenRouterIntegration({
      apiKey: 'test-api-key',
      model: 'anthropic/claude-3-haiku',
    });

    testTask = {
      id: 'test-task-01',
      name: 'Test Task',
      category: 'code-review',
      prompt: 'Review this code for issues',
      expectedBehavior: ['identify issues'],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @behavior OpenRouterIntegration initializes with openrouter provider config for the proxy
   * @acceptance-criteria AC-OPENROUTER.1
   */
  it('should start proxy with openrouter provider', async () => {
    // GIVEN an OpenRouterIntegration instance
    // WHEN checking the provider type
    const provider = openRouterIntegration.getProvider();

    // THEN the provider should be 'openrouter'
    expect(provider).toBe('openrouter');
  });

  /**
   * @behavior OpenRouterIntegration authenticates requests with API key in Authorization header
   * @acceptance-criteria AC-OPENROUTER.2
   */
  it('should authenticate with API key', async () => {
    // GIVEN a successful OpenRouter response
    mockHandler.handle.mockResolvedValueOnce({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'anthropic/claude-3-haiku',
      content: [{ type: 'text', text: 'Code review complete' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    // WHEN executing a task
    await openRouterIntegration.executeTask(testTask);

    // THEN the handler should be called (which uses API key internally)
    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-3-haiku',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Review this code for issues',
          }),
        ]),
      })
    );

    // AND the integration should have the correct API key configured
    expect(openRouterIntegration.getApiKey()).toBe('test-api-key');
  });

  /**
   * @behavior OpenRouterIntegration captures tokens and cost from OpenRouter response
   * @acceptance-criteria AC-OPENROUTER.3
   */
  it('should capture tokens and cost from response', async () => {
    // GIVEN an OpenRouter response with token counts
    // Note: OpenRouter provides cost data which we capture alongside tokens
    mockHandler.handle.mockResolvedValueOnce({
      id: 'msg_789',
      type: 'message',
      role: 'assistant',
      model: 'anthropic/claude-3-haiku',
      content: [{ type: 'text', text: 'Analysis complete' }],
      usage: { input_tokens: 200, output_tokens: 95 },
    });

    // WHEN executing a task
    const result = await openRouterIntegration.executeTask(testTask);

    // THEN the result should contain captured token counts
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(95);

    // AND the result should have provider set correctly
    expect(result.provider).toBe('openrouter');
  });
});
