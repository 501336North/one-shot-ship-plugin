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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_VERSION = '1.4.0';
export class PromptCache {
    cacheDir;
    currentVersion;
    // SECURITY: Disk caching disabled by default
    cachingEnabled = false;
    constructor(version = DEFAULT_VERSION) {
        this.cacheDir = path.join(os.homedir(), '.oss', 'cache', 'prompts');
        this.currentVersion = version;
    }
    /**
     * Get a cached prompt if valid (not expired, version matches)
     * SECURITY: Returns null when caching is disabled (default)
     */
    getCachedPrompt(type, name) {
        // SECURITY: Disk caching disabled by default
        if (!this.cachingEnabled) {
            return null;
        }
        const cachePath = this.getCachePath(type, name);
        if (!fs.existsSync(cachePath)) {
            return null;
        }
        try {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            // Check if expired
            if (Date.now() > cached.expiresAt) {
                return null;
            }
            // Check if version matches
            if (cached.version !== this.currentVersion) {
                return null;
            }
            return cached.content;
        }
        catch {
            return null;
        }
    }
    /**
     * Cache a prompt for future use
     * SECURITY: No-op when caching is disabled (default)
     */
    setCachedPrompt(type, name, content) {
        // SECURITY: Disk caching disabled by default
        if (!this.cachingEnabled) {
            return;
        }
        const cachePath = this.getCachePath(type, name);
        const cacheDir = path.dirname(cachePath);
        // Create cache directory if needed
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        const cached = {
            content,
            version: this.currentVersion,
            cachedAt: Date.now(),
            expiresAt: Date.now() + CACHE_TTL_MS,
        };
        fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2));
    }
    /**
     * Clear all cached prompts
     */
    clearCache() {
        if (fs.existsSync(this.cacheDir)) {
            fs.rmSync(this.cacheDir, { recursive: true, force: true });
        }
    }
    /**
     * Get the cache file path for a prompt
     */
    getCachePath(type, name) {
        return path.join(this.cacheDir, type, `${name}.json`);
    }
}
//# sourceMappingURL=prompt-cache.js.map