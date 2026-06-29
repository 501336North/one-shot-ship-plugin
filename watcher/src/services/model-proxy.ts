/**
 * ModelProxy - HTTP proxy server that routes requests to model providers
 *
 * @behavior Starts HTTP server on localhost and routes /v1/messages to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.9
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import type { Provider } from '../types/model-settings.js';
import type { AnthropicRequest, AnthropicResponse, AnthropicResponseContent } from './api-transformer.js';
import { createHandler, type Handler, type HandlerConfig, type SupportedProvider, SUPPORTED_PROVIDERS } from './handler-registry.js';
import { routeMessages, type RouteDeps } from './proxy-router.js';
import { forwardToAnthropic } from './anthropic-passthrough.js';
import { createRoutingLogger } from './routing-log.js';

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
 * Configuration for ModelProxy - Router format (per-agent dispatch).
 *
 * In router mode the proxy does NOT force a single construct-time model. Each /v1/messages
 * request is dispatched per-agent via the already-tested routeMessages logic: a local-mapped
 * agent is served by Ollama (and streamed back as Anthropic SSE), everything else is forwarded
 * to Anthropic verbatim. Any non-/, non-/health path is also forwarded (faithful reverse proxy).
 */
export interface ModelProxyConfigRouter {
  router: true;
  /** Merged OSS config: models.agents (marker→model), models.fallbackEnabled, models.apiKeys.ollama */
  routerConfig: {
    models?: {
      default?: string;
      agents?: Record<string, string>;
      fallbackEnabled?: boolean;
      apiKeys?: { ollama?: string };
      /** Per-model native ollama `think` flag (bare model name → boolean). Opt-in; absent ⇒ unchanged. */
      think?: Record<string, boolean>;
    };
  };
  /** Port to bind to (optional, default 0 for auto-assign) */
  port?: number;
  /** Test seam: inject the whole RouteDeps (ollamaHandle/passthrough/log). */
  _testRouteDeps?: RouteDeps;
}

/**
 * Combined configuration type
 */
export type ModelProxyConfig = ModelProxyConfigLegacy | ModelProxyConfigNew | ModelProxyConfigRouter;

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
 * Check if config is router format (per-agent dispatch).
 */
