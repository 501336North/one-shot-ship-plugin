/**
 * Prompt Cache Service
 *
 * Caches decrypted prompts locally to reduce command startup latency.
 * Target: <10ms cache hit vs 500ms+ API fetch.
 */
export declare class PromptCache {
    private cacheDir;
    private currentVersion;
    constructor(version?: string);
    /**
     * Get a cached prompt if valid (not expired, version matches)
     */
    getCachedPrompt(type: string, name: string): string | null;
    /**
     * Cache a prompt for future use
     */
    setCachedPrompt(type: string, name: string, content: string): void;
    /**
     * Clear all cached prompts
     */
    clearCache(): void;
    /**
     * Get the cache file path for a prompt
     */
    private getCachePath;
}
//# sourceMappingURL=prompt-cache.d.ts.map