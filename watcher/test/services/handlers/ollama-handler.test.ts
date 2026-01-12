/**
 * OllamaHandler Tests
 *
 * @behavior OllamaHandler connects to local Ollama server and handles requests
 * @acceptance-criteria AC-HANDLER-OLLAMA.1 through AC-HANDLER-OLLAMA.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';

import { OllamaHandler } from '../../../src/services/handlers/ollama-handler.js';

// Mock http.request
vi.mock('http', async () => {
  const actual = await vi.importActual('http');
  return {
    ...actual,
    request: vi.fn(),
  };
});

describe('OllamaHandler', () => {
  let handler: OllamaHandler;
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

    // Setup http.request mock
    mockRequest = vi.mocked(http.request);
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

    handler = new OllamaHandler({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create handler with default base URL', () => {
      const h = new OllamaHandler({});
      expect(h.getBaseUrl()).toBe('http://localhost:11434');
    });

    it('should create handler with custom base URL', () => {
      const h = new OllamaHandler({ baseUrl: 'http://192.168.1.100:11434' });
      expect(h.getBaseUrl()).toBe('http://192.168.1.100:11434');
    });

    it('should not require API key', () => {
      // Ollama is local - no API key needed
      const h = new OllamaHandler({});
      expect(h).toBeDefined();
    });
  });

  describe('handle', () => {
    it('should connect to local Ollama server', async () => {
      // Setup mock to return a valid response
      const responseData = JSON.stringify({
        model: 'codellama',
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: 'Hello!' },
        done: true,
        total_duration: 1000000000,
        prompt_eval_count: 10,
        eval_count: 5,
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
        model: 'codellama',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 100,
      };

      await handler.handle(request);

      // Verify request was made to localhost:11434
      expect(mockRequest).toHaveBeenCalled();
      const callOptions = mockRequest.mock.calls[0][0] as http.RequestOptions;
      expect(callOptions.hostname).toBe('localhost');
      expect(callOptions.port).toBe(11434);
      expect(callOptions.path).toBe('/api/chat');
    });

    it('should transform Anthropic request to Ollama format', async () => {
      const responseData = JSON.stringify({
        model: 'codellama',
        message: { role: 'assistant', content: 'Hi' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
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

      // Verify request body was transformed to Ollama format
      expect(mockClientRequest.write).toHaveBeenCalled();
      const writtenBody = JSON.parse(
        mockClientRequest.write.mock.calls[0][0] as string
      );

      // Ollama expects model name without provider prefix
      expect(writtenBody.model).toBeDefined();
      // Ollama uses "messages" array
      expect(writtenBody.messages).toBeDefined();
      // Ollama handles system message separately or as first message
      expect(
        writtenBody.system === 'You are helpful' ||
          writtenBody.messages[0].content === 'You are helpful'
      ).toBe(true);
    });

    it('should transform Ollama response to Anthropic format', async () => {
      const ollamaResponse = {
        model: 'codellama',
        message: { role: 'assistant', content: 'Hello!' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      };

      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(JSON.stringify(ollamaResponse)), 0);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 10);
          }
          return mockResponse;
        }
      );

      const response = await handler.handle({
        model: 'codellama',
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

    it('should detect Ollama not running', async () => {
      // Simulate connection refused
      mockClientRequest.on.mockImplementation(
        (event: string, callback: (error?: Error) => void) => {
          if (event === 'error') {
            const error = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
            error.code = 'ECONNREFUSED';
            setTimeout(() => callback(error), 0);
          }
          return mockClientRequest;
        }
      );

      await expect(
        handler.handle({
          model: 'codellama',
          messages: [{ role: 'user' as const, content: 'Hello' }],
          max_tokens: 100,
        })
      ).rejects.toThrow(/Ollama.*not running/i);
    });

    it('should handle Ollama API errors', async () => {
      mockResponse.statusCode = 404;
      const errorData = JSON.stringify({
        error: 'model "unknown-model" not found',
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
          model: 'unknown-model',
          messages: [{ role: 'user' as const, content: 'Hi' }],
          max_tokens: 100,
        })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('checkHealth', () => {
    it('should return true when Ollama is running', async () => {
      mockResponse.statusCode = 200;
      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') {
            setTimeout(() => callback('Ollama is running'), 0);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 10);
          }
          return mockResponse;
        }
      );

      const isHealthy = await handler.checkHealth();
      expect(isHealthy).toBe(true);
    });

    it('should return false when Ollama is not running', async () => {
      mockClientRequest.on.mockImplementation(
        (event: string, callback: (error?: Error) => void) => {
          if (event === 'error') {
            const error = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
            error.code = 'ECONNREFUSED';
            setTimeout(() => callback(error), 0);
          }
          return mockClientRequest;
        }
      );

      const isHealthy = await handler.checkHealth();
      expect(isHealthy).toBe(false);
    });
  });

  describe('getEndpoint', () => {
    it('should return Ollama chat endpoint', () => {
      expect(handler.getEndpoint()).toBe('http://localhost:11434/api/chat');
    });

    it('should use custom base URL in endpoint', () => {
      const h = new OllamaHandler({ baseUrl: 'http://192.168.1.100:11434' });
      expect(h.getEndpoint()).toBe('http://192.168.1.100:11434/api/chat');
    });
  });

  describe('listModels', () => {
    it('should list available models', async () => {
      const modelsResponse = JSON.stringify({
        models: [
          { name: 'codellama:latest', size: 1000000 },
          { name: 'llama3.2:latest', size: 2000000 },
        ],
      });

      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(modelsResponse), 0);
          }
          if (event === 'end') {
            setTimeout(() => callback(), 10);
          }
          return mockResponse;
        }
      );

      const models = await handler.listModels();

      expect(models).toContain('codellama:latest');
      expect(models).toContain('llama3.2:latest');
    });
  });
});
