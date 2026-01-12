/**
 * Model Settings Type Definitions
 *
 * @behavior Model identifiers are validated and provider is extracted
 * @acceptance-criteria AC-MODEL.1 through AC-MODEL.4
 */
/**
 * Supported model providers
 */
export declare const SUPPORTED_PROVIDERS: readonly ["openrouter", "ollama", "openai", "gemini", "claude"];
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];
/**
 * Model identifier type
 * Format: <provider>/<model-name> or special values (default, claude)
 *
 * Examples:
 * - openrouter/deepseek/deepseek-chat
 * - ollama/codellama
 * - openai/gpt-4o
 * - gemini/gemini-2.0-flash
 * - default (maps to claude)
 * - claude (native Claude Code model)
 */
export type ModelIdentifier = string;
/**
 * Model settings for all prompt types
 */
export interface ModelSettings {
    /** Default model for all prompts (default: 'claude') */
    default: ModelIdentifier;
    /** Whether to fallback to Claude on model failure */
    fallbackEnabled: boolean;
    /** Model mappings for agents (e.g., 'oss:code-reviewer' -> 'openrouter/deepseek/deepseek-chat') */
    agents?: Record<string, ModelIdentifier>;
    /** Model mappings for commands (e.g., 'oss:ship' -> 'default') */
    commands?: Record<string, ModelIdentifier>;
    /** Model mappings for skills (e.g., 'oss:red' -> 'ollama/codellama') */
    skills?: Record<string, ModelIdentifier>;
    /** Model mappings for hooks (e.g., 'pre-commit' -> 'gemini/gemini-2.0-flash') */
    hooks?: Record<string, ModelIdentifier>;
}
/**
 * API key configuration for providers
 * Note: Ollama doesn't require an API key (local)
 */
export interface ProviderConfig {
    openrouter?: string;
    openai?: string;
    gemini?: string;
    ollama?: string;
}
/**
 * Validate a model identifier
 *
 * Valid formats:
 * - <provider>/<model-name> (e.g., 'openrouter/deepseek/deepseek-chat')
 * - 'default' or 'claude' (special values)
 *
 * @param modelId - The model identifier to validate
 * @returns true if valid, false otherwise
 */
export declare function isValidModelId(modelId: string): boolean;
/**
 * Parse the provider from a model identifier
 *
 * @param modelId - The model identifier to parse
 * @returns The provider name, 'claude' for special values, or null if invalid
 */
export declare function parseProvider(modelId: string): Provider | null;
/**
 * Default model settings
 */
export declare const DEFAULT_MODEL_SETTINGS: ModelSettings;
//# sourceMappingURL=model-settings.d.ts.map