/**
 * ModelProxy Tests
 *
 * @behavior ModelProxy starts HTTP server and routes requests to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.5
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// These will be implemented
import { ModelProxy } from '../../src/services/model-proxy.js';
import type { Handler } from '../../src/services/handler-registry.js';
import type { AnthropicRequest, AnthropicResponse } from '../../src/services/api-transformer.js';

describe('ModelProxy', () => {
  let proxy: ModelProxy;

  afterEach(async () => {
    // Clean up any running proxy
    if (proxy && proxy.isRunning()) {
      await proxy.shutdown();
    }
  });

  describe('constructor', () => {
    it('should create proxy with provider configuration', () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      expect(proxy).toBeDefined();
      expect(proxy.isRunning()).toBe(false);
    });

    it('should create proxy without API key for local providers', () => {
      proxy = new ModelProxy({
        provider: 'ollama',
      });

      expect(proxy).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start on available port', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      expect(proxy.isRunning()).toBe(true);
      expect(proxy.getPort()).toBeGreaterThan(0);
    });

    it('should bind to localhost only', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      // Verify the server is listening on localhost
      const address = proxy.getAddress();
      expect(address).toBe('127.0.0.1');
    });

    it('should reject start if already running', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();
      await expect(proxy.start()).rejects.toThrow(/already running/i);
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();
      const port = proxy.getPort();

      await proxy.shutdown();

      expect(proxy.isRunning()).toBe(false);

      // Verify port is released by trying to use it
      await verifyPortAvailable(port);
    });

    it('should be safe to call shutdown when not running', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      // Should not throw
      await expect(proxy.shutdown()).resolves.toBeUndefined();
    });

    it('should close active connections gracefully', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      // Create an active connection that we will abort
      const controller = new AbortController();
      const requestPromise = new Promise<void>((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: proxy.getPort(),
            path: '/v1/messages',
            method: 'POST',
          },
          () => {
            resolve();
          }
        );

        req.on('error', () => {
          // Expected - connection will be destroyed during shutdown
          resolve();
        });

        // Start the request
        req.write(JSON.stringify({ model: 'test', messages: [] }));

        // Store req for abort
        controller.signal.addEventListener('abort', () => {
          req.destroy();
        });
      });

      // Shutdown should still complete
      await proxy.shutdown();
      controller.abort();
      await requestPromise;

      expect(proxy.isRunning()).toBe(false);
    });
  });

  describe('routing', () => {
    it('should route POST /v1/messages to handler', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'test',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      });

      // Handler should process the request (even if it fails due to mock)
      expect(response.status).toBeDefined();
    });

    it('logs each /v1/messages request to OSS_PROXY_LOG (model + timestamp) for routing verification', async () => {
      const logPath = path.join(os.tmpdir(), `proxy-log-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`);
      process.env.OSS_PROXY_LOG = logPath;
      try {
        const testHandler = {
          handle: async () => ({ id: 'x', type: 'message', role: 'assistant', model: 'gpt-oss:120b', content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
          healthCheck: async () => true,
        };
        proxy = new ModelProxy({ model: 'ollama/gpt-oss:120b', port: 0, _testHandler: testHandler } as never);
        await proxy.start();

        await makeRequest(proxy.getPort(), '/v1/messages', {
          model: 'gpt-oss:120b',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 4,
        });

        const logged = fs.readFileSync(logPath, 'utf-8');
        expect(logged).toContain('gpt-oss:120b');
        expect(logged).toContain('ollama');
      } finally {
        delete process.env.OSS_PROXY_LOG;
        try { fs.unlinkSync(logPath); } catch { /* ignore */ }
      }
    });

    it('forces the proxy configured model onto the request (client cannot select a foreign model)', async () => {
      // @behavior A nested `claude -p` session cannot pass a foreign model id (the Claude CLI
      // rejects unknown --model client-side), so it sends its DEFAULT claude id. The proxy must
      // override that with its configured model — otherwise Ollama 404s. (live-proof finding)
      let received: { model?: string } | undefined;
      const testHandler = {
        handle: async (req: { model?: string }) => {
          received = req;
          return { id: 'x', type: 'message' as const, role: 'assistant' as const, model: 'gpt-oss:120b', content: [], stop_reason: 'end_turn' as const, usage: { input_tokens: 1, output_tokens: 1 } };
        },
        healthCheck: async () => true,
      };
      proxy = new ModelProxy({ model: 'ollama/gpt-oss:120b', port: 0, _testHandler: testHandler } as never);
      await proxy.start();

      await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'claude-sonnet-4-5', // what a nested `claude -p` sends by default
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 4,
      });

      expect(received?.model).toBe('ollama/gpt-oss:120b');
    });

    it('does NOT write the legacy default log when OSS_PROXY_LOG is unset (opt-in only)', async () => {
      const prev = process.env.OSS_PROXY_LOG;
      delete process.env.OSS_PROXY_LOG;
      // The previous implementation appended to this path even when unset. With the opt-in
      // guard, an unset env var means a no-op — this file must be untouched.
      const legacyDefault = path.join(os.homedir(), '.oss', 'proxy-requests.log');
      const before = fs.existsSync(legacyDefault) ? fs.statSync(legacyDefault).mtimeMs : null;
      try {
        const testHandler = {
          handle: async () => ({ id: 'x', type: 'message', role: 'assistant', model: 'gpt-oss:120b', content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
          healthCheck: async () => true,
        };
        proxy = new ModelProxy({ model: 'ollama/gpt-oss:120b', port: 0, _testHandler: testHandler } as never);
        await proxy.start();

        await makeRequest(proxy.getPort(), '/v1/messages', {
          model: 'gpt-oss:120b',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 4,
        });

        const after = fs.existsSync(legacyDefault) ? fs.statSync(legacyDefault).mtimeMs : null;
        expect(after).toBe(before); // unchanged (or still absent) → no write happened
      } finally {
        if (prev !== undefined) process.env.OSS_PROXY_LOG = prev;
      }
    });

    it('should return 404 for unknown routes', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/unknown', {});

      expect(response.status).toBe(404);
    });

    it('should return 405 for non-POST methods on /v1/messages', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      const response = await makeRequest(
        proxy.getPort(),
        '/v1/messages',
        {},
        'GET'
      );

      expect(response.status).toBe(405);
    });

    it('should return 400 for invalid JSON body', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      const response = await makeRawRequest(
        proxy.getPort(),
        '/v1/messages',
        'not-valid-json'
      );

      expect(response.status).toBe(400);
    });
  });

  describe('getPort', () => {
    it('should return 0 when not running', () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      expect(proxy.getPort()).toBe(0);
    });

    it('should return assigned port when running', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      const port = proxy.getPort();
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65535);
    });
  });

  describe('isRunning', () => {
    it('should return false before start', () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      expect(proxy.isRunning()).toBe(false);
    });

    it('should return true after start', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();

      expect(proxy.isRunning()).toBe(true);
    });

    it('should return false after shutdown', async () => {
      proxy = new ModelProxy({
        provider: 'openrouter',
        apiKey: 'test-key',
      });

      await proxy.start();
      await proxy.shutdown();

      expect(proxy.isRunning()).toBe(false);
    });
  });

  // ============================================================================
  // Phase 2: Wire ModelProxy to Handlers
  // ============================================================================

  describe('Phase 2 - Model String Constructor', () => {
    /**
     * @behavior ModelProxy accepts model string format (e.g., "ollama/codellama")
     * @acceptance-criteria AC-PROXY.6
     */
    it('should accept model string (e.g., "ollama/codellama")', () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
      });

      expect(proxy).toBeDefined();
      expect(proxy.getModel()).toBe('codellama');
    });

    it('should parse provider from model string', () => {
      proxy = new ModelProxy({
        model: 'openrouter/anthropic/claude-3-haiku',
        apiKey: 'test-key',
      });

      expect(proxy.getProvider()).toBe('openrouter');
    });

    it('should accept optional apiKey', () => {
      proxy = new ModelProxy({
        model: 'openrouter/deepseek/deepseek-chat',
        apiKey: 'sk-or-test-key',
      });

      expect(proxy).toBeDefined();
    });

    it('should accept optional port (default 0 for auto-assign)', () => {
      proxy = new ModelProxy({
        model: 'ollama/llama2',
        port: 3456,
      });

      expect(proxy).toBeDefined();
    });
  });

  describe('Phase 2 - Handler Selection', () => {
    /**
     * @behavior ModelProxy selects correct handler based on provider
     * @acceptance-criteria AC-PROXY.7
     */
    it('should select OllamaHandler for ollama/* models', () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
      });

      expect(proxy.getHandlerType()).toBe('ollama');
    });

    it('should select OpenRouterHandler for openrouter/* models', () => {
      proxy = new ModelProxy({
        model: 'openrouter/deepseek/deepseek-chat',
        apiKey: 'test-key',
      });

      expect(proxy.getHandlerType()).toBe('openrouter');
    });

    it('should extract model name from model string', () => {
      // For ollama/codellama, model name is "codellama"
      proxy = new ModelProxy({
        model: 'ollama/codellama',
      });
      expect(proxy.getModel()).toBe('codellama');

      // For openrouter/anthropic/claude-3-haiku, model name is "anthropic/claude-3-haiku"
      const proxy2 = new ModelProxy({
        model: 'openrouter/anthropic/claude-3-haiku',
        apiKey: 'test-key',
      });
      expect(proxy2.getModel()).toBe('anthropic/claude-3-haiku');
    });

    it('should throw for unsupported provider', () => {
      expect(() => {
        new ModelProxy({
          model: 'unsupported/some-model',
        });
      }).toThrow(/unsupported provider/i);
    });
  });

  describe('Phase 2 - Request Forwarding', () => {
    let mockHandler: Handler;
    let mockResponse: AnthropicResponse;

    beforeEach(() => {
      mockResponse = {
        id: 'msg_test123',
        type: 'message',
        role: 'assistant',
        model: 'codellama',
        content: [{ type: 'text', text: 'Hello from mock handler' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockHandler = {
        handle: vi.fn().mockResolvedValue(mockResponse),
      };
    });

    /**
     * @behavior ModelProxy parses incoming Anthropic request and forwards to handler
     * @acceptance-criteria AC-PROXY.8
     */
    it('should parse incoming Anthropic request', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler, // Inject mock handler for testing
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'codellama',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      });

      expect(response.status).toBe(200);
      expect(mockHandler.handle).toHaveBeenCalled();
    });

    it('should forward to handler.handle()', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'codellama',
        messages: [{ role: 'user', content: 'Test message' }],
        max_tokens: 100,
      });

      expect(mockHandler.handle).toHaveBeenCalledWith(
        expect.objectContaining({
          // Proxy forces its configured model (overriding the request's 'codellama').
          model: 'ollama/codellama',
          messages: [{ role: 'user', content: 'Test message' }],
          max_tokens: 100,
        })
      );
    });

    it('answers HEAD / with 200 (claude CLI reachability probe — else it reports "model may not exist")', async () => {
      proxy = new ModelProxy({ model: 'ollama/codellama', _testHandler: mockHandler });
      await proxy.start();
      const res = await makeRequest(proxy.getPort(), '/', {}, 'HEAD');
      expect(res.status).toBe(200);
    });

    it('routes /v1/messages even with a query string (claude sends ?beta=true)', async () => {
      proxy = new ModelProxy({ model: 'ollama/codellama', _testHandler: mockHandler });
      await proxy.start();
      await makeRequest(proxy.getPort(), '/v1/messages?beta=true', {
        model: 'codellama',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 4,
      });
      expect(mockHandler.handle).toHaveBeenCalled();
    });

    it('emits an Anthropic SSE event stream when stream:true (the Claude CLI always streams)', async () => {
      proxy = new ModelProxy({ model: 'ollama/codellama', _testHandler: mockHandler });
      await proxy.start();

      const res = await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'codellama',
        stream: true,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      });

      const sse = res.body as string;
      // Anthropic SSE event sequence the Claude CLI expects to parse.
      expect(sse).toContain('event: message_start');
      expect(sse).toContain('event: content_block_start');
      expect(sse).toContain('event: content_block_delta');
      expect(sse).toContain('Hello from mock handler'); // the model's text, as a text_delta
      expect(sse).toContain('event: content_block_stop');
      expect(sse).toContain('event: message_delta');
      expect(sse).toContain('event: message_stop');
    });

    it('flushes message_start immediately, before the slow backend responds (prevents client idle-timeout)', async () => {
      // @behavior With a buffered SSE, the client (claude -p) sees ~40s of silence while gpt-oss
      // thinks, times out, and retries (observed: an 11-call loop). The proxy must flush the
      // opening events right away and keep the stream alive until the backend returns.
      let resolveHandler!: (r: unknown) => void;
      const slowHandler = {
        handle: () => new Promise((r) => { resolveHandler = r; }),
        healthCheck: async () => true,
      };
      proxy = new ModelProxy({ model: 'ollama/gpt-oss:120b', port: 0, _testHandler: slowHandler } as never);
      await proxy.start();

      const chunks: string[] = [];
      const done = new Promise<void>((resolve) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: proxy.getPort(), path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (res) => {
            res.on('data', (c) => chunks.push(c.toString()));
            res.on('end', () => resolve());
          }
        );
        req.end(JSON.stringify({ model: 'x', stream: true, messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }));
      });

      // While the backend is still pending, message_start must already be on the wire.
      await new Promise((r) => setTimeout(r, 150));
      expect(chunks.join('')).toContain('event: message_start');

      // Now let the backend finish; the stream must complete cleanly.
      resolveHandler({ id: 'm', type: 'message', role: 'assistant', model: 'gpt-oss:120b', content: [{ type: 'text', text: 'DONE_TEXT' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
      await done;
      const full = chunks.join('');
      expect(full).toContain('DONE_TEXT');
      expect(full).toContain('event: message_stop');
    });

    it('streams tool_use content blocks (input_json_delta) when the model calls a tool', async () => {
      // @behavior gpt-oss can call tools; the SSE must surface tool_use blocks so the Claude CLI
      // executes the tool (not just stream text). stop_reason must be tool_use.
      const toolHandler = {
        handle: async () => ({
          id: 'm', type: 'message' as const, role: 'assistant' as const, model: 'gpt-oss:120b',
          content: [{ type: 'tool_use' as const, id: 'toolu_9', name: 'Read', input: { path: 'a.ts' } }],
          stop_reason: 'tool_use' as const, usage: { input_tokens: 1, output_tokens: 1 },
        }),
        healthCheck: async () => true,
      };
      proxy = new ModelProxy({ model: 'ollama/gpt-oss:120b', port: 0, _testHandler: toolHandler } as never);
      await proxy.start();

      const res = await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'x', stream: true,
        messages: [{ role: 'user', content: 'read a.ts' }], max_tokens: 50,
      });
      const sse = res.body as string;
      expect(sse).toContain('"type":"tool_use"');
      expect(sse).toContain('"name":"Read"');
      expect(sse).toContain('input_json_delta');
      expect(sse).toContain('"stop_reason":"tool_use"');
    });

    it('should return handler response as JSON', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'codellama',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      });

      expect(response.status).toBe(200);
      const body = response.body as AnthropicResponse;
      expect(body.id).toBe('msg_test123');
      expect(body.content[0]).toEqual({ type: 'text', text: 'Hello from mock handler' });
    });

    it('should handle handler errors gracefully', async () => {
      const errorHandler: Handler = {
        handle: vi.fn().mockRejectedValue(new Error('Handler failed')),
      };

      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: errorHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'codellama',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual(expect.objectContaining({
        error: expect.stringContaining('Handler failed'),
      }));
    });

    it('should set correct Content-Type header', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      // Using raw http request to check headers
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const data = JSON.stringify({
          model: 'codellama',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
        });

        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: proxy.getPort(),
            path: '/v1/messages',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
          },
          resolve
        );

        req.on('error', reject);
        req.write(data);
        req.end();
      });

      expect(response.headers['content-type']).toBe('application/json');
    });

    it('should return 500 on handler failure', async () => {
      const errorHandler: Handler = {
        handle: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };

      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: errorHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/v1/messages', {
        model: 'codellama',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      });

      expect(response.status).toBe(500);
    });
  });

  describe('Phase 2 - Health Check Endpoint', () => {
    let mockHandler: Handler & { checkHealth?: () => Promise<boolean> };

    beforeEach(() => {
      mockHandler = {
        handle: vi.fn().mockResolvedValue({}),
        checkHealth: vi.fn().mockResolvedValue(true),
      };
    });

    /**
     * @behavior ModelProxy provides /health endpoint for monitoring
     * @acceptance-criteria AC-PROXY.9
     */
    it('should respond to GET /health', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/health', {}, 'GET');

      expect(response.status).toBeDefined();
    });

    it('should return 200 when proxy is running', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/health', {}, 'GET');

      expect(response.status).toBe(200);
    });

    it('should include provider in health response', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/health', {}, 'GET');

      expect(response.body).toEqual(expect.objectContaining({
        provider: 'ollama',
      }));
    });

    it('should include model in health response', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/health', {}, 'GET');

      expect(response.body).toEqual(expect.objectContaining({
        model: 'codellama',
      }));
    });

    it('should check handler connectivity (Ollama)', async () => {
      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: mockHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/health', {}, 'GET');

      expect(mockHandler.checkHealth).toHaveBeenCalled();
      expect(response.body).toEqual(expect.objectContaining({
        healthy: true,
      }));
    });

    it('should return 503 if handler unhealthy', async () => {
      const unhealthyHandler: Handler & { checkHealth?: () => Promise<boolean> } = {
        handle: vi.fn().mockResolvedValue({}),
        checkHealth: vi.fn().mockResolvedValue(false),
      };

      proxy = new ModelProxy({
        model: 'ollama/codellama',
        _testHandler: unhealthyHandler,
      });

      await proxy.start();

      const response = await makeRequest(proxy.getPort(), '/health', {}, 'GET');

      expect(response.status).toBe(503);
      expect(response.body).toEqual(expect.objectContaining({
        healthy: false,
      }));
    });
  });
});

// Helper functions

async function makeRequest(
  port: number,
  path: string,
  body: Record<string, unknown>,
  method = 'POST'
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let parsedBody: unknown;
          try {
            parsedBody = JSON.parse(responseData);
          } catch {
            parsedBody = responseData;
          }
          resolve({ status: res.statusCode || 0, body: parsedBody });
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function makeRawRequest(
  port: number,
  path: string,
  body: string
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let parsedBody: unknown;
          try {
            parsedBody = JSON.parse(responseData);
          } catch {
            parsedBody = responseData;
          }
          resolve({ status: res.statusCode || 0, body: parsedBody });
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function verifyPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve());
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is still in use`));
      } else {
        reject(err);
      }
    });
  });
}
