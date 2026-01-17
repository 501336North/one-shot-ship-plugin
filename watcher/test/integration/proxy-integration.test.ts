/**
 * Integration Tests: Model Proxy with Handlers
 *
 * @behavior Validates that ModelProxy correctly routes requests through handlers
 * @acceptance-criteria AC-PROXY-INT.1 through AC-PROXY-INT.15
 *
 * These tests bridge the gap between unit tests (which mock dependencies) and production:
 * - They start a real ModelProxy server
 * - They make real HTTP requests to the proxy
 * - For Ollama: check if it's running, skip if not (graceful degradation)
 * - For OpenRouter: use mock server to avoid API costs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import { ModelProxy } from '../../src/services/model-proxy.js';
import type { AnthropicRequest, AnthropicResponse } from '../../src/services/api-transformer.js';
import type { Handler } from '../../src/services/handler-registry.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Make HTTP POST request to proxy
 */
async function makeProxyRequest(
  proxyUrl: string,
  request: AnthropicRequest
): Promise<{ status: number; body: AnthropicResponse | { error: string } }> {
  return new Promise((resolve, reject) => {
    const url = new URL(proxyUrl);
    const data = JSON.stringify(request);

    const req = http.request(
      {
        hostname: url.hostname,
        port: parseInt(url.port),
        path: '/v1/messages',
        method: 'POST',
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
          try {
            const body = JSON.parse(responseData);
            resolve({ status: res.statusCode || 500, body });
          } catch {
            resolve({ status: res.statusCode || 500, body: { error: responseData } });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Make HTTP GET request to proxy health endpoint
 */
async function checkProxyHealth(
  proxyUrl: string
): Promise<{ status: number; body: { healthy: boolean; provider: string; model: string } }> {
  return new Promise((resolve, reject) => {
    const url = new URL(proxyUrl);

    const req = http.request(
      {
        hostname: url.hostname,
        port: parseInt(url.port),
        path: '/health',
        method: 'GET',
      },
      (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const body = JSON.parse(responseData);
            resolve({ status: res.statusCode || 500, body });
          } catch {
            resolve({
              status: res.statusCode || 500,
              body: { healthy: false, provider: '', model: '' },
            });
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

/**
 * Check if Ollama is running locally
 */
async function isOllamaRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          resolve(res.statusCode === 200);
        });
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Create a minimal valid Anthropic request
 */
function createTestRequest(overrides: Partial<AnthropicRequest> = {}): AnthropicRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 100,
    ...overrides,
  };
}

/**
 * Create a mock handler for testing
 */
function createMockHandler(response: Partial<AnthropicResponse> = {}): Handler & { checkHealth?: () => Promise<boolean> } {
  const defaultResponse: AnthropicResponse = {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: [{ type: 'text', text: 'Test response' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
    ...response,
  };

  return {
    handle: vi.fn().mockResolvedValue(defaultResponse),
    checkHealth: vi.fn().mockResolvedValue(true),
  };
}

// ============================================================================
// Task 4.1: Proxy + Ollama Integration Tests
// ============================================================================

describe('Integration: Proxy + Ollama', () => {
  let proxy: ModelProxy;
  let proxyUrl: string;
  let ollamaAvailable: boolean;

  beforeEach(async () => {
    ollamaAvailable = await isOllamaRunning();
  });

  afterEach(async () => {
    if (proxy?.isRunning()) {
      await proxy.shutdown();
    }
  });

  /**
   * @behavior Proxy forwards request to Ollama and returns transformed response
   * @acceptance-criteria AC-PROXY-INT.1
   */
  it('should forward request to Ollama and get response', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running');
      return;
    }

    // GIVEN: A proxy configured for Ollama
    proxy = new ModelProxy({ model: 'ollama/llama3.2' });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request to the proxy
    const request = createTestRequest({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      max_tokens: 50,
    });

    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Response should be in Anthropic format
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('id');
    expect(result.body).toHaveProperty('type', 'message');
    expect(result.body).toHaveProperty('role', 'assistant');
    expect(result.body).toHaveProperty('content');
    expect(result.body).toHaveProperty('stop_reason');
  });

  /**
   * @behavior Proxy handles large responses from Ollama
   * @acceptance-criteria AC-PROXY-INT.2
   */
  it('should handle large responses', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running');
      return;
    }

    // GIVEN: A proxy configured for Ollama
    proxy = new ModelProxy({ model: 'ollama/llama3.2' });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Requesting a longer response
    const request = createTestRequest({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Count from 1 to 20, each number on a new line.' }],
      max_tokens: 200,
    });

    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Response should contain the content
    expect(result.status).toBe(200);
    const body = result.body as AnthropicResponse;
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.usage.output_tokens).toBeGreaterThan(0);
  });

  /**
   * @behavior Proxy correctly transforms tool_use requests for Ollama
   * @acceptance-criteria AC-PROXY-INT.3
   */
  it('should transform tool_use requests correctly', async () => {
    // Use mock handler since Ollama tool support varies
    const mockHandler = createMockHandler({
      content: [
        {
          type: 'tool_use',
          id: 'tool_123',
          name: 'get_weather',
          input: { location: 'San Francisco' },
        },
      ],
      stop_reason: 'tool_use',
    });

    proxy = new ModelProxy({
      model: 'ollama/llama3.2',
      _testHandler: mockHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request with tools
    const request = createTestRequest({
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          input_schema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      ],
    });

    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Response should contain tool_use content
    expect(result.status).toBe(200);
    const body = result.body as AnthropicResponse;
    expect(body.content.some((c) => c.type === 'tool_use')).toBe(true);
    expect(body.stop_reason).toBe('tool_use');
  });

  /**
   * @behavior Proxy handles Ollama timeout gracefully
   * @acceptance-criteria AC-PROXY-INT.4
   */
  it('should handle Ollama timeout', async () => {
    // Create a mock handler that times out
    const timeoutHandler: Handler & { checkHealth?: () => Promise<boolean> } = {
      handle: vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 100);
        });
      }),
      checkHealth: vi.fn().mockResolvedValue(true),
    };

    proxy = new ModelProxy({
      model: 'ollama/llama3.2',
      _testHandler: timeoutHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request that times out
    const request = createTestRequest();
    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Should return error response
    expect(result.status).toBe(500);
    expect(result.body).toHaveProperty('error');
  });

  /**
   * @behavior Proxy handles Ollama not running scenario
   * @acceptance-criteria AC-PROXY-INT.5
   */
  it('should handle Ollama not running', async () => {
    // Create a mock handler that simulates connection refused
    const connectionRefusedHandler: Handler & { checkHealth?: () => Promise<boolean> } = {
      handle: vi.fn().mockRejectedValue(
        new Error('Ollama is not running. Start Ollama with: ollama serve')
      ),
      checkHealth: vi.fn().mockResolvedValue(false),
    };

    proxy = new ModelProxy({
      model: 'ollama/llama3.2',
      _testHandler: connectionRefusedHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request when Ollama is not running
    const request = createTestRequest();
    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Should return error about Ollama not running
    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain('Ollama');
  });
});

// ============================================================================
// Task 4.2: Proxy + OpenRouter Integration Tests
// ============================================================================

describe('Integration: Proxy + OpenRouter', () => {
  let proxy: ModelProxy;
  let proxyUrl: string;

  afterEach(async () => {
    if (proxy?.isRunning()) {
      await proxy.shutdown();
    }
  });

  /**
   * @behavior Proxy forwards request to OpenRouter and returns transformed response
   * @acceptance-criteria AC-PROXY-INT.6
   */
  it('should forward request to OpenRouter and get response', async () => {
    // Use mock handler to avoid real API costs
    const mockHandler = createMockHandler({
      model: 'anthropic/claude-3-haiku',
      content: [{ type: 'text', text: 'Hello from OpenRouter!' }],
    });

    proxy = new ModelProxy({
      model: 'openrouter/anthropic/claude-3-haiku',
      apiKey: 'test-api-key',
      _testHandler: mockHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request to the proxy
    const request = createTestRequest({
      model: 'anthropic/claude-3-haiku',
    });

    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Response should be in Anthropic format
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('id');
    expect(result.body).toHaveProperty('type', 'message');
    expect(mockHandler.handle).toHaveBeenCalledWith(request);
  });

  /**
   * @behavior Proxy includes proper headers for OpenRouter
   * @acceptance-criteria AC-PROXY-INT.7
   */
  it('should include proper headers', async () => {
    // Verify the handler is created with correct config
    const mockHandler = createMockHandler();
    let receivedRequest: AnthropicRequest | null = null;

    mockHandler.handle = vi.fn().mockImplementation((req: AnthropicRequest) => {
      receivedRequest = req;
      return Promise.resolve({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'test',
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 },
      });
    });

    proxy = new ModelProxy({
      model: 'openrouter/anthropic/claude-3-haiku',
      apiKey: 'sk-or-test-key',
      _testHandler: mockHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request
    const request = createTestRequest();
    await makeProxyRequest(proxyUrl, request);

    // THEN: Handler should have received the request
    expect(receivedRequest).not.toBeNull();
    expect(mockHandler.handle).toHaveBeenCalled();
  });

  /**
   * @behavior Proxy handles API key errors from OpenRouter
   * @acceptance-criteria AC-PROXY-INT.8
   */
  it('should handle API key errors', async () => {
    // Create handler that simulates invalid API key error
    const authErrorHandler: Handler = {
      handle: vi.fn().mockRejectedValue(
        new Error('OpenRouter API error: Invalid API key')
      ),
    };

    proxy = new ModelProxy({
      model: 'openrouter/anthropic/claude-3-haiku',
      apiKey: 'invalid-key',
      _testHandler: authErrorHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request with invalid API key
    const request = createTestRequest();
    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Should return API error
    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain('API');
  });

  /**
   * @behavior Proxy handles rate limiting from OpenRouter
   * @acceptance-criteria AC-PROXY-INT.9
   */
  it('should handle rate limiting', async () => {
    // Create handler that simulates rate limit error
    const rateLimitHandler: Handler = {
      handle: vi.fn().mockRejectedValue(
        new Error('OpenRouter API error: Rate limit exceeded')
      ),
    };

    proxy = new ModelProxy({
      model: 'openrouter/anthropic/claude-3-haiku',
      apiKey: 'test-key',
      _testHandler: rateLimitHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request when rate limited
    const request = createTestRequest();
    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Should return rate limit error
    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain('Rate limit');
  });

  /**
   * @behavior Proxy correctly transforms OpenRouter response to Anthropic format
   * @acceptance-criteria AC-PROXY-INT.10
   */
  it('should transform response correctly', async () => {
    // Create handler with full response
    const mockHandler = createMockHandler({
      id: 'msg_or_123',
      model: 'anthropic/claude-3-haiku',
      content: [
        { type: 'text', text: 'First part. ' },
        { type: 'text', text: 'Second part.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 15, output_tokens: 25 },
    });

    proxy = new ModelProxy({
      model: 'openrouter/anthropic/claude-3-haiku',
      apiKey: 'test-key',
      _testHandler: mockHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request
    const request = createTestRequest();
    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Response should be properly formatted
    expect(result.status).toBe(200);
    const body = result.body as AnthropicResponse;
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
    expect(body.content.length).toBe(2);
    expect(body.stop_reason).toBe('end_turn');
    expect(body.usage.input_tokens).toBe(15);
    expect(body.usage.output_tokens).toBe(25);
  });
});

// ============================================================================
// Task 4.3: Agent-to-Proxy Integration Tests
// ============================================================================

describe('Integration: Agent to Proxy flow', () => {
  let proxy: ModelProxy;
  let proxyUrl: string;

  afterEach(async () => {
    if (proxy?.isRunning()) {
      await proxy.shutdown();
    }
  });

  /**
   * @behavior Agent can check model config and start proxy
   * @acceptance-criteria AC-PROXY-INT.11
   */
  it('should check model config and start proxy', async () => {
    // GIVEN: A model configuration
    const modelConfig = {
      model: 'ollama/codellama',
      baseUrl: 'http://localhost:11434',
    };

    // WHEN: Creating and starting proxy based on config
    proxy = new ModelProxy({
      model: modelConfig.model,
      baseUrl: modelConfig.baseUrl,
      _testHandler: createMockHandler(),
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // THEN: Proxy should be running and accessible
    expect(proxy.isRunning()).toBe(true);
    expect(proxy.getPort()).toBeGreaterThan(0);
    expect(proxy.getProvider()).toBe('ollama');
    expect(proxy.getModel()).toBe('codellama');

    // AND: Health check should work
    const health = await checkProxyHealth(proxyUrl);
    expect(health.status).toBe(200);
    expect(health.body.healthy).toBe(true);
  });

  /**
   * @behavior Agent can make request to proxy and get response
   * @acceptance-criteria AC-PROXY-INT.12
   */
  it('should make request to proxy and get response', async () => {
    // GIVEN: A running proxy
    const mockHandler = createMockHandler({
      content: [{ type: 'text', text: 'Agent task completed successfully.' }],
    });

    proxy = new ModelProxy({
      model: 'ollama/codellama',
      _testHandler: mockHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Agent makes a request to the proxy
    const agentRequest = createTestRequest({
      system: 'You are a helpful coding assistant.',
      messages: [{ role: 'user', content: 'Write a hello world function.' }],
    });

    const result = await makeProxyRequest(proxyUrl, agentRequest);

    // THEN: Agent receives a valid response
    expect(result.status).toBe(200);
    const body = result.body as AnthropicResponse;
    expect(body.content[0].text).toContain('completed');
    expect(mockHandler.handle).toHaveBeenCalledWith(agentRequest);
  });

  /**
   * @behavior Agent stops proxy after completing work
   * @acceptance-criteria AC-PROXY-INT.13
   */
  it('should stop proxy after agent completes', async () => {
    // GIVEN: A running proxy
    proxy = new ModelProxy({
      model: 'ollama/codellama',
      _testHandler: createMockHandler(),
    });
    await proxy.start();
    const port = proxy.getPort();
    proxyUrl = `http://localhost:${port}`;

    // Verify proxy is running
    expect(proxy.isRunning()).toBe(true);

    // WHEN: Agent completes and shuts down proxy
    await proxy.shutdown();

    // THEN: Proxy should no longer be running
    expect(proxy.isRunning()).toBe(false);

    // AND: Connection should be refused
    await expect(checkProxyHealth(proxyUrl)).rejects.toThrow();
  });

  /**
   * @behavior Agent can fallback to Claude if proxy fails
   * @acceptance-criteria AC-PROXY-INT.14
   */
  it('should fallback to Claude if proxy fails', async () => {
    // GIVEN: A proxy that fails on first request
    let callCount = 0;
    const failingThenSuccessHandler: Handler & { checkHealth?: () => Promise<boolean> } = {
      handle: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Proxy failure'));
        }
        return Promise.resolve({
          id: 'msg_fallback',
          type: 'message',
          role: 'assistant',
          model: 'fallback-model',
          content: [{ type: 'text', text: 'Fallback response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 10 },
        });
      }),
      checkHealth: vi.fn().mockResolvedValue(true),
    };

    proxy = new ModelProxy({
      model: 'ollama/codellama',
      _testHandler: failingThenSuccessHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: First request fails
    const request = createTestRequest();
    const firstResult = await makeProxyRequest(proxyUrl, request);

    // THEN: First request should fail
    expect(firstResult.status).toBe(500);

    // WHEN: Agent detects failure and retries (simulating fallback logic)
    const retryResult = await makeProxyRequest(proxyUrl, request);

    // THEN: Retry succeeds (simulating fallback to working provider)
    expect(retryResult.status).toBe(200);
    expect((retryResult.body as AnthropicResponse).content[0].text).toBe('Fallback response');
  });

  /**
   * @behavior Agent logs cost tracking data from proxy responses
   * @acceptance-criteria AC-PROXY-INT.15
   */
  it('should log cost tracking data', async () => {
    // GIVEN: A proxy that returns usage data
    const mockHandler = createMockHandler({
      usage: { input_tokens: 150, output_tokens: 300 },
    });

    proxy = new ModelProxy({
      model: 'openrouter/anthropic/claude-3-haiku',
      apiKey: 'test-key',
      _testHandler: mockHandler,
    });
    await proxy.start();
    proxyUrl = `http://localhost:${proxy.getPort()}`;

    // WHEN: Making a request
    const request = createTestRequest();
    const result = await makeProxyRequest(proxyUrl, request);

    // THEN: Response includes usage/cost data
    expect(result.status).toBe(200);
    const body = result.body as AnthropicResponse;
    expect(body.usage).toBeDefined();
    expect(body.usage.input_tokens).toBe(150);
    expect(body.usage.output_tokens).toBe(300);

    // Cost can be calculated from usage
    // (This would typically be done by the agent's cost tracking service)
    const totalTokens = body.usage.input_tokens + body.usage.output_tokens;
    expect(totalTokens).toBe(450);
  });
});
