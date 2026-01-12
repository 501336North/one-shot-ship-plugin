/**
 * ModelRouter - Resolve models following precedence chain
 *
 * @behavior Model resolution follows: CLI > User Settings > Project Config > Frontmatter > Default
 * @acceptance-criteria AC-ROUTER.1 through AC-ROUTER.4
 */
import { ModelConfig } from '../config/model-config.js';
/**
 * ModelRouter class for resolving models based on configuration hierarchy
 */
export class ModelRouter {
    userConfigDir;
    projectDir;
    modelConfig;
    cache;
    configLoaded;
    mergedConfig;
    constructor(userConfigDir, projectDir) {
        this.userConfigDir = userConfigDir;
        this.projectDir = projectDir;
        this.modelConfig = new ModelConfig(userConfigDir);
        this.cache = new Map();
        this.configLoaded = false;
        this.mergedConfig = null;
    }
    /**
     * Resolve model for a prompt following precedence chain:
     * 1. CLI override (highest)
     * 2. Project config
     * 3. User config
     * 4. Frontmatter
     * 5. Global default
     * 6. 'claude' (fallback default)
     */
    async resolveModel(params) {
        const { promptType, promptName, cliOverride, frontmatterModel } = params;
        // Check cache first
        const cacheKey = this.buildCacheKey(params);
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        // 1. CLI override takes highest precedence
        if (cliOverride) {
            this.cache.set(cacheKey, cliOverride);
            return cliOverride;
        }
        // 2. Load merged config (Project > User > Default)
        if (!this.configLoaded) {
            this.mergedConfig = await this.modelConfig.getMergedConfig(this.projectDir);
            this.configLoaded = true;
        }
        // 3. Check config for specific prompt mapping
        const configModel = this.getModelFromConfig(promptType, promptName);
        if (configModel) {
            this.cache.set(cacheKey, configModel);
            return configModel;
        }
        // 4. Check frontmatter
        if (frontmatterModel) {
            this.cache.set(cacheKey, frontmatterModel);
            return frontmatterModel;
        }
        // 5. Use global default from config if set
        const globalDefault = this.mergedConfig?.default;
        if (globalDefault && globalDefault !== 'claude') {
            this.cache.set(cacheKey, globalDefault);
            return globalDefault;
        }
        // 6. Final fallback: claude
        const result = 'claude';
        this.cache.set(cacheKey, result);
        return result;
    }
    /**
     * Get model from merged config for a specific prompt type and name
     */
    getModelFromConfig(promptType, promptName) {
        if (!this.mergedConfig) {
            return undefined;
        }
        // Map prompt type to config key
        const typeToKey = {
            agent: 'agents',
            command: 'commands',
            skill: 'skills',
            hook: 'hooks',
        };
        const configKey = typeToKey[promptType];
        if (!configKey) {
            return undefined;
        }
        const mappings = this.mergedConfig[configKey];
        if (!mappings) {
            return undefined;
        }
        return mappings[promptName];
    }
    /**
     * Build a cache key from resolve parameters
     */
    buildCacheKey(params) {
        return JSON.stringify({
            promptType: params.promptType,
            promptName: params.promptName,
            cliOverride: params.cliOverride,
            frontmatterModel: params.frontmatterModel,
        });
    }
    /**
     * Invalidate the cache (call when config changes)
     */
    invalidateCache() {
        this.cache.clear();
        this.configLoaded = false;
        this.mergedConfig = null;
        // Create a new ModelConfig instance to ensure fresh reads
        this.modelConfig = new ModelConfig(this.userConfigDir);
    }
}
//# sourceMappingURL=model-router.js.map