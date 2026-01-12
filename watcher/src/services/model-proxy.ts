/**
 * ModelProxy - HTTP proxy server that routes requests to model providers
 *
 * @behavior Starts HTTP server on localhost and routes /v1/messages to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.5
 */

import * as http from 'http';
import type { Provider } from '../types/model-settings.js';

/**
 * Configuration for ModelProxy
 */
export interface ModelProxyConfig {
  /** The provider to route requests to */
  provider: Provider;
  /** API key for the provider (not required for Ollama) */
  apiKey?: string;
  /** Base URL for the provider (optional, for Ollama customization) */
  baseUrl?: string;
}

/**
 * ModelProxy - HTTP server that proxies requests to model providers
 *
 * Creates a localhost HTTP server that:
 * - Accepts Anthropic-format requests on POST /v1/messages
 * - Transforms requests for the target provider
 * - Forwards to the provider and returns transformed responses
 */
export class ModelProxy {
  private config: ModelProxyConfig;
  private server: http.Server | null = null;
  private port = 0;
  private address = '127.0.0.1';
  private connections: Set<http.IncomingMessage['socket']> = new Set();

  constructor(config: ModelProxyConfig) {
    this.config = config;
  }

  /**
   * Start the proxy server on an available port
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Proxy server is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Track connections for graceful shutdown
      this.server.on('connection', (socket) => {
        this.connections.add(socket);
        socket.on('close', () => {
          this.connections.delete(socket);
        });
      });

      // Listen on port 0 to get an available port
      this.server.listen(0, this.address, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Shutdown the proxy server
   */
  async shutdown(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      // Destroy all active connections
      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();

      this.server!.close(() => {
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the address the server is bound to
   */
  getAddress(): string {
    return this.address;
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Handle incoming HTTP request
   */
  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // Route /v1/messages
    if (url === '/v1/messages') {
      if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      this.handleMessagesRequest(req, res);
      return;
    }

    // Unknown route
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Handle POST /v1/messages request
   */
  private handleMessagesRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      // Parse JSON body
      let requestBody: Record<string, unknown>;
      try {
        requestBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      // For now, return a placeholder response indicating the provider
      // This will be replaced with actual handler routing in Task 4.2
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `msg_${generateId()}`,
          type: 'message',
          role: 'assistant',
          model: this.config.provider,
          content: [
            {
              type: 'text',
              text: `Proxy received request for provider: ${this.config.provider}`,
            },
          ],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        })
      );
    });

    req.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });
  }
}

/**
 * Generate a random ID for responses
 */
function generateId(): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
