/**
 * ModelConfig - Load and merge model configuration from user and project configs
 *
 * @behavior Configuration is loaded with precedence: Project > User > Default
 * @acceptance-criteria AC-CONFIG.1 through AC-CONFIG.4
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ModelSettings,
  ProviderConfig,
  DEFAULT_MODEL_SETTINGS,
  parseProvider,
  Provider,
} from '../types/model-settings.js';

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
 * Environment variable names for API keys
 */
const ENV_KEY_NAMES: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: 'OLLAMA_BASE_URL',
};

/**
 * Providers that don't require API keys
 */
const NO_KEY_REQUIRED: Provider[] = ['ollama', 'claude'];

/**
 * ModelConfig class for loading and merging model configuration
 */
export class ModelConfig {
  private userConfigDir: string;
  private userConfig: RawConfig = {};
  private projectConfig: RawConfig = {};

  constructor(userConfigDir: string) {
    this.userConfigDir = userConfigDir;
  }

  /**
   * Load user config from ~/.oss/config.json
   */
  async loadUserConfig(): Promise<RawConfig> {
    const configPath = path.join(this.userConfigDir, 'config.json');

    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        this.userConfig = JSON.parse(content);
        return this.userConfig;
      }
    } catch {
      // Return empty config on error
    }

    this.userConfig = {};
    return this.userConfig;
  }

  /**
   * Load project config from .oss/config.json
   */
  async loadProjectConfig(projectPath: string): Promise<RawConfig> {
    const configPath = path.join(projectPath, '.oss', 'config.json');

    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        this.projectConfig = JSON.parse(content);
        return this.projectConfig;
      }
    } catch {
      // Return empty config on error
    }

    this.projectConfig = {};
    return this.projectConfig;
  }

  /**
   * Get merged config with precedence: Project > User > Default
   */
  async getMergedConfig(projectPath: string): Promise<ModelSettings> {
    await this.loadUserConfig();
    await this.loadProjectConfig(projectPath);

    // Start with defaults
    const merged: ModelSettings = {
      default: DEFAULT_MODEL_SETTINGS.default,
      fallbackEnabled: DEFAULT_MODEL_SETTINGS.fallbackEnabled,
      agents: {},
      commands: {},
      skills: {},
      hooks: {},
    };

    // Apply user config
    if (this.userConfig.models) {
      this.mergeModelSettings(merged, this.userConfig.models);
    }

    // Apply project config (takes precedence)
    if (this.projectConfig.models) {
      this.mergeModelSettings(merged, this.projectConfig.models);
    }

    return merged;
  }

  /**
   * Merge model settings from source into target
   */
  private mergeModelSettings(
    target: ModelSettings,
    source: Partial<ModelSettings>
  ): void {
    if (source.default !== undefined) {
      target.default = source.default;
    }

    if (source.fallbackEnabled !== undefined) {
      target.fallbackEnabled = source.fallbackEnabled;
    }

    // Merge agent mappings
    if (source.agents) {
      target.agents = {
        ...target.agents,
        ...source.agents,
      };
    }

    // Merge command mappings
    if (source.commands) {
      target.commands = {
        ...target.commands,
        ...source.commands,
      };
    }

    // Merge skill mappings
    if (source.skills) {
      target.skills = {
        ...target.skills,
        ...source.skills,
      };
    }

    // Merge hook mappings
    if (source.hooks) {
      target.hooks = {
        ...target.hooks,
        ...source.hooks,
      };
    }
  }

  /**
   * Validate config - check API keys exist for configured providers
   */
  async validateConfig(projectPath: string): Promise<ConfigValidation> {
    const merged = await this.getMergedConfig(projectPath);

    // Collect all providers used
    const providersUsed = new Set<Provider>();

    // Check all model mappings
    const allMappings = [
      ...(merged.agents ? Object.values(merged.agents) : []),
      ...(merged.commands ? Object.values(merged.commands) : []),
      ...(merged.skills ? Object.values(merged.skills) : []),
      ...(merged.hooks ? Object.values(merged.hooks) : []),
    ];

    for (const modelId of allMappings) {
      const provider = parseProvider(modelId);
      if (provider) {
        providersUsed.add(provider);
      }
    }

    // Check which providers are missing keys
    const missingKeys: string[] = [];

    for (const provider of providersUsed) {
      if (NO_KEY_REQUIRED.includes(provider)) {
        continue;
      }

      const hasKey = this.hasApiKey(provider);
      if (!hasKey) {
        missingKeys.push(provider);
      }
    }

    return {
      valid: missingKeys.length === 0,
      missingKeys,
    };
  }

  /**
   * Check if API key exists for provider (config or env var)
   */
  private hasApiKey(provider: Provider): boolean {
    return this.getApiKey(provider) !== undefined;
  }

  /**
   * Get API key for provider (env var takes precedence)
   */
  getApiKey(provider: string): string | undefined {
    // Check environment variable first
    const envName = ENV_KEY_NAMES[provider];
    if (envName) {
      const envValue = process.env[envName];
      if (envValue) {
        return envValue;
      }
    }

    // Fall back to config
    return this.userConfig.apiKeys?.[provider as keyof ProviderConfig];
  }
}
