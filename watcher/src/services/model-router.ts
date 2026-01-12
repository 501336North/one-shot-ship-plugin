/**
 * ModelRouter - Resolve models following precedence chain
 *
 * @behavior Model resolution follows: CLI > User Settings > Project Config > Frontmatter > Default
 * @acceptance-criteria AC-ROUTER.1 through AC-ROUTER.4
 */

import { ModelConfig } from '../config/model-config.js';
import { ModelSettings, ModelIdentifier } from '../types/model-settings.js';

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
 * Cache key structure
 */
interface CacheKey {
  promptType: PromptType;
  promptName: string;
  cliOverride?: string;
  frontmatterModel?: string;
}

/**
 * ModelRouter class for resolving models based on configuration hierarchy
 */
export class ModelRouter {
  private userConfigDir: string;
  private projectDir: string;
  private modelConfig: ModelConfig;
  private cache: Map<string, ModelIdentifier>;
  private configLoaded: boolean;
  private mergedConfig: ModelSettings | null;

  constructor(userConfigDir: string, projectDir: string) {
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
  async resolveModel(params: ResolveModelParams): Promise<ModelIdentifier> {
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
    const result: ModelIdentifier = 'claude';
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get model from merged config for a specific prompt type and name
   */
  private getModelFromConfig(
    promptType: PromptType,
    promptName: string
  ): ModelIdentifier | undefined {
    if (!this.mergedConfig) {
      return undefined;
    }

    // Map prompt type to config key
    const typeToKey: Record<PromptType, keyof ModelSettings> = {
      agent: 'agents',
      command: 'commands',
      skill: 'skills',
      hook: 'hooks',
    };

    const configKey = typeToKey[promptType];
    if (!configKey) {
      return undefined;
    }

    const mappings = this.mergedConfig[configKey] as
      | Record<string, ModelIdentifier>
      | undefined;
    if (!mappings) {
      return undefined;
    }

    return mappings[promptName];
  }

  /**
   * Build a cache key from resolve parameters
   */
  private buildCacheKey(params: ResolveModelParams): string {
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
  invalidateCache(): void {
    this.cache.clear();
    this.configLoaded = false;
    this.mergedConfig = null;
    // Create a new ModelConfig instance to ensure fresh reads
    this.modelConfig = new ModelConfig(this.userConfigDir);
  }
}
