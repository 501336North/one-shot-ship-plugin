/**
 * ProviderDetector - Detect provider from model identifier
 *
 * @behavior Provider is parsed from model identifier format
 * @acceptance-criteria AC-PROVIDER.1 through AC-PROVIDER.5
 */
import { Provider } from '../types/model-settings.js';
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
export declare function detectProvider(modelId: string): Provider | null;
//# sourceMappingURL=provider-detector.d.ts.map