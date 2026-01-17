/**
 * ModelProxy - HTTP proxy server that routes requests to model providers
 *
 * @behavior Starts HTTP server on localhost and routes /v1/messages to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.9
 */
import type { Provider } from '../types/model-settings.js';
import { type Handler, type SupportedProvider } from './handler-registry.js';
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
    private handleMessagesRequest;
}
//# sourceMappingURL=model-proxy.d.ts.map