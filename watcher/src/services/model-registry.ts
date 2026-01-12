/**
 * @file Model Registry
 * @description Registry of available models with pricing and metadata
 *
 * @behavior ModelRegistry stores model metadata including pricing
 * @acceptance-criteria AC-REGISTRY.1 through AC-REGISTRY.4
 */

import { Provider, SUPPORTED_PROVIDERS } from '../types/model-settings.js';

/**
 * Model pricing per million tokens
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Full model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  isFree: boolean;
  tags: string[];
  pricing: ModelPricing;
}

/**
 * Model registry data
 */
const MODELS: ModelInfo[] = [
  // OpenRouter models
  {
    id: 'openrouter/deepseek/deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'openrouter',
    isFree: false,
    tags: ['chat', 'general'],
    pricing: { inputPer1M: 0.14, outputPer1M: 0.28 },
  },
  {
    id: 'openrouter/deepseek/deepseek-coder',
    name: 'DeepSeek Coder',
    provider: 'openrouter',
    isFree: false,
    tags: ['code', 'programming'],
    pricing: { inputPer1M: 0.14, outputPer1M: 0.28 },
  },
  {
    id: 'openrouter/anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'openrouter',
    isFree: false,
    tags: ['chat', 'general', 'code'],
    pricing: { inputPer1M: 3.00, outputPer1M: 15.00 },
  },
  {
    id: 'openrouter/openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openrouter',
    isFree: false,
    tags: ['chat', 'general', 'code'],
    pricing: { inputPer1M: 2.50, outputPer1M: 10.00 },
  },
  {
    id: 'openrouter/meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B (Free)',
    provider: 'openrouter',
    isFree: true,
    tags: ['chat', 'llama', 'free'],
    pricing: { inputPer1M: 0, outputPer1M: 0 },
  },

  // Ollama models (all free - local)
  {
    id: 'ollama/llama3.2',
    name: 'Llama 3.2',
    provider: 'ollama',
    isFree: true,
    tags: ['chat', 'general', 'llama', 'free'],
    pricing: { inputPer1M: 0, outputPer1M: 0 },
  },
  {
    id: 'ollama/codellama',
    name: 'CodeLlama',
    provider: 'ollama',
    isFree: true,
    tags: ['code', 'programming', 'llama', 'free'],
    pricing: { inputPer1M: 0, outputPer1M: 0 },
  },
  {
    id: 'ollama/mistral',
    name: 'Mistral',
    provider: 'ollama',
    isFree: true,
    tags: ['chat', 'general', 'free'],
    pricing: { inputPer1M: 0, outputPer1M: 0 },
  },
  {
    id: 'ollama/qwen2.5-coder',
    name: 'Qwen 2.5 Coder',
    provider: 'ollama',
    isFree: true,
    tags: ['code', 'programming', 'free'],
    pricing: { inputPer1M: 0, outputPer1M: 0 },
  },

  // OpenAI models
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    isFree: false,
    tags: ['chat', 'general', 'code'],
    pricing: { inputPer1M: 2.50, outputPer1M: 10.00 },
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    isFree: false,
    tags: ['chat', 'general'],
    pricing: { inputPer1M: 0.15, outputPer1M: 0.60 },
  },
  {
    id: 'openai/o1',
    name: 'o1',
    provider: 'openai',
    isFree: false,
    tags: ['reasoning', 'code'],
    pricing: { inputPer1M: 15.00, outputPer1M: 60.00 },
  },
  {
    id: 'openai/o1-mini',
    name: 'o1 Mini',
    provider: 'openai',
    isFree: false,
    tags: ['reasoning'],
    pricing: { inputPer1M: 3.00, outputPer1M: 12.00 },
  },

  // Gemini models
  {
    id: 'gemini/gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    isFree: false,
    tags: ['chat', 'fast'],
    pricing: { inputPer1M: 0.075, outputPer1M: 0.30 },
  },
  {
    id: 'gemini/gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'gemini',
    isFree: false,
    tags: ['chat', 'general'],
    pricing: { inputPer1M: 1.25, outputPer1M: 5.00 },
  },
  {
    id: 'gemini/gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'gemini',
    isFree: false,
    tags: ['chat', 'fast'],
    pricing: { inputPer1M: 0.075, outputPer1M: 0.30 },
  },
];

/**
 * Model Registry - stores and queries model information
 */
export class ModelRegistry {
  private models: ModelInfo[];

  constructor() {
    this.models = MODELS;
  }

  /**
   * Get pricing for a model
   */
  getPricing(modelId: string): ModelPricing {
    // Handle special cases
    if (modelId === 'default' || modelId === 'claude') {
      return { inputPer1M: 0, outputPer1M: 0 };
    }

    // Handle generic ollama models
    if (modelId.startsWith('ollama/')) {
      return { inputPer1M: 0, outputPer1M: 0 };
    }

    const model = this.models.find((m) => m.id === modelId);
    if (model) {
      return model.pricing;
    }

    // Unknown model
    return { inputPer1M: 0, outputPer1M: 0 };
  }

  /**
   * List models, optionally filtered by provider
   */
  listModels(provider?: Provider): ModelInfo[] {
    if (!provider) {
      return [...this.models];
    }

    return this.models.filter((m) => m.provider === provider);
  }

  /**
   * Search models by query (matches name, id, or tags)
   */
  searchModels(query: string): ModelInfo[] {
    const lowerQuery = query.toLowerCase();

    return this.models.filter(
      (m) =>
        m.id.toLowerCase().includes(lowerQuery) ||
        m.name.toLowerCase().includes(lowerQuery) ||
        m.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get only free models
   */
  getFreeModels(): ModelInfo[] {
    return this.models.filter((m) => m.isFree);
  }

  /**
   * Get full info for a specific model
   */
  getModelInfo(modelId: string): ModelInfo | undefined {
    return this.models.find((m) => m.id === modelId);
  }
}
