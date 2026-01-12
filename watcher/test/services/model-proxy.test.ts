/**
 * ModelProxy Tests
 *
 * @behavior ModelProxy starts HTTP server and routes requests to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';

// These will be implemented
import { ModelProxy } from '../../src/services/model-proxy.js';

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
