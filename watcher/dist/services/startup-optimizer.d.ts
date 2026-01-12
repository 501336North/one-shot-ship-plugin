/**
 * Startup Optimizer Service
 *
 * Reduces command initialization time to <100ms through caching
 * and parallel pre-warming of authentication and IRON LAWS.
 */
interface StartupOptimizerOptions {
    authCacheTtl?: number;
    ironLawsCacheTtl?: number;
}
interface AuthResult {
    authenticated: boolean;
    apiKey?: string;
    fromCache?: boolean;
}
interface CachedAuth {
    authenticated: boolean;
    apiKey?: string;
    cachedAt?: number;
}
interface IronLawsResult {
    laws: string[];
    fromCache: boolean;
}
interface CachedIronLaws {
    laws: string[];
    cachedAt: number;
}
interface PreWarmResult {
    authStatus: string;
    ironLawsStatus: string;
    totalTime: number;
}
interface QuickStartResult {
    ready: boolean;
    authenticated: boolean;
    hasIronLaws: boolean;
}
interface InitializeResult {
    ready: boolean;
    command: string;
    error?: string;
}
interface LatencyMetrics {
    lastStartupTime: number;
    averageStartupTime: number;
    cacheHitRate: number;
}
export declare class StartupOptimizer {
    private authCacheTtl;
    private ironLawsCacheTtl;
    private cachedAuth;
    private cachedIronLaws;
    private startupTimes;
    private cacheHits;
    private cacheAccesses;
    constructor(options?: StartupOptimizerOptions);
    /**
     * Check authentication status with caching
     */
    checkAuth(): Promise<AuthResult>;
    /**
     * Get IRON LAWS with caching
     */
    getIronLaws(): Promise<IronLawsResult>;
    /**
     * Set cached authentication (for testing and pre-population)
     */
    setCachedAuth(auth: CachedAuth): void;
    /**
     * Set cached IRON LAWS (for testing and pre-population)
     */
    setCachedIronLaws(laws: CachedIronLaws): void;
    /**
     * Pre-warm the cache by loading auth and IRON LAWS in parallel
     */
    preWarm(): Promise<PreWarmResult>;
    /**
     * Quick start check - returns immediately with cached data status
     */
    quickStart(): QuickStartResult;
    /**
     * Initialize a command with fast startup
     */
    initializeCommand(command: string): Promise<InitializeResult>;
    /**
     * Record a cache access for metrics
     */
    recordCacheAccess(hit: boolean): void;
    /**
     * Get latency metrics
     */
    getLatencyMetrics(): LatencyMetrics;
    /**
     * Clear all caches
     */
    clearCache(): void;
}
export {};
//# sourceMappingURL=startup-optimizer.d.ts.map