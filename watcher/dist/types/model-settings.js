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
];
/**
 * Special model identifier values
 */
const SPECIAL_VALUES = ['default', 'claude'];
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
export function isValidModelId(modelId) {
    if (!modelId || modelId.length === 0) {
        return false;
    }
    // Check special values
    if (SPECIAL_VALUES.includes(modelId)) {
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
    const validProviders = SUPPORTED_PROVIDERS.filter((p) => p !== 'claude');
    return validProviders.includes(provider);
}
/**
 * Parse the provider from a model identifier
 *
 * @param modelId - The model identifier to parse
 * @returns The provider name, 'claude' for special values, or null if invalid
 */
export function parseProvider(modelId) {
    if (!modelId || modelId.length === 0) {
        return null;
    }
    // Check special values
    if (SPECIAL_VALUES.includes(modelId)) {
        return 'claude';
    }
    // Parse provider from format
    const slashIndex = modelId.indexOf('/');
    if (slashIndex <= 0) {
        return null;
    }
    const provider = modelId.substring(0, slashIndex);
    // Provider must be supported (excluding 'claude' which is a special value)
    const validProviders = SUPPORTED_PROVIDERS.filter((p) => p !== 'claude');
    if (validProviders.includes(provider)) {
        return provider;
    }
    return null;
}
/**
 * Default model settings
 */
export const DEFAULT_MODEL_SETTINGS = {
    default: 'claude',
    fallbackEnabled: true,
    agents: {},
    commands: {},
    skills: {},
    hooks: {},
};
//# sourceMappingURL=model-settings.js.map