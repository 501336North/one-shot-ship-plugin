/**
 * HandlerRegistry - Manage model handlers for different providers
 *
 * @behavior Registry manages handler creation and caching for Ollama and OpenRouter
 * @acceptance-criteria AC-HANDLER-REG.1 through AC-HANDLER-REG.16
 */

import type { AnthropicRequest, AnthropicResponse } from './api-transformer.js';
import { OllamaHandler } from './handlers/ollama-handler.js';
import { OpenRouterHandler } from './handlers/openrouter-handler.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported model providers
 */
export type SupportedProvider = 'ollama' | 'openrouter';

/**
 * List of supported providers for runtime validation
 */
export const SUPPORTED_PROVIDERS: readonly SupportedProvider[] = ['ollama', 'openrouter'] as const;

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

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a handler for the specified provider
 *
 * @param config - Handler configuration
 * @returns Handler instance
 * @throws Error if provider is unknown or required config is missing
 */
export function createHandler(config: HandlerConfig): Handler {
  switch (config.provider) {
    case 'ollama':
      return new OllamaHandler({
        baseUrl: config.baseUrl,
      });

    case 'openrouter':
      if (!config.apiKey) {
        throw new Error('API key is required for OpenRouter');
      }
      return new OpenRouterHandler({
        apiKey: config.apiKey,
      });

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// ============================================================================
// Registry Class
// ============================================================================

/**
 * HandlerRegistry - Manages handler instances by provider
 *
 * Supports:
 * - Manual registration of handlers
 * - Lazy initialization with getOrCreate()
 * - Caching of created handlers
 */
export class HandlerRegistry {
  private handlers: Map<SupportedProvider, Handler> = new Map();

  /**
   * Register a handler for a provider
   *
   * @param provider - The provider name
   * @param handler - The handler instance
   */
  register(provider: SupportedProvider, handler: Handler): void {
    this.handlers.set(provider, handler);
  }

  /**
   * Get a registered handler by provider
   *
   * @param provider - The provider name
   * @returns The registered handler
   * @throws Error if no handler is registered for the provider
   */
  get(provider: SupportedProvider): Handler {
    const handler = this.handlers.get(provider);
    if (!handler) {
      throw new Error(`No handler registered for provider: ${provider}`);
    }
    return handler;
  }

  /**
   * Get or create a handler for a provider
   *
   * If no handler is registered, creates one using the factory function
   * and caches it for future use.
   *
   * @param config - Handler configuration
   * @returns Handler instance (cached or newly created)
   */
  getOrCreate(config: HandlerConfig): Handler {
    const existing = this.handlers.get(config.provider);
    if (existing) {
      return existing;
    }

    const handler = createHandler(config);
    this.handlers.set(config.provider, handler);
    return handler;
  }
}
