/**
 * @file Model Registry
 * @description Registry of available models with pricing and metadata
 *
 * @behavior ModelRegistry stores model metadata including pricing
 * @acceptance-criteria AC-REGISTRY.1 through AC-REGISTRY.4
 */
import { Provider } from '../types/model-settings.js';
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
 * Model Registry - stores and queries model information
 */
export declare class ModelRegistry {
    private models;
    constructor();
    /**
     * Get pricing for a model
     */
    getPricing(modelId: string): ModelPricing;
    /**
     * List models, optionally filtered by provider
     */
    listModels(provider?: Provider): ModelInfo[];
    /**
     * Search models by query (matches name, id, or tags)
     */
    searchModels(query: string): ModelInfo[];
    /**
     * Get only free models
     */
    getFreeModels(): ModelInfo[];
    /**
     * Get full info for a specific model
     */
    getModelInfo(modelId: string): ModelInfo | undefined;
}
//# sourceMappingURL=model-registry.d.ts.map