/**
 * OllamaHandler - Handle requests to local Ollama server
 *
 * @behavior Transforms Anthropic requests to Ollama format and connects to local server
 * @acceptance-criteria AC-HANDLER-OLLAMA.1 through AC-HANDLER-OLLAMA.5
 */
import type { AnthropicRequest, AnthropicResponse } from '../api-transformer.js';
/**
 * Configuration for OllamaHandler
 */
export interface OllamaHandlerConfig {
    /** Base URL for Ollama server (default: http://localhost:11434) */
    baseUrl?: string;
    /**
     * Per-model native `think` flag (bare model name → boolean). When the routed (stripped) model name
     * is a KEY here, the value is sent as ollama's top-level `think` on /api/chat — letting verbose
     * reasoning models be served with thinking OFF. Models not listed send NO `think` key (sending it
     * to a non-thinking model can 400). Keyed by existence, so a `false` value is honored.
     */
    think?: Record<string, boolean>;
}
/**
 * OllamaHandler - Connects to local Ollama server
 *
 * - Transforms Anthropic requests to Ollama format
 * - No API key required (local server)
 * - Transforms Ollama responses back to Anthropic format
 */
export declare class OllamaHandler {
    private baseUrl;
    private think?;
    constructor(config: OllamaHandlerConfig);
    /**
     * Get the base URL for the Ollama server
     */
    getBaseUrl(): string;
    /**
     * Get the Ollama chat endpoint
     */
    getEndpoint(): string;
    /**
     * Handle a request by forwarding to Ollama
     */
    handle(request: AnthropicRequest): Promise<AnthropicResponse>;
    /**
     * Check if Ollama server is running
     */
    checkHealth(): Promise<boolean>;
    /**
     * List available models
     */
    listModels(): Promise<string[]>;
    /**
     * Transform Anthropic request to Ollama format
     */
    private transformToOllama;
    /**
     * Transform Ollama response to Anthropic format
     */
    private transformFromOllama;
    /**
     * Make HTTP request to Ollama server
     */
    private makeRequest;
}
//# sourceMappingURL=ollama-handler.d.ts.map