/**
 * ModelProxy - HTTP proxy server that routes requests to model providers
 *
 * @behavior Starts HTTP server on localhost and routes /v1/messages to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.9
 */

import * as http from 'http';
import type { Provider } from '../types/model-settings.js';
import type { AnthropicRequest, AnthropicResponse } from './api-transformer.js';
import { createHandler, type Handler, type SupportedProvider, SUPPORTED_PROVIDERS } from './handler-registry.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for ModelProxy - Legacy format (provider-based)
 */
export interface ModelProxyConfigLegacy {
  /** The provider to route requests to */
  provider: Provider;
  /** API key for the provider (not required for Ollama) */
  apiKey?: string;
  /** Base URL for the provider (optional, for Ollama customization) */
  baseUrl?: string;
}

/**
 * Configuration for ModelProxy - New format (model string-based)
 */
export interface ModelProxyConfigNew {
  /** The model string (e.g., "ollama/codellama", "openrouter/anthropic/claude-3-haiku") */
  model: string;
  /** API key for the provider (required for OpenRouter) */
  apiKey?: string;
  /** Base URL for the provider (optional) */
  baseUrl?: string;
  /** Port to bind to (optional, default 0 for auto-assign) */
  port?: number;
  /** Test handler for dependency injection (internal use only) */
  _testHandler?: Handler;
}

/**
 * Combined configuration type
 */
export type ModelProxyConfig = ModelProxyConfigLegacy | ModelProxyConfigNew;

/**
 * Handler with optional health check method
 */
interface HandlerWithHealth extends Handler {
  checkHealth?: () => Promise<boolean>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if config is new format (model string-based)
 */
function isNewConfig(config: ModelProxyConfig): config is ModelProxyConfigNew {
  return 'model' in config;
}

/**
 * Parse provider from model string
 * Format: <provider>/<model-name>
 * Returns null if invalid format
 */
function parseProviderFromModel(modelString: string): SupportedProvider | null {
  const slashIndex = modelString.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const provider = modelString.substring(0, slashIndex);
  if (SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)) {
    return provider as SupportedProvider;
  }

  return null;
}

/**
 * Extract model name from model string
 * For "ollama/codellama", returns "codellama"
 * For "openrouter/anthropic/claude-3-haiku", returns "anthropic/claude-3-haiku"
 */
function extractModelName(modelString: string): string {
  const slashIndex = modelString.indexOf('/');
  if (slashIndex <= 0) {
    return modelString;
  }
  return modelString.substring(slashIndex + 1);
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

// ============================================================================
// ModelProxy Class
// ============================================================================

/**
 * ModelProxy - HTTP server that proxies requests to model providers
 *
 * Creates a localhost HTTP server that:
 * - Accepts Anthropic-format requests on POST /v1/messages
 * - Transforms requests for the target provider
 * - Forwards to the provider and returns transformed responses
 * - Provides health check endpoint at GET /health
 */
export class ModelProxy {
  private config: ModelProxyConfig;
  private server: http.Server | null = null;
  private port = 0;
  private address = '127.0.0.1';
  private connections: Set<http.IncomingMessage['socket']> = new Set();

  // Parsed values from model string
  private parsedProvider: SupportedProvider | null = null;
  private parsedModel: string = '';
  private handler: HandlerWithHealth | null = null;

  constructor(config: ModelProxyConfig) {
    this.config = config;

    if (isNewConfig(config)) {
      // Parse model string to extract provider and model name
      this.parsedProvider = parseProviderFromModel(config.model);
      this.parsedModel = extractModelName(config.model);

      if (!this.parsedProvider) {
        throw new Error(`Unsupported provider in model string: ${config.model}`);
      }

      // Check if test handler is provided
      if (config._testHandler) {
        this.handler = config._testHandler as HandlerWithHealth;
      } else {
        // Create real handler using HandlerRegistry
        this.handler = createHandler({
          provider: this.parsedProvider,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
        }) as HandlerWithHealth;
      }
    }
  }

  /**
   * Get the model name (extracted from model string)
   */
  getModel(): string {
    return this.parsedModel;
  }

  /**
   * Get the provider (extracted from model string)
   */
  getProvider(): SupportedProvider | null {
    return this.parsedProvider;
  }

  /**
   * Get the handler type (provider name)
   */
  getHandlerType(): SupportedProvider | null {
    return this.parsedProvider;
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

      // Determine which port to listen on
      const listenPort = isNewConfig(this.config) && this.config.port ? this.config.port : 0;

      // Listen on specified port (or 0 for auto-assign)
      this.server.listen(listenPort, this.address, () => {
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

    // Route GET /health
    if (url === '/health' && method === 'GET') {
      this.handleHealthRequest(res);
      return;
    }

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
   * Handle GET /health request
   */
  private async handleHealthRequest(res: http.ServerResponse): Promise<void> {
    // Check handler health if method exists
    let healthy = true;
    if (this.handler && typeof this.handler.checkHealth === 'function') {
      healthy = await this.handler.checkHealth();
    }

    const statusCode = healthy ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        healthy,
        provider: this.parsedProvider,
        model: this.parsedModel,
      })
    );
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

    req.on('end', async () => {
      // Parse JSON body
      let requestBody: AnthropicRequest;
      try {
        requestBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      // If we have a handler (new config), forward to it
      if (this.handler) {
        try {
          const response = await this.handler.handle(requestBody);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
        return;
      }

      // Legacy behavior: return placeholder response
      const providerName = isNewConfig(this.config)
        ? this.parsedProvider
        : this.config.provider;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `msg_${generateId()}`,
          type: 'message',
          role: 'assistant',
          model: providerName,
          content: [
            {
              type: 'text',
              text: `Proxy received request for provider: ${providerName}`,
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
