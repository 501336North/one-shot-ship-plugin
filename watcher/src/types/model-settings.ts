/**
 * Model Settings Type Definitions
 *
 * @behavior Model identifiers are validated and provider is extracted
 * @acceptance-criteria AC-MODEL.1 through AC-MODEL.4
 */

/**
 * Supported model providers
 */
export const SUPPORTED_PROVIDERS = [
  'openrouter',
  'ollama',
  'openai',
  'gemini',
  'claude',
] as const;

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
  ollama?: string; // Base URL for Ollama (default: http://localhost:11434)
}

/**
 * Special model identifier values
 */
const SPECIAL_VALUES = ['default', 'claude'] as const;

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
export function isValidModelId(modelId: string): boolean {
  if (!modelId || modelId.length === 0) {
    return false;
  }

  // Check special values
  if (SPECIAL_VALUES.includes(modelId as (typeof SPECIAL_VALUES)[number])) {
    return true;
  }

  // Check provider/model format
  const slashIndex = modelId.indexOf('/');
  if (slashIndex <= 0) {
    return false;
  }

  const provider = modelId.substring(0, slashIndex);
  const modelName = modelId.substring(slashIndex + 1);

  // Must have a model name after provider
  if (!modelName || modelName.length === 0) {
    return false;
  }

  // Provider must be supported (excluding 'claude' which is a special value, not a provider prefix)
  const validProviders: readonly string[] = SUPPORTED_PROVIDERS.filter((p) => p !== 'claude');
  return validProviders.includes(provider);
}

/**
 * Parse the provider from a model identifier
 *
 * @param modelId - The model identifier to parse
 * @returns The provider name, 'claude' for special values, or null if invalid
 */
export function parseProvider(modelId: string): Provider | null {
  if (!modelId || modelId.length === 0) {
    return null;
  }

  // Check special values
  if (SPECIAL_VALUES.includes(modelId as (typeof SPECIAL_VALUES)[number])) {
    return 'claude';
  }

  // Parse provider from format
  const slashIndex = modelId.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const provider = modelId.substring(0, slashIndex);

  // Provider must be supported (excluding 'claude' which is a special value)
  const validProviders: readonly string[] = SUPPORTED_PROVIDERS.filter((p) => p !== 'claude');
  if (validProviders.includes(provider)) {
    return provider as Provider;
  }

  return null;
}

/**
 * Default model settings
 */
export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  default: 'claude',
  fallbackEnabled: true,
  agents: {},
  commands: {},
  skills: {},
  hooks: {},
};
