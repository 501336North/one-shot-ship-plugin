/**
 * HandlerRegistry - Manage model handlers for different providers
 *
 * @behavior Registry manages handler creation and caching for Ollama and OpenRouter
 * @acceptance-criteria AC-HANDLER-REG.1 through AC-HANDLER-REG.16
 */
import type { AnthropicRequest, AnthropicResponse } from './api-transformer.js';
/**
 * Supported model providers
 */
export type SupportedProvider = 'ollama' | 'openrouter';
/**
 * List of supported providers for runtime validation
 */
export declare const SUPPORTED_PROVIDERS: readonly SupportedProvider[];
/**
 * Handler interface - all handlers must implement this
 */
export interface Handler {
    handle(request: AnthropicRequest): Promise<AnthropicResponse>;
}
/**
 * Configuration for creating handlers
 */
export interface HandlerConfig {
    provider: SupportedProvider;
    apiKey?: string;
    baseUrl?: string;
}
/**
 * Create a handler for the specified provider
 *
 * @param config - Handler configuration
 * @returns Handler instance
 * @throws Error if provider is unknown or required config is missing
 */
export declare function createHandler(config: HandlerConfig): Handler;
/**
 * HandlerRegistry - Manages handler instances by provider
 *
 * Supports:
 * - Manual registration of handlers
 * - Lazy initialization with getOrCreate()
 * - Caching of created handlers
 */
export declare class HandlerRegistry {
    private handlers;
    /**
     * Register a handler for a provider
     *
     * @param provider - The provider name
     * @param handler - The handler instance
     */
    register(provider: SupportedProvider, handler: Handler): void;
    /**
     * Get a registered handler by provider
     *
     * @param provider - The provider name
     * @returns The registered handler
     * @throws Error if no handler is registered for the provider
     */
    get(provider: SupportedProvider): Handler;
    /**
     * Get or create a handler for a provider
     *
     * If no handler is registered, creates one using the factory function
     * and caches it for future use.
     *
     * @param config - Handler configuration
     * @returns Handler instance (cached or newly created)
     */
    getOrCreate(config: HandlerConfig): Handler;
}
//# sourceMappingURL=handler-registry.d.ts.map