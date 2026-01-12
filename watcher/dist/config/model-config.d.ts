/**
 * ModelConfig - Load and merge model configuration from user and project configs
 *
 * @behavior Configuration is loaded with precedence: Project > User > Default
 * @acceptance-criteria AC-CONFIG.1 through AC-CONFIG.4
 */
import { ModelSettings, ProviderConfig } from '../types/model-settings.js';
/**
 * Raw config file structure
 */
interface RawConfig {
    models?: Partial<ModelSettings>;
    apiKeys?: ProviderConfig;
}
/**
 * Validation result
 */
export interface ConfigValidation {
    valid: boolean;
    missingKeys: string[];
}
/**
 * ModelConfig class for loading and merging model configuration
 */
export declare class ModelConfig {
    private userConfigDir;
    private userConfig;
    private projectConfig;
    constructor(userConfigDir: string);
    /**
     * Load user config from ~/.oss/config.json
     */
    loadUserConfig(): Promise<RawConfig>;
    /**
     * Load project config from .oss/config.json
     */
    loadProjectConfig(projectPath: string): Promise<RawConfig>;
    /**
     * Get merged config with precedence: Project > User > Default
     */
    getMergedConfig(projectPath: string): Promise<ModelSettings>;
    /**
     * Merge model settings from source into target
     */
    private mergeModelSettings;
    /**
     * Validate config - check API keys exist for configured providers
     */
    validateConfig(projectPath: string): Promise<ConfigValidation>;
    /**
     * Check if API key exists for provider (config or env var)
     */
    private hasApiKey;
    /**
     * Get API key for provider (env var takes precedence)
     */
    getApiKey(provider: string): string | undefined;
}
export {};
//# sourceMappingURL=model-config.d.ts.map