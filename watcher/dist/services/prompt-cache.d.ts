/**
 * Prompt Cache Service
 *
 * ⚠️ SECURITY: DISK CACHING IS NOW DISABLED BY DEFAULT
 *
 * Previously cached decrypted prompts locally to reduce command startup latency.
 * This was disabled due to security concerns:
 * - Decrypted prompts persisted in plaintext after API key revocation
 * - Malicious users could extract prompts during trial period
 *
 * The class is retained for:
 * - clearCache() functionality to clean up legacy caches
 * - Potential future opt-in caching with proper security controls
 */
export declare class PromptCache {
    private cacheDir;
    private currentVersion;
    private cachingEnabled;
    constructor(version?: string);
    /**
     * Get a cached prompt if valid (not expired, version matches)
     * SECURITY: Returns null when caching is disabled (default)
     */
    getCachedPrompt(type: string, name: string): string | null;
    /**
     * Cache a prompt for future use
     * SECURITY: No-op when caching is disabled (default)
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