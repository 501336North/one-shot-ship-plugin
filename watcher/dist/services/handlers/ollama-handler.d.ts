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