/**
 * SettingsService Model Configuration Tests
 *
 * @behavior Model configuration is persisted to settings.json with environment variable precedence for API keys
 * @acceptance-criteria AC-SETTINGS-MODEL.1 through AC-SETTINGS-MODEL.6
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SettingsService } from '../../src/services/settings.js';
import { ModelSettings, ProviderConfig } from '../../src/types/model-settings.js';

describe('Settings - Model Configuration', () => {
  // Track directories for cleanup
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-model-test-'));
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
    // Restore environment
    vi.unstubAllEnvs();
  });

  describe('setModelForPrompt and getModelForPrompt', () => {
    /**
     * @behavior Users can configure which model to use for specific agents
     * @acceptance-criteria AC-SETTINGS-MODEL.1
     */
    it('should get model config for agent prompt', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setModelForPrompt('agent', 'oss:code-reviewer', 'ollama/codellama');
      const model = await settings.getModelForPrompt('agent', 'oss:code-reviewer');

      expect(model).toBe('ollama/codellama');
    });

    /**
     * @behavior Users can configure which model to use for specific commands
     * @acceptance-criteria AC-SETTINGS-MODEL.1
     */
    it('should get model config for command prompt', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setModelForPrompt('command', 'oss:ship', 'openai/gpt-4o');
      const model = await settings.getModelForPrompt('command', 'oss:ship');

      expect(model).toBe('openai/gpt-4o');
    });

    /**
     * @behavior Users can configure which model to use for specific skills
     * @acceptance-criteria AC-SETTINGS-MODEL.1
     */
    it('should get model config for skill prompt', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setModelForPrompt('skill', 'oss:red', 'gemini/gemini-2.0-flash');
      const model = await settings.getModelForPrompt('skill', 'oss:red');

      expect(model).toBe('gemini/gemini-2.0-flash');
    });

    /**
     * @behavior Users can configure which model to use for specific hooks
     * @acceptance-criteria AC-SETTINGS-MODEL.1
     */
    it('should get model config for hook prompt', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setModelForPrompt('hook', 'pre-commit', 'openrouter/deepseek/deepseek-chat');
      const model = await settings.getModelForPrompt('hook', 'pre-commit');

      expect(model).toBe('openrouter/deepseek/deepseek-chat');
    });

    /**
     * @behavior Unconfigured prompts return undefined
     * @acceptance-criteria AC-SETTINGS-MODEL.2
     */
    it('should return undefined for unconfigured prompt', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      const model = await settings.getModelForPrompt('agent', 'unconfigured-agent');

      expect(model).toBeUndefined();
    });

    /**
     * @behavior Model configuration persists to disk
     * @acceptance-criteria AC-SETTINGS-MODEL.3
     */
    it('should persist model config to disk', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setModelForPrompt('agent', 'oss:code-reviewer', 'ollama/codellama');

      // Create a new instance to verify persistence
      const settings2 = new SettingsService(testDir);
      const model = await settings2.getModelForPrompt('agent', 'oss:code-reviewer');

      expect(model).toBe('ollama/codellama');
    });
  });

  describe('getModelConfig', () => {
    /**
     * @behavior Users can list all configured models
     * @acceptance-criteria AC-SETTINGS-MODEL.4
     */
    it('should list all configured models', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      const models = await settings.getModelConfig();

      expect(models.agents).toBeDefined();
      expect(models.commands).toBeDefined();
      expect(models.skills).toBeDefined();
      expect(models.hooks).toBeDefined();
    });

    /**
     * @behavior Model config returns empty objects for unconfigured types
     * @acceptance-criteria AC-SETTINGS-MODEL.4
     */
    it('should return default model settings when none configured', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      const models = await settings.getModelConfig();

      expect(models.default).toBe('claude');
      expect(models.fallbackEnabled).toBe(true);
      expect(models.agents).toEqual({});
      expect(models.commands).toEqual({});
      expect(models.skills).toEqual({});
      expect(models.hooks).toEqual({});
    });

    /**
     * @behavior Model config reflects all set models
     * @acceptance-criteria AC-SETTINGS-MODEL.4
     */
    it('should reflect all configured models', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setModelForPrompt('agent', 'oss:code-reviewer', 'ollama/codellama');
      await settings.setModelForPrompt('command', 'oss:ship', 'openai/gpt-4o');

      const models = await settings.getModelConfig();

      expect(models.agents?.['oss:code-reviewer']).toBe('ollama/codellama');
      expect(models.commands?.['oss:ship']).toBe('openai/gpt-4o');
    });
  });

  describe('setApiKey and getApiKey', () => {
    /**
     * @behavior Users can store API keys securely
     * @acceptance-criteria AC-SETTINGS-MODEL.5
     */
    it('should store API keys securely', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setApiKey('openrouter', 'sk-or-xxx');
      const key = await settings.getApiKey('openrouter');

      expect(key).toBe('sk-or-xxx');
    });

    /**
     * @behavior Multiple provider API keys can be stored
     * @acceptance-criteria AC-SETTINGS-MODEL.5
     */
    it('should store multiple provider API keys', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setApiKey('openrouter', 'sk-or-xxx');
      await settings.setApiKey('openai', 'sk-openai-xxx');
      await settings.setApiKey('gemini', 'AIza-xxx');

      expect(await settings.getApiKey('openrouter')).toBe('sk-or-xxx');
      expect(await settings.getApiKey('openai')).toBe('sk-openai-xxx');
      expect(await settings.getApiKey('gemini')).toBe('AIza-xxx');
    });

    /**
     * @behavior API keys persist to disk
     * @acceptance-criteria AC-SETTINGS-MODEL.5
     */
    it('should persist API keys to disk', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setApiKey('openrouter', 'sk-or-xxx');

      // Create a new instance to verify persistence
      const settings2 = new SettingsService(testDir);
      const key = await settings2.getApiKey('openrouter');

      expect(key).toBe('sk-or-xxx');
    });

    /**
     * @behavior Unconfigured API keys return undefined
     * @acceptance-criteria AC-SETTINGS-MODEL.5
     */
    it('should return undefined for unconfigured API key', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      const key = await settings.getApiKey('openrouter');

      expect(key).toBeUndefined();
    });
  });

  describe('environment variable precedence', () => {
    /**
     * @behavior Environment variables take precedence over stored API keys
     * @acceptance-criteria AC-SETTINGS-MODEL.6
     */
    it('should use OPENROUTER_API_KEY env var over stored key', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      // Store a key
      await settings.setApiKey('openrouter', 'stored-key');

      // Set environment variable
      vi.stubEnv('OPENROUTER_API_KEY', 'env-key');

      const key = await settings.getApiKey('openrouter');

      expect(key).toBe('env-key');
    });

    /**
     * @behavior Environment variables take precedence over stored API keys for OpenAI
     * @acceptance-criteria AC-SETTINGS-MODEL.6
     */
    it('should use OPENAI_API_KEY env var over stored key', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setApiKey('openai', 'stored-key');
      vi.stubEnv('OPENAI_API_KEY', 'env-key');

      const key = await settings.getApiKey('openai');

      expect(key).toBe('env-key');
    });

    /**
     * @behavior Environment variables take precedence over stored API keys for Gemini
     * @acceptance-criteria AC-SETTINGS-MODEL.6
     */
    it('should use GEMINI_API_KEY env var over stored key', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      await settings.setApiKey('gemini', 'stored-key');
      vi.stubEnv('GEMINI_API_KEY', 'env-key');

      const key = await settings.getApiKey('gemini');

      expect(key).toBe('env-key');
    });

    /**
     * @behavior Ollama does not require API key (local provider)
     * @acceptance-criteria AC-SETTINGS-MODEL.6
     */
    it('should return ollama base URL without API key requirement', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      // Ollama stores base URL, not API key
      await settings.setApiKey('ollama', 'http://localhost:11434');
      const url = await settings.getApiKey('ollama');

      expect(url).toBe('http://localhost:11434');
    });

    /**
     * @behavior Falls back to stored key when env var not set
     * @acceptance-criteria AC-SETTINGS-MODEL.6
     */
    it('should fall back to stored key when env var not set', async () => {
      const testDir = createTestDir();
      const settings = new SettingsService(testDir);

      // Ensure env var is not set
      delete process.env.OPENROUTER_API_KEY;

      await settings.setApiKey('openrouter', 'stored-key');
      const key = await settings.getApiKey('openrouter');

      expect(key).toBe('stored-key');
    });
  });
});
