/**
 * OpenRouterHandler Tests
 *
 * @behavior OpenRouterHandler forwards requests to OpenRouter API with proper authentication
 * @acceptance-criteria AC-HANDLER-OR.1 through AC-HANDLER-OR.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as https from 'https';

import { OpenRouterHandler } from '../../../src/services/handlers/openrouter-handler.js';

// Mock https.request
vi.mock('https', () => ({
  request: vi.fn(),
}));

describe('OpenRouterHandler', () => {
  let handler: OpenRouterHandler;
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockResponse: {
    statusCode: number;
    headers: Record<string, string>;
    on: ReturnType<typeof vi.fn>;
    pipe: ReturnType<typeof vi.fn>;
  };
  let mockClientRequest: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock response
    mockResponse = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      on: vi.fn(),
      pipe: vi.fn(),
    };

    // Create mock client request
    mockClientRequest = {
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    };

    // Setup https.request mock
    mockRequest = vi.mocked(https.request);
    mockRequest.mockImplementation(
      (
        _options: unknown,
        callback: (res: typeof mockResponse) => void
      ) => {
        // Call callback with mock response on next tick
        setTimeout(() => callback(mockResponse), 0);
        return mockClientRequest as unknown as http.ClientRequest;
      }
    );

    handler = new OpenRouterHandler({ apiKey: 'sk-or-test-key' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create handler with API key', () => {
      const h = new OpenRouterHandler({ apiKey: 'sk-or-xxx' });
      expect(h).toBeDefined();
    });

    it('should throw if API key is missing', () => {
      expect(() => new OpenRouterHandler({ apiKey: '' })).toThrow(
        /API key.*required/i
      );
    });
  });

  describe('getHeaders', () => {
    it('should include authorization header with API key', () => {
      const h = new OpenRouterHandler({ apiKey: 'sk-or-xxx' });
      const headers = h.getHeaders();

      expect(headers['Authorization']).toBe('Bearer sk-or-xxx');
    });

    it('should include Content-Type header', () => {
      const h = new OpenRouterHandler({ apiKey: 'sk-or-xxx' });
      const headers = h.getHeaders();

      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should include HTTP-Referer for OpenRouter attribution', () => {
      const h = new OpenRouterHandler({ apiKey: 'sk-or-xxx' });
      const headers = h.getHeaders();

      expect(headers['HTTP-Referer']).toBeDefined();
    });
  });

  describe('handle', () => {
    it('should forward requests to OpenRouter API', async () => {
      // Setup mock to return a valid response
      const responseData = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'deepseek/deepseek-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(responseData), 0);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 10);
          }
          return mockResponse;
        }
      );

      const request = {
        model: 'deepseek/deepseek-chat',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 100,
      };

      const response = await handler.handle(request);

      // Verify request was made to OpenRouter
      expect(mockRequest).toHaveBeenCalled();
      const callOptions = mockRequest.mock.calls[0][0] as https.RequestOptions;
      expect(callOptions.hostname).toBe('openrouter.ai');
      expect(callOptions.path).toBe('/api/v1/chat/completions');
    });

    it('should transform Anthropic request to OpenAI format', async () => {
      // Setup mock to return a valid response
      const responseData = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(responseData), 0);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 10);
          }
          return mockResponse;
        }
      );

      const anthropicRequest = {
        model: 'claude-3-opus',
        system: 'You are helpful',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 100,
      };

      await handler.handle(anthropicRequest);

      // Verify request body was transformed
      expect(mockClientRequest.write).toHaveBeenCalled();
      const writtenBody = JSON.parse(
        mockClientRequest.write.mock.calls[0][0] as string
      );

      // Should have system message prepended
      expect(writtenBody.messages[0].role).toBe('system');
      expect(writtenBody.messages[0].content).toBe('You are helpful');
    });

    it('should transform OpenAI response to Anthropic format', async () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'deepseek/deepseek-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(JSON.stringify(openaiResponse)), 0);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 10);
          }
          return mockResponse;
        }
      );

      const response = await handler.handle({
        model: 'deepseek/deepseek-chat',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 100,
      });

      // Response should be in Anthropic format
      expect(response.content).toBeDefined();
      expect(response.content[0].type).toBe('text');
      expect((response.content[0] as { type: 'text'; text: string }).text).toBe(
        'Hello!'
      );
      expect(response.usage.input_tokens).toBe(10);
      expect(response.usage.output_tokens).toBe(5);
    });

    it('should handle API errors', async () => {
      mockResponse.statusCode = 401;
      const errorData = JSON.stringify({
        error: { message: 'Invalid API key' },
      });

      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(errorData), 0);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 10);
          }
          return mockResponse;
        }
      );

      await expect(
        handler.handle({
          model: 'test',
          messages: [{ role: 'user' as const, content: 'Hi' }],
          max_tokens: 100,
        })
      ).rejects.toThrow(/API error/i);
    });

    it('should handle network errors', async () => {
      mockClientRequest.on.mockImplementation(
        (event: string, callback: (error?: Error) => void) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Connection refused')), 0);
          }
          return mockClientRequest;
        }
      );

      await expect(
        handler.handle({
          model: 'test',
          messages: [{ role: 'user' as const, content: 'Hi' }],
          max_tokens: 100,
        })
      ).rejects.toThrow(/Connection refused/);
    });
  });

  describe('getEndpoint', () => {
    it('should return OpenRouter chat completions endpoint', () => {
      expect(handler.getEndpoint()).toBe(
        'https://openrouter.ai/api/v1/chat/completions'
      );
    });
  });
});
