/**
 * ModelProxy - HTTP proxy server that routes requests to model providers
 *
 * @behavior Starts HTTP server on localhost and routes /v1/messages to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.5
 */
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
export declare class ModelProxy {
    private config;
    private server;
    private port;
    private address;
    private connections;
    constructor(config: ModelProxyConfig);
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
     * Handle POST /v1/messages request
     */
    private handleMessagesRequest;
}
//# sourceMappingURL=model-proxy.d.ts.map