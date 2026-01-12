/**
 * @file Model Executor Tests (Phase 7: Fallback & Error Handling)
 * @behavior ModelExecutor executes requests with fallback support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelExecutor, ExecutionResult } from '../../src/services/model-executor.js';

describe('ModelExecutor', () => {
  let executor: ModelExecutor;

  beforeEach(() => {
    executor = new ModelExecutor();
  });

  describe('execute', () => {
    it('should execute with native Claude when model is default', async () => {
      const result = await executor.execute({
        prompt: 'Test prompt',
        model: 'default',
      });

      expect(result.provider).toBe('claude');
      expect(result.fallbackUsed).toBe(false);
    });

    it('should execute with native Claude for claude model', async () => {
      const result = await executor.execute({
        prompt: 'Test prompt',
        model: 'claude',
      });

      expect(result.provider).toBe('claude');
    });

    it('should use proxy for non-Claude models', async () => {
      const result = await executor.execute({
        prompt: 'Test prompt',
        model: 'ollama/codellama',
      });

      expect(result.provider).toBe('ollama');
    });

    it('should fallback to Claude on model failure when enabled', async () => {
      // Simulate provider failure
      executor.setTestModeProviderFail(true);

      const result = await executor.execute({
        prompt: 'Test prompt',
        model: 'openrouter/invalid-model',
        fallbackEnabled: true,
      });

      expect(result.provider).toBe('claude');
      expect(result.fallbackUsed).toBe(true);
    });

    it('should notify user on fallback', async () => {
      const notify = vi.fn();
      executor.onFallback(notify);
      executor.setTestModeProviderFail(true);

      await executor.execute({
        prompt: 'Test prompt',
        model: 'gemini/test',
        fallbackEnabled: true,
      });

      expect(notify).toHaveBeenCalled();
      expect(notify.mock.calls[0][0]).toContain('falling back to Claude');
    });

    it('should throw when fallback disabled and model fails', async () => {
      executor.setTestModeProviderFail(true);

      await expect(
        executor.execute({
          prompt: 'Test prompt',
          model: 'openai/gpt-4o',
          fallbackEnabled: false,
        })
      ).rejects.toThrow();
    });

    it('should not fallback for successful requests', async () => {
      const result = await executor.execute({
        prompt: 'Test prompt',
        model: 'ollama/llama3.2',
        fallbackEnabled: true,
      });

      expect(result.fallbackUsed).toBe(false);
    });
  });

  describe('provider detection', () => {
    it('should detect openrouter provider', async () => {
      const result = await executor.execute({
        prompt: 'Test',
        model: 'openrouter/deepseek/chat',
      });

      expect(result.provider).toBe('openrouter');
    });

    it('should detect openai provider', async () => {
      const result = await executor.execute({
        prompt: 'Test',
        model: 'openai/gpt-4o',
      });

      expect(result.provider).toBe('openai');
    });

    it('should detect gemini provider', async () => {
      const result = await executor.execute({
        prompt: 'Test',
        model: 'gemini/gemini-2.0-flash',
      });

      expect(result.provider).toBe('gemini');
    });
  });
});