function isRouterConfig(config: ModelProxyConfig): config is ModelProxyConfigRouter {
  return 'router' in config && (config as ModelProxyConfigRouter).router === true;
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

/**
 * Build the ollama HandlerConfig for the router path from the merged routerConfig — base URL plus the
 * opt-in per-model `think` map. Extracted so the wiring (incl. think) is unit-tested directly.
 */
export function ollamaHandlerConfig(
  routerConfig: ModelProxyConfigRouter['routerConfig']
): HandlerConfig {
  return {
    provider: 'ollama',
    baseUrl: routerConfig.models?.apiKeys?.ollama,
    think: routerConfig.models?.think,
  };
}

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

  // Router-mode state (per-agent dispatch). Left null/undefined for non-router configs.
  private routerConfig: ModelProxyConfigRouter['routerConfig'] | null = null;
  private testRouteDeps: RouteDeps | undefined = undefined;

  constructor(config: ModelProxyConfig) {
    this.config = config;

    if (isRouterConfig(config)) {
      // Router mode: skip single-model parsing entirely. Each request is dispatched per-agent.
      this.routerConfig = config.routerConfig;
      this.testRouteDeps = config._testRouteDeps;
    } else if (isNewConfig(config)) {
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

      // Determine which port to listen on (new + router configs may pin a port; default 0).
      const listenPort = isRouterConfig(this.config)
        ? this.config.port ?? 0
        : isNewConfig(this.config) && this.config.port
          ? this.config.port
          : 0;

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
    const pathname = url.split('?')[0]; // claude appends query strings (e.g. /v1/messages?beta=true)

    // Reachability probe: the Claude CLI sends `HEAD /` before any work; if it 404s, claude
    // concludes the endpoint/model is unavailable ("model may not exist"). Answer it.
    if (pathname === '/' && (method === 'HEAD' || method === 'GET')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(method === 'HEAD' ? undefined : JSON.stringify({ ok: true }));
      return;
    }

    // Route GET /health
    if (pathname === '/health' && method === 'GET') {
      this.handleHealthRequest(res);
      return;
    }

    // Router mode: per-agent dispatch on POST /v1/messages; any other path/method is forwarded
    // to Anthropic (faithful reverse proxy), never 404'd.
    if (isRouterConfig(this.config)) {
      if (pathname === '/v1/messages' && method === 'POST') {
        this.handleRouterMessages(req, res);
      } else {
        this.forwardRequest(req, res);
      }
      return;
    }

    // Route /v1/messages (tolerate query strings)
    if (pathname === '/v1/messages') {
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
  /**
   * Append a one-line JSON record of a forwarded request to the file named by OSS_PROXY_LOG.
   * Opt-in only: when OSS_PROXY_LOG is unset this is a no-op (no default file, no disk growth).
   * Lets the eval prove a routed agent actually hit a given provider/model. Best-effort: any
   * failure is swallowed so logging never breaks routing.
   */
  private logRequest(model?: string): void {
    const logPath = process.env.OSS_PROXY_LOG;
    if (!logPath) return;
    try {
      const provider = isNewConfig(this.config)
        ? this.parsedProvider
        : (this.config as ModelProxyConfigLegacy).provider;
      const baseUrl = isNewConfig(this.config) ? this.config.baseUrl : undefined;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        provider,
        model: model ?? this.parsedModel,
        baseUrl,
      }) + '\n';
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, line);
    } catch {
      /* observability must never break the proxy */
    }
  }

  /**
   * Stream an Anthropic SSE response. The Claude CLI always sends stream:true and will time out
   * (then retry in a loop) if it sees no bytes while the backend thinks. So we flush the opening
   * events IMMEDIATELY and emit keepalive pings during inference, then stream the result as a
   * single text_delta once the backend returns. Handles its own errors mid-stream (status 200
   * is already committed once streaming begins).
   */
  private async streamSseResponse(
    res: http.ServerResponse,
    requestBody: AnthropicRequest
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: Record<string, unknown>): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const id = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

    // Flush opening events right away so the client sees bytes before the (slow) backend responds.
    send('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: requestBody.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    // Keepalive while the backend is thinking — prevents the client's idle/first-byte timeout.
    // (Content blocks follow once we know whether the model produced text or a tool_use.)
    const ping = setInterval(() => {
      try {
        send('ping', { type: 'ping' });
      } catch {
        /* connection closed */
      }
    }, 5000);

    try {
      const response = await this.handler!.handle(requestBody);
      clearInterval(ping);
      this.emitResponseBlocks(send, response);
      res.end();
    } catch (error) {
      clearInterval(ping);
      // Status 200 is already committed — surface the failure as an SSE error event, then end.
      const message = error instanceof Error ? error.message : 'Unknown error';
      try {
        send('error', { type: 'error', error: { type: 'api_error', message } });
      } catch {
        /* connection closed */
      }
      res.end();
    }
  }

  /**
   * Emit the content blocks + closing events for a resolved Anthropic response over an SSE
   * `send`. Shared by the streaming path (after the slow backend returns) and the router path
   * (which already has a resolved backend result). Text → text_delta, tool_use → input_json_delta,
   * so the Claude CLI can render text AND execute tool calls.
   */
  private emitResponseBlocks(
    send: (event: string, data: Record<string, unknown>) => void,
    response: AnthropicResponse
  ): void {
    const blocks: AnthropicResponseContent[] =
      response.content.length > 0 ? response.content : [{ type: 'text', text: '' }];
    blocks.forEach((block, index) => {
      if (block.type === 'tool_use') {
        send('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        });
        send('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
        });
      } else {
        send('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        });
        send('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: block.text ?? '' },
        });
      }
      send('content_block_stop', { type: 'content_block_stop', index });
    });

    send('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: response.stop_reason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: response.usage?.output_tokens ?? 0 },
    });
    send('message_stop', { type: 'message_stop' });
  }

  /**
   * Emit a fully-resolved Anthropic response as an SSE event stream in one pass. Unlike
   * streamSseResponse (which flushes early + pings while a slow backend thinks), the router's
   * Ollama result is already resolved, so there is nothing to wait for — emit message_start,
   * the content blocks, then message_stop directly.
   */
  private emitResolvedSse(
    res: http.ServerResponse,
    response: AnthropicResponse,
    requestModel?: string
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: Record<string, unknown>): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const id = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    send('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        // Mirror streamSseResponse: prefer the request's model for client consistency, fall back
        // to the backend-reported model.
        model: requestModel ?? response.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: 0 },
      },
    });
    this.emitResponseBlocks(send, response);
    res.end();
  }

  /**
   * Pipe an upstream fetch Response back to the client verbatim (status + content-type + body).
   * Used by both the router fallback/pass-through path and the faithful reverse-proxy forward.
   */
  private pipeUpstream(res: http.ServerResponse, upstream: Response): void {
    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.writeHead(upstream.status, { 'Content-Type': contentType });
    if (upstream.body) {
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } else {
      res.end();
    }
  }

  /**
   * Forward any non-/v1/messages request straight to Anthropic and pipe the bytes back — a
   * faithful reverse proxy. Buffers the body first so POST payloads (e.g. count_tokens) survive.
   */
  private forwardRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks);
      try {
        // Honor the injected passthrough seam (tests) so an unknown path is forwarded through the
        // same collaborator as routed fallback; otherwise hit the real Anthropic API.
        const upstream = (this.testRouteDeps
          ? await this.testRouteDeps.passthrough(rawBody)
          : await forwardToAnthropic({
              path: req.url || '/',
              method: req.method || 'POST',
              headers: req.headers,
              body: rawBody,
            })) as Response;
        this.pipeUpstream(res, upstream);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
    });
    req.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });
  }

  /**
   * Router mode: dispatch POST /v1/messages per-agent via routeMessages. We write NOTHING to
   * `res` until routeMessages resolves — that's what lets the Ollama-throw case silently fall
   * back to Anthropic. Then render by route: 'ollama' result is a resolved AnthropicResponse
   * (emit as SSE); 'anthropic' result is a fetch Response (pipe it back verbatim).
   */
  private handleRouterMessages(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks);
      const routerConfig = this.routerConfig!;

      let parsedBody: { system?: unknown };
      try {
        parsedBody = JSON.parse(rawBody.toString());
      } catch {
        // Unparseable body → just forward to Anthropic.
        try {
          const upstream = (await forwardToAnthropic({
            path: req.url || '/',
            method: req.method || 'POST',
            headers: req.headers,
            body: rawBody,
          })) as Response;
          this.pipeUpstream(res, upstream);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        }
        return;
      }

      const deps: RouteDeps =
        this.testRouteDeps ??
        {
          ollamaHandle: async (model, body) =>
            createHandler(ollamaHandlerConfig(routerConfig)).handle({ ...(body as object), model } as AnthropicRequest),
          passthrough: async () =>
            forwardToAnthropic({
              path: req.url || '/',
              method: req.method || 'POST',
              headers: req.headers,
              body: rawBody,
            }),
          log: createRoutingLogger(
            path.join(os.homedir(), '.oss', 'logs', 'model-routing.log')
          ),
        };

      try {
        const outcome = await routeMessages(parsedBody, routerConfig, deps);
        if (outcome.route === 'ollama') {
          this.emitResolvedSse(
            res,
            outcome.result as AnthropicResponse,
            (parsedBody as { model?: string }).model
          );
        } else {
          this.pipeUpstream(res, outcome.result as Response);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
    });
    req.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });
  }

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

      // Force the proxy's configured model. Clients (e.g. a nested `claude -p` offload session)
      // cannot pass a foreign model id — the Claude CLI rejects unknown --model client-side — so
      // they send their default claude id. The proxy owns model selection and overrides it here,
      // otherwise the backend (Ollama) 404s on the wrong name. (live-proof finding)
      if (isNewConfig(this.config) && this.config.model) {
        requestBody.model = this.config.model;
      }

      // Observability: record every forwarded request so callers (e.g. the model-routing eval)
      // can VERIFY which model/provider actually served an agent. Never let logging break the proxy.
      this.logRequest(requestBody?.model);

      // If we have a handler (new config), forward to it
      if (this.handler) {
        if (requestBody.stream) {
          // The Claude CLI always streams; flush opening events early + keepalive while the
          // backend thinks, then stream the result. (handles its own errors mid-stream)
          await this.streamSseResponse(res, requestBody);
        } else {
          try {
            const response = await this.handler.handle(requestBody);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errorMessage }));
          }
        }
        return;
      }

      // Legacy behavior: return placeholder response. (Router configs never reach here —
      // they are dispatched via handleRouterMessages — so this branch is legacy-only.)
      const providerName = isNewConfig(this.config)
        ? this.parsedProvider
        : isRouterConfig(this.config)
          ? null
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
