/**
 * OpenRouterHandler - Handle requests to OpenRouter API
 *
 * @behavior Transforms Anthropic requests to OpenAI format and forwards to OpenRouter
 * @acceptance-criteria AC-HANDLER-OR.1 through AC-HANDLER-OR.5
 */
import { type AnthropicRequest, type AnthropicResponse } from '../api-transformer.js';
/**
 * Configuration for OpenRouterHandler
 */
export interface OpenRouterHandlerConfig {
    /** API key for OpenRouter (required) */
    apiKey: string;
}
/**
 * OpenRouterHandler - Forwards requests to OpenRouter API
 *
 * - Transforms Anthropic requests to OpenAI format
 * - Adds proper authorization headers
 * - Transforms OpenAI responses back to Anthropic format
 */
export declare class OpenRouterHandler {
    private config;
    constructor(config: OpenRouterHandlerConfig);
    /**
     * Get headers for OpenRouter API requests
     */
    getHeaders(): Record<string, string>;
    /**
     * Get the OpenRouter API endpoint
     */
    getEndpoint(): string;
    /**
     * Handle a request by forwarding to OpenRouter
     */
    handle(request: AnthropicRequest): Promise<AnthropicResponse>;
    /**
     * Make HTTPS request to OpenRouter
     */
    private makeRequest;
}
//# sourceMappingURL=openrouter-handler.d.ts.map