/**
 * ModelConfig Tests
 *
 * @behavior Model configuration is loaded from user and project configs with correct precedence
 * @acceptance-criteria AC-CONFIG.1 through AC-CONFIG.4
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelConfig } from '../../src/config/model-config.js';
import { ModelSettings, ProviderConfig } from '../../src/types/model-settings.js';

describe('ModelConfig', () => {
  // Track directories for cleanup
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  afterEach(() => {
    // Clean up all test directories
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
  });

  describe('loadUserConfig', () => {
    it('should load user config from ~/.oss/config.json', async () => {
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');

      const userConfig = {
        models: {
          default: 'claude',
          fallbackEnabled: true,
          agents: {
            'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
          },
        },
        apiKeys: {
          openrouter: 'sk-or-xxx',
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(userConfig));

      const config = new ModelConfig(testDir);
      const settings = await config.loadUserConfig();

      expect(settings.models).toBeDefined();
      expect(settings.models?.default).toBe('claude');
      expect(settings.models?.agents?.['oss:code-reviewer']).toBe('openrouter/deepseek/deepseek-chat');
    });

    it('should return empty config if user config does not exist', async () => {
      const testDir = createTestDir();
      const config = new ModelConfig(testDir);

      const settings = await config.loadUserConfig();

      expect(settings.models).toBeUndefined();
      expect(settings.apiKeys).toBeUndefined();
    });

    it('should handle invalid JSON gracefully', async () => {
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');

      fs.writeFileSync(configPath, '{ invalid json }');

      const config = new ModelConfig(testDir);
      const settings = await config.loadUserConfig();

      expect(settings.models).toBeUndefined();
    });
  });

  describe('loadProjectConfig', () => {
    it('should load project config from .oss/config.json', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();
      const ossDir = path.join(projectDir, '.oss');
      fs.mkdirSync(ossDir, { recursive: true });
      const configPath = path.join(ossDir, 'config.json');

      const projectConfig = {
        models: {
          agents: {
            'oss:code-reviewer': 'ollama/codellama',
          },
          commands: {
            'oss:ship': 'gemini/gemini-2.0-flash',
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(projectConfig));

      const config = new ModelConfig(userDir);
      const settings = await config.loadProjectConfig(projectDir);

      expect(settings.models).toBeDefined();
      expect(settings.models?.agents?.['oss:code-reviewer']).toBe('ollama/codellama');
      expect(settings.models?.commands?.['oss:ship']).toBe('gemini/gemini-2.0-flash');
    });

    it('should return empty config if project config does not exist', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      const config = new ModelConfig(userDir);
      const settings = await config.loadProjectConfig(projectDir);

      expect(settings.models).toBeUndefined();
    });
  });

  describe('getMergedConfig', () => {
    it('should merge configs with correct precedence: Project > User > Default', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      // User config
      const userConfigPath = path.join(userDir, 'config.json');
      const userConfig = {
        models: {
          default: 'claude',
          fallbackEnabled: true,
          agents: {
            'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
            'oss:security-auditor': 'openai/gpt-4o',
          },
          commands: {
            'oss:ship': 'default',
          },
        },
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      // Project config (overrides user)
      const ossDir = path.join(projectDir, '.oss');
      fs.mkdirSync(ossDir, { recursive: true });
      const projectConfigPath = path.join(ossDir, 'config.json');
      const projectConfig = {
        models: {
          agents: {
            'oss:code-reviewer': 'ollama/codellama', // Override user setting
          },
          commands: {
            'oss:plan': 'gemini/gemini-2.0-flash', // New setting
          },
        },
      };
      fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig));

      const config = new ModelConfig(userDir);
      const merged = await config.getMergedConfig(projectDir);

      // Project takes precedence over user
      expect(merged.agents?.['oss:code-reviewer']).toBe('ollama/codellama');
      // User setting preserved when no project override
      expect(merged.agents?.['oss:security-auditor']).toBe('openai/gpt-4o');
      // Both user and project commands merged
      expect(merged.commands?.['oss:ship']).toBe('default');
      expect(merged.commands?.['oss:plan']).toBe('gemini/gemini-2.0-flash');
      // Default values present
      expect(merged.default).toBe('claude');
      expect(merged.fallbackEnabled).toBe(true);
    });

    it('should use defaults when no config exists', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      const config = new ModelConfig(userDir);
      const merged = await config.getMergedConfig(projectDir);

      expect(merged.default).toBe('claude');
      expect(merged.fallbackEnabled).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should pass validation when all required API keys exist', async () => {
      const userDir = createTestDir();
      const userConfigPath = path.join(userDir, 'config.json');

      const userConfig = {
        models: {
          agents: {
            'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
          },
        },
        apiKeys: {
          openrouter: 'sk-or-xxx',
        },
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      const config = new ModelConfig(userDir);
      await config.loadUserConfig();
      const validation = await config.validateConfig(userDir);

      expect(validation.valid).toBe(true);
      expect(validation.missingKeys).toEqual([]);
    });

    it('should fail validation when required API keys are missing', async () => {
      const userDir = createTestDir();
      const userConfigPath = path.join(userDir, 'config.json');

      const userConfig = {
        models: {
          agents: {
            'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
            'oss:security-auditor': 'openai/gpt-4o',
          },
        },
        apiKeys: {
          // Missing openrouter and openai keys
        },
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      const config = new ModelConfig(userDir);
      await config.loadUserConfig();
      const validation = await config.validateConfig(userDir);

      expect(validation.valid).toBe(false);
      expect(validation.missingKeys).toContain('openrouter');
      expect(validation.missingKeys).toContain('openai');
    });

    it('should not require API key for ollama (local) models', async () => {
      const userDir = createTestDir();
      const userConfigPath = path.join(userDir, 'config.json');

      const userConfig = {
        models: {
          agents: {
            'oss:code-reviewer': 'ollama/codellama',
          },
        },
        apiKeys: {
          // No API keys needed for ollama
        },
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      const config = new ModelConfig(userDir);
      await config.loadUserConfig();
      const validation = await config.validateConfig(userDir);

      expect(validation.valid).toBe(true);
      expect(validation.missingKeys).toEqual([]);
    });

    it('should not require API key for default/claude models', async () => {
      const userDir = createTestDir();
      const userConfigPath = path.join(userDir, 'config.json');

      const userConfig = {
        models: {
          agents: {
            'oss:code-reviewer': 'default',
            'oss:security-auditor': 'claude',
          },
        },
        apiKeys: {},
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      const config = new ModelConfig(userDir);
      await config.loadUserConfig();
      const validation = await config.validateConfig(userDir);

      expect(validation.valid).toBe(true);
      expect(validation.missingKeys).toEqual([]);
    });

    it('should check environment variables for API keys', async () => {
      const userDir = createTestDir();
      const userConfigPath = path.join(userDir, 'config.json');

      const userConfig = {
        models: {
          agents: {
            'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
          },
        },
        apiKeys: {
          // No openrouter key in config
        },
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      // Set env var
      process.env.OPENROUTER_API_KEY = 'env-key';

      const config = new ModelConfig(userDir);
      await config.loadUserConfig();
      const validation = await config.validateConfig(userDir);

      expect(validation.valid).toBe(true);
      expect(validation.missingKeys).toEqual([]);

      // Cleanup
      delete process.env.OPENROUTER_API_KEY;
    });
  });

  describe('getApiKey', () => {
    it('should return API key from config', async () => {
      const userDir = createTestDir();
      const userConfigPath = path.join(userDir, 'config.json');

      const userConfig = {
        apiKeys: {
          openrouter: 'sk-or-xxx',
        },
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      const config = new ModelConfig(userDir);
      await config.loadUserConfig();
      const key = config.getApiKey('openrouter');

      expect(key).toBe('sk-or-xxx');
    });

    it('should prefer environment variable over config', async () => {
      const userDir = createTestDir();
      const userConfigPath = path.join(userDir, 'config.json');

      const userConfig = {
        apiKeys: {
          openrouter: 'config-key',
        },
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));

      process.env.OPENROUTER_API_KEY = 'env-key';

      const config = new ModelConfig(userDir);
      await config.loadUserConfig();
      const key = config.getApiKey('openrouter');

      expect(key).toBe('env-key');

      // Cleanup
      delete process.env.OPENROUTER_API_KEY;
    });

    it('should return undefined if API key not found', async () => {
      const userDir = createTestDir();

      const config = new ModelConfig(userDir);
      const key = config.getApiKey('openrouter');

      expect(key).toBeUndefined();
    });
  });
});
