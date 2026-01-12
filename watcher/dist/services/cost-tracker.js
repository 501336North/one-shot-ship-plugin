/**
 * @file Cost Tracker
 * @description Track token usage and calculate costs per model/command
 *
 * @behavior CostTracker tracks tokens and calculates costs per request
 * @acceptance-criteria AC-COST.1 through AC-COST.4
 */
import * as fs from 'fs';
import * as path from 'path';
/**
 * Known model pricing (USD per million tokens)
 */
const MODEL_PRICING = {
    // OpenAI models
    'openai/gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
    'openai/gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
    'openai/o1': { inputPer1M: 15.00, outputPer1M: 60.00 },
    'openai/o1-mini': { inputPer1M: 3.00, outputPer1M: 12.00 },
    // OpenRouter models (via OpenRouter pricing)
    'openrouter/deepseek/deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
    'openrouter/deepseek/deepseek-coder': { inputPer1M: 0.14, outputPer1M: 0.28 },
    'openrouter/anthropic/claude-3.5-sonnet': { inputPer1M: 3.00, outputPer1M: 15.00 },
    'openrouter/openai/gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
    // Gemini models
    'gemini/gemini-2.0-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
    'gemini/gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
    'gemini/gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
    // Local/free models
    'ollama/codellama': { inputPer1M: 0, outputPer1M: 0 },
    'ollama/llama3.2': { inputPer1M: 0, outputPer1M: 0 },
    'ollama/mistral': { inputPer1M: 0, outputPer1M: 0 },
    'ollama/qwen2.5-coder': { inputPer1M: 0, outputPer1M: 0 },
    // Default (Claude via user's account - we don't track cost)
    'default': { inputPer1M: 0, outputPer1M: 0 },
    'claude': { inputPer1M: 0, outputPer1M: 0 },
};
/**
 * Cost Tracker - tracks token usage and calculates costs
 */
export class CostTracker {
    dataDir;
    records = [];
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    /**
     * Record token usage for a request
     */
    recordUsage(record) {
        // Calculate cost
        const cost = this.calculateCost(record.model, record.inputTokens, record.outputTokens);
        this.records.push({
            ...record,
            costUsd: cost,
        });
    }
    /**
     * Calculate cost for a model and token counts
     */
    calculateCost(model, inputTokens, outputTokens) {
        const pricing = MODEL_PRICING[model];
        if (!pricing) {
            // Check if it's an ollama model (all free)
            if (model.startsWith('ollama/')) {
                return 0;
            }
            // Unknown model, return 0
            return 0;
        }
        const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
        const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
        return inputCost + outputCost;
    }
    /**
     * Get overall usage statistics
     */
    getStats() {
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;
        for (const record of this.records) {
            totalInputTokens += record.inputTokens;
            totalOutputTokens += record.outputTokens;
            totalCostUsd += record.costUsd || 0;
        }
        return {
            totalTokens: totalInputTokens + totalOutputTokens,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalCostUsd,
            requests: this.records.length,
        };
    }
    /**
     * Get usage for a specific date
     */
    getUsageByDate(date) {
        const filtered = this.records.filter((r) => r.timestamp.startsWith(date));
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;
        for (const record of filtered) {
            totalInputTokens += record.inputTokens;
            totalOutputTokens += record.outputTokens;
            totalCostUsd += record.costUsd || 0;
        }
        return {
            totalTokens: totalInputTokens + totalOutputTokens,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalCostUsd,
            requests: filtered.length,
        };
    }
    /**
     * Get usage aggregated by command
     */
    getUsageByCommand(command) {
        const filtered = this.records.filter((r) => r.command === command);
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;
        for (const record of filtered) {
            totalInputTokens += record.inputTokens;
            totalOutputTokens += record.outputTokens;
            totalCostUsd += record.costUsd || 0;
        }
        return {
            totalTokens: totalInputTokens + totalOutputTokens,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalCostUsd,
            requests: filtered.length,
        };
    }
    /**
     * Flush usage data to disk
     */
    async flush() {
        const usagePath = path.join(this.dataDir, 'usage.json');
        // Ensure directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        // Write records
        fs.writeFileSync(usagePath, JSON.stringify({ records: this.records }, null, 2));
    }
    /**
     * Load usage data from disk
     */
    async load() {
        const usagePath = path.join(this.dataDir, 'usage.json');
        if (fs.existsSync(usagePath)) {
            try {
                const content = fs.readFileSync(usagePath, 'utf-8');
                const data = JSON.parse(content);
                this.records = data.records || [];
            }
            catch {
                // Ignore errors, start fresh
                this.records = [];
            }
        }
    }
}
//# sourceMappingURL=cost-tracker.js.map