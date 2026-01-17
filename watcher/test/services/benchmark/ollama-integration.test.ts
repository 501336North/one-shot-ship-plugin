/**
 * @file Ollama Integration Tests via Proxy
 * @behavior OllamaIntegration routes requests through ModelProxy to local Ollama server
 * @acceptance-criteria AC-OLLAMA.1 through AC-OLLAMA.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OllamaIntegration } from '../../../src/services/benchmark/ollama-integration.js';
import type { BenchmarkTask } from '../../../src/services/benchmark/types.js';

// Mock the OllamaHandler to avoid actual network calls
vi.mock('../../../src/services/handlers/ollama-handler.js', () => ({
  OllamaHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    getBaseUrl: vi.fn().mockReturnValue('http://localhost:11434'),
    getEndpoint: vi.fn().mockReturnValue('http://localhost:11434/api/chat'),
    checkHealth: vi.fn(),
  })),
}));

describe('Ollama integration', () => {
  let ollamaIntegration: OllamaIntegration;
  let testTask: BenchmarkTask;
  let mockHandler: {
    handle: ReturnType<typeof vi.fn>;
    checkHealth: ReturnType<typeof vi.fn>;
    getBaseUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked handler
    const { OllamaHandler } = await import('../../../src/services/handlers/ollama-handler.js');
    mockHandler = {
      handle: vi.fn(),
      checkHealth: vi.fn(),
      getBaseUrl: vi.fn().mockReturnValue('http://localhost:11434'),
    };
    vi.mocked(OllamaHandler).mockImplementation(() => mockHandler as ReturnType<typeof OllamaHandler>);

    ollamaIntegration = new OllamaIntegration({
      model: 'qwen2.5-coder:7b',
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
   * @behavior OllamaIntegration initializes with ollama provider config for the proxy
   * @acceptance-criteria AC-OLLAMA.1
   */
  it('should start proxy with ollama provider', async () => {
    // GIVEN an OllamaIntegration instance
    // WHEN checking the provider type
    const provider = ollamaIntegration.getProvider();

    // THEN the provider should be 'ollama'
    expect(provider).toBe('ollama');
  });

  /**
   * @behavior OllamaIntegration routes requests to local Ollama server via handler
   * @acceptance-criteria AC-OLLAMA.2
   */
  it('should route requests to local Ollama', async () => {
    // GIVEN a successful Ollama response
    mockHandler.handle.mockResolvedValueOnce({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'qwen2.5-coder:7b',
      content: [{ type: 'text', text: 'Code review complete' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    // WHEN executing a task
    const result = await ollamaIntegration.executeTask(testTask);

    // THEN the handler should be called with transformed request
    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen2.5-coder:7b',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Review this code for issues',
          }),
        ]),
      })
    );

    // AND the result should contain the response
    expect(result.output).toBe('Code review complete');
    expect(result.provider).toBe('ollama');
  });

  /**
   * @behavior OllamaIntegration captures tokens from Ollama response usage field
   * @acceptance-criteria AC-OLLAMA.3
   */
  it('should capture tokens from Ollama response', async () => {
    // GIVEN an Ollama response with token counts
    mockHandler.handle.mockResolvedValueOnce({
      id: 'msg_456',
      type: 'message',
      role: 'assistant',
      model: 'qwen2.5-coder:7b',
      content: [{ type: 'text', text: 'Analysis complete' }],
      usage: { input_tokens: 175, output_tokens: 89 },
    });

    // WHEN executing a task
    const result = await ollamaIntegration.executeTask(testTask);

    // THEN the result should contain captured token counts
    expect(result.inputTokens).toBe(175);
    expect(result.outputTokens).toBe(89);
  });
});
