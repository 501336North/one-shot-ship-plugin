/**
 * ProviderDetector Tests
 *
 * @behavior Provider is detected from model identifier correctly
 * @acceptance-criteria AC-PROVIDER.1 through AC-PROVIDER.5
 */

import { describe, it, expect } from 'vitest';
import { detectProvider } from '../../src/services/provider-detector.js';

describe('ProviderDetector', () => {
  describe('detectProvider', () => {
    it('should detect OpenRouter models', () => {
      expect(detectProvider('openrouter/deepseek/chat')).toBe('openrouter');
      expect(detectProvider('openrouter/anthropic/claude-3.5-sonnet')).toBe('openrouter');
      expect(detectProvider('openrouter/mistral/mistral-large')).toBe('openrouter');
    });

    it('should detect Ollama models', () => {
      expect(detectProvider('ollama/codellama')).toBe('ollama');
      expect(detectProvider('ollama/llama3.2')).toBe('ollama');
      expect(detectProvider('ollama/deepseek-coder')).toBe('ollama');
      expect(detectProvider('ollama/mixtral')).toBe('ollama');
    });

    it('should detect OpenAI models', () => {
      expect(detectProvider('openai/gpt-4o')).toBe('openai');
      expect(detectProvider('openai/o1')).toBe('openai');
      expect(detectProvider('openai/gpt-4-turbo')).toBe('openai');
      expect(detectProvider('openai/gpt-3.5-turbo')).toBe('openai');
    });

    it('should detect Gemini models', () => {
      expect(detectProvider('gemini/gemini-2.0-flash')).toBe('gemini');
      expect(detectProvider('gemini/gemini-2.0-pro')).toBe('gemini');
      expect(detectProvider('gemini/gemini-1.5-pro')).toBe('gemini');
    });

    it('should return claude for default/native', () => {
      expect(detectProvider('default')).toBe('claude');
      expect(detectProvider('claude')).toBe('claude');
    });

    it('should return null for invalid model identifiers', () => {
      expect(detectProvider('invalid')).toBeNull();
      expect(detectProvider('')).toBeNull();
      expect(detectProvider('unknown/model')).toBeNull();
      expect(detectProvider('/')).toBeNull();
      expect(detectProvider('openrouter')).toBeNull(); // No model name
    });

    it('should handle complex OpenRouter model paths', () => {
      // OpenRouter often has nested paths like provider/vendor/model
      expect(detectProvider('openrouter/meta-llama/llama-3.1-70b-instruct')).toBe('openrouter');
      expect(detectProvider('openrouter/google/gemini-pro')).toBe('openrouter');
    });

    it('should be case-sensitive for provider names', () => {
      // Only lowercase providers are valid
      expect(detectProvider('OPENROUTER/model')).toBeNull();
      expect(detectProvider('Ollama/model')).toBeNull();
      expect(detectProvider('OpenAI/model')).toBeNull();
      expect(detectProvider('DEFAULT')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace in model identifiers', () => {
      // Whitespace should not be trimmed - invalid format
      expect(detectProvider(' openrouter/model')).toBeNull();
      expect(detectProvider('openrouter/model ')).toBeNull();
      expect(detectProvider(' default ')).toBeNull();
    });

    it('should handle special characters in model names', () => {
      // Model names can have special characters
      expect(detectProvider('ollama/llama-3.1-70b')).toBe('ollama');
      expect(detectProvider('openai/gpt-4o-2024-05-13')).toBe('openai');
    });

    it('should handle empty model name after provider', () => {
      expect(detectProvider('openrouter/')).toBeNull();
      expect(detectProvider('ollama/')).toBeNull();
    });
  });
});
