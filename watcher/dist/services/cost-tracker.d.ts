/**
 * @file Cost Tracker
 * @description Track token usage and calculate costs per model/command
 *
 * @behavior CostTracker tracks tokens and calculates costs per request
 * @acceptance-criteria AC-COST.1 through AC-COST.4
 */
/**
 * Usage record for a single API request
 */
export interface UsageRecord {
    command: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    timestamp: string;
    costUsd?: number;
}
/**
 * Usage statistics
 */
export interface UsageStats {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
    requests: number;
}
/**
 * Cost Tracker - tracks token usage and calculates costs
 */
export declare class CostTracker {
    private dataDir;
    private records;
    constructor(dataDir: string);
    /**
     * Record token usage for a request
     */
    recordUsage(record: UsageRecord): void;
    /**
     * Calculate cost for a model and token counts
     */
    private calculateCost;
    /**
     * Get overall usage statistics
     */
    getStats(): UsageStats;
    /**
     * Get usage for a specific date
     */
    getUsageByDate(date: string): UsageStats;
    /**
     * Get usage aggregated by command
     */
    getUsageByCommand(command: string): UsageStats;
    /**
     * Flush usage data to disk
     */
    flush(): Promise<void>;
    /**
     * Load usage data from disk
     */
    load(): Promise<void>;
}
//# sourceMappingURL=cost-tracker.d.ts.map