/**
 * ModelRouter - Resolve models following precedence chain
 *
 * @behavior Model resolution follows: CLI > User Settings > Project Config > Frontmatter > Default
 * @acceptance-criteria AC-ROUTER.1 through AC-ROUTER.4
 */
import { ModelIdentifier } from '../types/model-settings.js';
/**
 * Prompt types that can have model mappings
 */
export type PromptType = 'agent' | 'command' | 'skill' | 'hook';
/**
 * Parameters for resolving a model
 */
export interface ResolveModelParams {
    /** Type of prompt (agent, command, skill, hook) */
    promptType: PromptType;
    /** Name of the prompt (e.g., 'oss:ship', 'oss:code-reviewer') */
    promptName: string;
    /** CLI override model (highest precedence) */
    cliOverride?: ModelIdentifier;
    /** Model from frontmatter (lowest precedence before default) */
    frontmatterModel?: ModelIdentifier;
}
/**
 * ModelRouter class for resolving models based on configuration hierarchy
 */
export declare class ModelRouter {
    private userConfigDir;
    private projectDir;
    private modelConfig;
    private cache;
    private configLoaded;
    private mergedConfig;
    constructor(userConfigDir: string, projectDir: string);
    /**
     * Resolve model for a prompt following precedence chain:
     * 1. CLI override (highest)
     * 2. Project config
     * 3. User config
     * 4. Frontmatter
     * 5. Global default
     * 6. 'claude' (fallback default)
     */
    resolveModel(params: ResolveModelParams): Promise<ModelIdentifier>;
    /**
     * Get model from merged config for a specific prompt type and name
     */
    private getModelFromConfig;
    /**
     * Build a cache key from resolve parameters
     */
    private buildCacheKey;
    /**
     * Invalidate the cache (call when config changes)
     */
    invalidateCache(): void;
}
//# sourceMappingURL=model-router.d.ts.map