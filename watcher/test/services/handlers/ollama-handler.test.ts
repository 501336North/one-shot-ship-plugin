/**
 * OllamaHandler Tests
 *
 * @behavior OllamaHandler connects to local Ollama server and handles requests
 * @acceptance-criteria AC-HANDLER-OLLAMA.1 through AC-HANDLER-OLLAMA.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as https from 'https';

import { OllamaHandler } from '../../../src/services/handlers/ollama-handler.js';
import { createHandler } from '../../../src/services/handler-registry.js';

// Mock http.request
vi.mock('http', async () => {
  const actual = await vi.importActual('http');
  return {
    ...actual,
    request: vi.fn(),
  };
});

// Mock https.request (remote ollama over TLS must not be downgraded to plaintext)
vi.mock('https', async () => {
  const actual = await vi.importActual('https');
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

  describe('transport scheme', () => {
    it('uses https.request for an https:// base URL (no plaintext downgrade)', () => {
      vi.mocked(https.request).mockReturnValue(
        mockClientRequest as unknown as http.ClientRequest
      );
      const h = new OllamaHandler({ baseUrl: 'https://remote.example' });
      void h.listModels().catch(() => {}); // fire-and-forget: we only assert the transport choice
      expect(https.request).toHaveBeenCalledTimes(1);
      expect(http.request).not.toHaveBeenCalled();
    });

    it('uses http.request for an http:// base URL', () => {
      const h = new OllamaHandler({ baseUrl: 'http://localhost:11434' });
      void h.listModels().catch(() => {});
      expect(http.request).toHaveBeenCalledTimes(1);
      expect(https.request).not.toHaveBeenCalled();
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

    it('strips the ollama/ provider prefix from the model before sending to Ollama', async () => {
      // @behavior A request for "ollama/gpt-oss:120b" must reach Ollama as "gpt-oss:120b",
      // otherwise Ollama returns "model not found". Caught by the live deepblue proof.
      const responseData = JSON.stringify({
        model: 'gpt-oss:120b',
        message: { role: 'assistant', content: 'ok' },
        done: true,
        prompt_eval_count: 5,
        eval_count: 2,
      });
      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') setTimeout(() => callback(responseData), 0);
          if (event === 'end') setTimeout(() => callback(), 10);
          return mockResponse;
        }
      );

      await handler.handle({
        model: 'ollama/gpt-oss:120b',
        messages: [{ role: 'user' as const, content: 'Hi' }],
        max_tokens: 10,
      });

      const writtenBody = JSON.parse(
        mockClientRequest.write.mock.calls[0][0] as string
      );
      expect(writtenBody.model).toBe('gpt-oss:120b');
    });

    it('translates tool_use/tool_result history into ollama assistant.tool_calls + tool-role messages', async () => {
      const responseData = JSON.stringify({
        model: 'gpt-oss:120b', message: { role: 'assistant', content: 'done' }, done: true,
        prompt_eval_count: 5, eval_count: 2,
      });
      mockResponse.on.mockImplementation((event: string, cb: (d?: string) => void) => {
        if (event === 'data') setTimeout(() => cb(responseData), 0);
        if (event === 'end') setTimeout(() => cb(), 10);
        return mockResponse;
      });

      await handler.handle({
        model: 'ollama/gpt-oss:120b',
        max_tokens: 100,
        messages: [
          { role: 'user' as const, content: 'read a.ts' },
          { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'a.ts' } }] },
          { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents here' }] },
        ],
      });

      const body = JSON.parse(mockClientRequest.write.mock.calls[0][0] as string);
      // assistant tool_use → ollama assistant message carrying tool_calls
      const asst = body.messages.find((m: { role: string; tool_calls?: unknown }) => m.role === 'assistant' && m.tool_calls);
      expect(asst.tool_calls[0].function).toMatchObject({ name: 'Read', arguments: { path: 'a.ts' } });
      // tool_result → ollama tool-role message
      const toolMsg = body.messages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toBe('file contents here');
    });

    it('parses stringified tool-call arguments into an object (some ollama builds return a JSON string)', async () => {
      const responseData = JSON.stringify({
        model: 'gpt-oss:120b',
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ function: { name: 'Read', arguments: '{"path":"a.ts"}' } }], // string, not object
        },
        done: true, prompt_eval_count: 5, eval_count: 2,
      });
      mockResponse.on.mockImplementation((event: string, cb: (d?: string) => void) => {
        if (event === 'data') setTimeout(() => cb(responseData), 0);
        if (event === 'end') setTimeout(() => cb(), 10);
        return mockResponse;
      });

      const result = await handler.handle({
        model: 'ollama/gpt-oss:120b', max_tokens: 100,
        messages: [{ role: 'user' as const, content: 'read a.ts' }],
      });

      const toolUse = result.content.find((b) => b.type === 'tool_use') as { input: unknown };
      expect(toolUse.input).toEqual({ path: 'a.ts' }); // object, not the raw string
    });

    it('translates ollama tool_calls into Anthropic tool_use blocks with stop_reason tool_use', async () => {
      const responseData = JSON.stringify({
        model: 'gpt-oss:120b',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'Read', arguments: { path: 'a.ts' } } }],
        },
        done: true, prompt_eval_count: 5, eval_count: 2,
      });
      mockResponse.on.mockImplementation((event: string, cb: (d?: string) => void) => {
        if (event === 'data') setTimeout(() => cb(responseData), 0);
        if (event === 'end') setTimeout(() => cb(), 10);
        return mockResponse;
      });

      const result = await handler.handle({
        model: 'ollama/gpt-oss:120b',
        messages: [{ role: 'user' as const, content: 'read a.ts' }],
        max_tokens: 100,
      });

      const toolUse = result.content.find((b) => b.type === 'tool_use');
      expect(toolUse).toMatchObject({ type: 'tool_use', name: 'Read', input: { path: 'a.ts' } });
      expect((toolUse as { id: string }).id).toBeTruthy();
      expect(result.stop_reason).toBe('tool_use');
    });

    it('maps Anthropic tools to ollama function-tool format (lets gpt-oss call tools)', async () => {
      const responseData = JSON.stringify({
        model: 'gpt-oss:120b', message: { role: 'assistant', content: 'ok' }, done: true,
        prompt_eval_count: 5, eval_count: 2,
      });
      mockResponse.on.mockImplementation((event: string, cb: (d?: string) => void) => {
        if (event === 'data') setTimeout(() => cb(responseData), 0);
        if (event === 'end') setTimeout(() => cb(), 10);
        return mockResponse;
      });

      await handler.handle({
        model: 'ollama/gpt-oss:120b',
        messages: [{ role: 'user' as const, content: 'read a file' }],
        max_tokens: 100,
        tools: [{
          name: 'Read',
          description: 'read a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        }],
      });

      const body = JSON.parse(mockClientRequest.write.mock.calls[0][0] as string);
      expect(body.tools).toEqual([{
        type: 'function',
        function: {
          name: 'Read',
          description: 'read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      }]);
    });

    it('flattens an array-form system prompt to a string (the Claude CLI sends system as content blocks)', async () => {
      // @behavior Ollama's /api/chat requires message.content to be a STRING. Claude sends the
      // system prompt as an array of content blocks; passing that array through makes Ollama 500
      // ("cannot unmarshal array ... into string"), which the Claude CLI retries in a loop.
      const responseData = JSON.stringify({
        model: 'gpt-oss:120b',
        message: { role: 'assistant', content: 'ok' },
        done: true,
        prompt_eval_count: 5,
        eval_count: 2,
      });
      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') setTimeout(() => callback(responseData), 0);
          if (event === 'end') setTimeout(() => callback(), 10);
          return mockResponse;
        }
      );

      await handler.handle({
        model: 'ollama/gpt-oss:120b',
        system: [
          { type: 'text', text: 'You are Claude.' },
          { type: 'text', text: ' Be terse.' },
        ],
        messages: [{ role: 'user' as const, content: 'hi' }],
        max_tokens: 10,
      });

      const writtenBody = JSON.parse(mockClientRequest.write.mock.calls[0][0] as string);
      const sys = writtenBody.messages.find((m: { role: string }) => m.role === 'system');
      expect(typeof sys.content).toBe('string');
      expect(sys.content).toBe('You are Claude. Be terse.');
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

    it('returns [] when the response has no models array (does not throw)', async () => {
      const emptyResponse = JSON.stringify({}); // no `models` key
      mockResponse.on.mockImplementation(
        (event: string, callback: (data?: string) => void) => {
          if (event === 'data') setTimeout(() => callback(emptyResponse), 0);
          if (event === 'end') setTimeout(() => callback(), 10);
          return mockResponse;
        }
      );

      await expect(handler.listModels()).resolves.toEqual([]);
    });
  });

  describe('think control (per-model)', () => {
    // @behavior The proxy sends ollama's native top-level `think` flag ONLY for models listed in the
    // configured map, so verbose reasoning models can be served with thinking OFF. The value may be
    // `false`, so membership is keyed by EXISTENCE — `false` must survive (not be swallowed). Unlisted
    // models and the no-map default send NO `think` key (sending it to a non-thinking model can 400).
    function setOkResponse() {
      const responseData = JSON.stringify({
        model: 'x', message: { role: 'assistant', content: 'ok' }, done: true,
        prompt_eval_count: 1, eval_count: 1,
      });
      mockResponse.on.mockImplementation((event: string, cb: (d?: string) => void) => {
        if (event === 'data') setTimeout(() => cb(responseData), 0);
        if (event === 'end') setTimeout(() => cb(), 10);
        return mockResponse;
      });
    }
    const req = (model: string) => ({
      model,
      messages: [{ role: 'user' as const, content: 'hi' }],
      max_tokens: 16,
    });
    const sentBody = () => JSON.parse(mockClientRequest.write.mock.calls[0][0] as string);

    it('(a) configured think:false → body has think:false (value survives; ollama/ strip + bare-name match)', async () => {
      setOkResponse();
      const h = new OllamaHandler({ think: { 'qwen3.6:35b-a3b': false } });
      await h.handle(req('ollama/qwen3.6:35b-a3b'));
      const body = sentBody();
      expect('think' in body).toBe(true);
      expect(body.think).toBe(false);
    });

    it('(b) configured think:true → body has think:true', async () => {
      setOkResponse();
      const h = new OllamaHandler({ think: { 'qwen3.6:35b-a3b': true } });
      await h.handle(req('ollama/qwen3.6:35b-a3b'));
      expect(sentBody().think).toBe(true);
    });

    it('(c) unlisted model with a non-empty map → NO think key', async () => {
      setOkResponse();
      const h = new OllamaHandler({ think: { 'qwen3.6:35b-a3b': false } });
      await h.handle(req('ollama/gpt-oss:120b'));
      expect('think' in sentBody()).toBe(false);
    });

    it('(d) no map (default) → NO think key', async () => {
      setOkResponse();
      const h = new OllamaHandler({});
      await h.handle(req('ollama/qwen3.6:35b-a3b'));
      expect('think' in sentBody()).toBe(false);
    });

    it('(e) createHandler({provider:ollama, think}) forwards the map to the handler', async () => {
      setOkResponse();
      const h = createHandler({ provider: 'ollama', think: { 'qwen3.6:35b-a3b': false } });
      await h.handle(req('ollama/qwen3.6:35b-a3b'));
      expect(sentBody().think).toBe(false);
    });
  });
});
