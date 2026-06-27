/**
 * ModelProxy - HTTP proxy server that routes requests to model providers
 *
 * @behavior Starts HTTP server on localhost and routes /v1/messages to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.9
 */
import type { Provider } from '../types/model-settings.js';
import { type Handler, type SupportedProvider } from './handler-registry.js';
import { type RouteDeps } from './proxy-router.js';
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
            apiKeys?: {
                ollama?: string;
            };
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
 * ModelProxy - HTTP server that proxies requests to model providers
 *
 * Creates a localhost HTTP server that:
 * - Accepts Anthropic-format requests on POST /v1/messages
 * - Transforms requests for the target provider
 * - Forwards to the provider and returns transformed responses
 * - Provides health check endpoint at GET /health
 */
export declare class ModelProxy {
    private config;
    private server;
    private port;
    private address;
    private connections;
    private parsedProvider;
    private parsedModel;
    private handler;
    private routerConfig;
    private testRouteDeps;
    constructor(config: ModelProxyConfig);
    /**
     * Get the model name (extracted from model string)
     */
    getModel(): string;
    /**
     * Get the provider (extracted from model string)
     */
    getProvider(): SupportedProvider | null;
    /**
     * Get the handler type (provider name)
     */
    getHandlerType(): SupportedProvider | null;
    /**
     * Start the proxy server on an available port
     */
    start(): Promise<void>;
    /**
     * Shutdown the proxy server
     */
    shutdown(): Promise<void>;
    /**
     * Get the port the server is listening on
     */
    getPort(): number;
    /**
     * Get the address the server is bound to
     */
    getAddress(): string;
    /**
     * Check if the server is running
     */
    isRunning(): boolean;
    /**
     * Handle incoming HTTP request
     */
    private handleRequest;
    /**
     * Handle GET /health request
     */
    private handleHealthRequest;
    /**
     * Handle POST /v1/messages request
     */
    /**
     * Append a one-line JSON record of a forwarded request to the file named by OSS_PROXY_LOG.
     * Opt-in only: when OSS_PROXY_LOG is unset this is a no-op (no default file, no disk growth).
     * Lets the eval prove a routed agent actually hit a given provider/model. Best-effort: any
     * failure is swallowed so logging never breaks routing.
     */
    private logRequest;
    /**
     * Stream an Anthropic SSE response. The Claude CLI always sends stream:true and will time out
     * (then retry in a loop) if it sees no bytes while the backend thinks. So we flush the opening
     * events IMMEDIATELY and emit keepalive pings during inference, then stream the result as a
     * single text_delta once the backend returns. Handles its own errors mid-stream (status 200
     * is already committed once streaming begins).
     */
    private streamSseResponse;
    /**
     * Emit the content blocks + closing events for a resolved Anthropic response over an SSE
     * `send`. Shared by the streaming path (after the slow backend returns) and the router path
     * (which already has a resolved backend result). Text → text_delta, tool_use → input_json_delta,
     * so the Claude CLI can render text AND execute tool calls.
     */
    private emitResponseBlocks;
    /**
     * Emit a fully-resolved Anthropic response as an SSE event stream in one pass. Unlike
     * streamSseResponse (which flushes early + pings while a slow backend thinks), the router's
     * Ollama result is already resolved, so there is nothing to wait for — emit message_start,
     * the content blocks, then message_stop directly.
     */
    private emitResolvedSse;
    /**
     * Pipe an upstream fetch Response back to the client verbatim (status + content-type + body).
     * Used by both the router fallback/pass-through path and the faithful reverse-proxy forward.
     */
    private pipeUpstream;
    /**
     * Forward any non-/v1/messages request straight to Anthropic and pipe the bytes back — a
     * faithful reverse proxy. Buffers the body first so POST payloads (e.g. count_tokens) survive.
     */
    private forwardRequest;
    /**
     * Router mode: dispatch POST /v1/messages per-agent via routeMessages. We write NOTHING to
     * `res` until routeMessages resolves — that's what lets the Ollama-throw case silently fall
     * back to Anthropic. Then render by route: 'ollama' result is a resolved AnthropicResponse
     * (emit as SSE); 'anthropic' result is a fetch Response (pipe it back verbatim).
     */
    private handleRouterMessages;
    private handleMessagesRequest;
}
//# sourceMappingURL=model-proxy.d.ts.map