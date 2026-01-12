/**
 * ProviderDetector - Detect provider from model identifier
 *
 * @behavior Provider is parsed from model identifier format
 * @acceptance-criteria AC-PROVIDER.1 through AC-PROVIDER.5
 */
import { SUPPORTED_PROVIDERS } from '../types/model-settings.js';
/**
 * Special model identifier values that map to 'claude' provider
 */
const SPECIAL_VALUES = ['default', 'claude'];
/**
 * Detect provider from a model identifier
 *
 * Valid formats:
 * - <provider>/<model-name> (e.g., 'openrouter/deepseek/deepseek-chat')
 * - 'default' or 'claude' (special values that return 'claude')
 *
 * @param modelId - The model identifier to parse
 * @returns The provider name, 'claude' for special values, or null if invalid
 */
export function detectProvider(modelId) {
    // Handle empty or whitespace
    if (!modelId || modelId.length === 0) {
        return null;
    }
    // Check for whitespace at start or end (invalid)
    if (modelId !== modelId.trim()) {
        return null;
    }
    // Check special values (exact match, case-sensitive)
    if (SPECIAL_VALUES.includes(modelId)) {
        return 'claude';
    }
    // Parse provider from format: provider/model-name
    const slashIndex = modelId.indexOf('/');
    if (slashIndex <= 0) {
        return null;
    }
    const provider = modelId.substring(0, slashIndex);
    const modelName = modelId.substring(slashIndex + 1);
    // Must have a non-empty model name after provider
    if (!modelName || modelName.length === 0) {
        return null;
    }
    // Provider must be a supported provider (excluding 'claude' which is a special value)
    const validProviders = SUPPORTED_PROVIDERS.filter((p) => p !== 'claude');
    if (validProviders.includes(provider)) {
        return provider;
    }
    return null;
}
//# sourceMappingURL=provider-detector.js.map