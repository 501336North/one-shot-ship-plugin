/**
 * @file Model Registry Tests
 * @behavior ModelRegistry stores model metadata including pricing
 * @acceptance-criteria AC-REGISTRY.1 through AC-REGISTRY.4
 */

import { describe, it, expect } from 'vitest';
import { ModelRegistry } from '../../src/services/model-registry.js';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  describe('getPricing', () => {
    it('should return pricing for known models', () => {
      const pricing = registry.getPricing('openai/gpt-4o');

      expect(pricing.inputPer1M).toBe(2.50);
      expect(pricing.outputPer1M).toBe(10.00);
    });

    it('should return zero cost for local models', () => {
      const pricing = registry.getPricing('ollama/codellama');

      expect(pricing.inputPer1M).toBe(0);
      expect(pricing.outputPer1M).toBe(0);
    });

    it('should return zero cost for default/claude', () => {
      const pricing = registry.getPricing('default');
      expect(pricing.inputPer1M).toBe(0);

      const claudePricing = registry.getPricing('claude');
      expect(claudePricing.inputPer1M).toBe(0);
    });

    it('should return zero for unknown models', () => {
      const pricing = registry.getPricing('unknown/model');
      expect(pricing.inputPer1M).toBe(0);
      expect(pricing.outputPer1M).toBe(0);
    });
  });

  describe('listModels', () => {
    it('should list models by provider', () => {
      const openrouterModels = registry.listModels('openrouter');

      expect(openrouterModels.length).toBeGreaterThan(0);
      expect(openrouterModels.every(m => m.provider === 'openrouter')).toBe(true);
    });

    it('should list all models when no provider specified', () => {
      const allModels = registry.listModels();

      expect(allModels.length).toBeGreaterThan(10);
    });

    it('should return empty array for unknown provider', () => {
      const models = registry.listModels('unknown' as any);
      expect(models).toEqual([]);
    });
  });

  describe('searchModels', () => {
    it('should search models by name', () => {
      const results = registry.searchModels('codellama');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(m => m.id.includes('codellama'))).toBe(true);
    });

    it('should search models by tag', () => {
      const results = registry.searchModels('code');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(m => m.tags.includes('code'))).toBe(true);
    });

    it('should return empty for no matches', () => {
      const results = registry.searchModels('zzzznonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('getFreeModels', () => {
    it('should return only free models', () => {
      const freeModels = registry.getFreeModels();

      expect(freeModels.length).toBeGreaterThan(0);
      expect(freeModels.every(m => m.isFree)).toBe(true);
    });

    it('should include all Ollama models', () => {
      const freeModels = registry.getFreeModels();
      const ollamaModels = freeModels.filter(m => m.provider === 'ollama');

      expect(ollamaModels.length).toBeGreaterThan(0);
    });
  });

  describe('getModelInfo', () => {
    it('should return full info for known model', () => {
      const info = registry.getModelInfo('openai/gpt-4o');

      expect(info).toBeDefined();
      expect(info?.id).toBe('openai/gpt-4o');
      expect(info?.provider).toBe('openai');
      expect(info?.pricing).toBeDefined();
    });

    it('should return undefined for unknown model', () => {
      const info = registry.getModelInfo('unknown/model');
      expect(info).toBeUndefined();
    });
  });
});
