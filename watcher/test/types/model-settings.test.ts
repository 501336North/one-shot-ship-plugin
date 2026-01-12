/**
 * Model Settings Types Tests
 *
 * @behavior Model identifiers are validated and parsed correctly
 * @acceptance-criteria AC-MODEL.1 through AC-MODEL.4
 */

import { describe, it, expect } from 'vitest';
import {
  isValidModelId,
  parseProvider,
  ModelSettings,
  ProviderConfig,
  ModelIdentifier,
  SUPPORTED_PROVIDERS,
} from '../../src/types/model-settings.js';

describe('Model Settings Types', () => {
  describe('isValidModelId', () => {
    it('should validate openrouter model identifiers', () => {
      expect(isValidModelId('openrouter/deepseek/deepseek-chat')).toBe(true);
      expect(isValidModelId('openrouter/anthropic/claude-3.5-sonnet')).toBe(true);
    });

    it('should validate ollama model identifiers', () => {
      expect(isValidModelId('ollama/codellama')).toBe(true);
      expect(isValidModelId('ollama/llama3.2')).toBe(true);
      expect(isValidModelId('ollama/deepseek-coder')).toBe(true);
    });

    it('should validate openai model identifiers', () => {
      expect(isValidModelId('openai/gpt-4o')).toBe(true);
      expect(isValidModelId('openai/o1')).toBe(true);
    });

    it('should validate gemini model identifiers', () => {
      expect(isValidModelId('gemini/gemini-2.0-flash')).toBe(true);
      expect(isValidModelId('gemini/gemini-2.0-pro')).toBe(true);
    });

    it('should validate special values', () => {
      expect(isValidModelId('default')).toBe(true);
      expect(isValidModelId('claude')).toBe(true);
    });

    it('should reject invalid model identifiers', () => {
      expect(isValidModelId('invalid')).toBe(false);
      expect(isValidModelId('')).toBe(false);
      expect(isValidModelId('unknown-provider/model')).toBe(false);
      expect(isValidModelId('openrouter')).toBe(false); // Missing model name
      expect(isValidModelId('/model')).toBe(false); // Missing provider
    });
  });

  describe('parseProvider', () => {
    it('should parse provider from openrouter model identifier', () => {
      expect(parseProvider('openrouter/deepseek/deepseek-chat')).toBe('openrouter');
      expect(parseProvider('openrouter/anthropic/claude-3.5-sonnet')).toBe('openrouter');
    });

    it('should parse provider from ollama model identifier', () => {
      expect(parseProvider('ollama/codellama')).toBe('ollama');
      expect(parseProvider('ollama/llama3.2')).toBe('ollama');
    });

    it('should parse provider from openai model identifier', () => {
      expect(parseProvider('openai/gpt-4o')).toBe('openai');
      expect(parseProvider('openai/o1')).toBe('openai');
    });

    it('should parse provider from gemini model identifier', () => {
      expect(parseProvider('gemini/gemini-2.0-flash')).toBe('gemini');
    });

    it('should return claude for default and claude special values', () => {
      expect(parseProvider('default')).toBe('claude');
      expect(parseProvider('claude')).toBe('claude');
    });

    it('should return null for invalid model identifiers', () => {
      expect(parseProvider('invalid')).toBeNull();
      expect(parseProvider('')).toBeNull();
      expect(parseProvider('unknown/model')).toBeNull();
    });
  });

  describe('SUPPORTED_PROVIDERS', () => {
    it('should include all supported providers', () => {
      expect(SUPPORTED_PROVIDERS).toContain('openrouter');
      expect(SUPPORTED_PROVIDERS).toContain('ollama');
      expect(SUPPORTED_PROVIDERS).toContain('openai');
      expect(SUPPORTED_PROVIDERS).toContain('gemini');
      expect(SUPPORTED_PROVIDERS).toContain('claude');
    });
  });

  describe('type definitions', () => {
    it('should define ModelSettings interface correctly', () => {
      const settings: ModelSettings = {
        default: 'claude',
        fallbackEnabled: true,
        agents: {
          'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
        },
        commands: {
          'oss:ship': 'default',
        },
        skills: {
          'oss:red': 'ollama/codellama',
        },
        hooks: {
          'pre-commit': 'gemini/gemini-2.0-flash',
        },
      };

      expect(settings.default).toBe('claude');
      expect(settings.fallbackEnabled).toBe(true);
      expect(settings.agents?.['oss:code-reviewer']).toBe('openrouter/deepseek/deepseek-chat');
    });

    it('should define ProviderConfig interface correctly', () => {
      const config: ProviderConfig = {
        openrouter: 'sk-or-xxx',
        openai: 'sk-xxx',
        gemini: 'AIza-xxx',
      };

      expect(config.openrouter).toBe('sk-or-xxx');
      expect(config.openai).toBe('sk-xxx');
      expect(config.ollama).toBeUndefined(); // Ollama doesn't need API key
    });

    it('should define ModelIdentifier type correctly', () => {
      const validIds: ModelIdentifier[] = [
        'openrouter/deepseek/deepseek-chat',
        'ollama/codellama',
        'openai/gpt-4o',
        'gemini/gemini-2.0-flash',
        'default',
        'claude',
      ];

      expect(validIds.length).toBe(6);
    });
  });
});
