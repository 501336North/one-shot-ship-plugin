/**
 * Local cache service for OSS Decrypt CLI
 * Caches decrypted prompts to eliminate repeated API calls
 *
 * Security:
 * - Cache files are stored with mode 0o600 (owner read/write only)
 * - Cache directory is created with mode 0o700 (owner only)
 * - Input validation prevents path traversal attacks
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, chmodSync } from 'fs';
import { join } from 'path';

/**
 * Default TTL for cached prompts (1 hour in milliseconds)
 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * Allowed prompt types (runtime validation)
 */
const ALLOWED_TYPES = ['commands', 'workflows', 'skills', 'agents', 'hooks'] as const;
export type PromptType = (typeof ALLOWED_TYPES)[number];

/**
 * Cache entry structure
 */
interface CacheEntry {
  content: string;
  timestamp: number;
  ttl: number;
}

/**
 * Validate prompt type at runtime
 * @throws Error if type is invalid
 */
export function validateType(type: string): asserts type is PromptType {
  if (!ALLOWED_TYPES.includes(type as PromptType)) {
    throw new Error(`Invalid prompt type: ${type}. Allowed: ${ALLOWED_TYPES.join(', ')}`);
  }
}

/**
 * Validate prompt name to prevent path traversal
 * @throws Error if name contains path traversal characters
 */
export function validateName(name: string): void {
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new Error(`Invalid prompt name: contains path traversal characters`);
  }
  if (name.length === 0 || name.length > 100) {
    throw new Error(`Invalid prompt name: must be 1-100 characters`);
  }
}

/**
 * Generate a cache key from prompt parameters
 * @throws Error if type or name are invalid
 */
export function getCacheKey(
  type: string,
  name: string,
  userId: string
): string {
  // Runtime validation to prevent path traversal
  validateType(type);
  validateName(name);

  const input = `${type}:${name}:${userId}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Cache service for storing and retrieving decrypted prompts
 */
export class CacheService {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  /**
   * Get the path to a cache file
   */
  private getCachePath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  /**
   * Ensure the cache directory exists with secure permissions (0o700)
   */
  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Check if a cache entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    const now = Date.now();
    return now - entry.timestamp > entry.ttl;
  }

  /**
   * Store a prompt in the cache
   */
  async set(
    type: string,
    name: string,
    userId: string,
    content: string,
    ttl: number = DEFAULT_TTL_MS
  ): Promise<void> {
    this.ensureCacheDir();

    const key = getCacheKey(type, name, userId);
    const entry: CacheEntry = {
      content,
      timestamp: Date.now(),
      ttl,
    };

    const cachePath = this.getCachePath(key);
    writeFileSync(cachePath, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Retrieve a prompt from the cache
   * Returns null if not found or expired
   */
  async get(
    type: string,
    name: string,
    userId: string
  ): Promise<string | null> {
    const key = getCacheKey(type, name, userId);
    const cachePath = this.getCachePath(key);

    if (!existsSync(cachePath)) {
      return null;
    }

    try {
      const data = readFileSync(cachePath, 'utf8');
      const entry: CacheEntry = JSON.parse(data);

      if (this.isExpired(entry)) {
        // Clean up expired entry
        unlinkSync(cachePath);
        return null;
      }

      return entry.content;
    } catch {
      return null;
    }
  }

  /**
   * Check if a valid cache entry exists
   */
  async has(
    type: string,
    name: string,
    userId: string
  ): Promise<boolean> {
    const result = await this.get(type, name, userId);
    return result !== null;
  }

  /**
   * Remove a specific cache entry
   */
  async clear(
    type: string,
    name: string,
    userId: string
  ): Promise<void> {
    const key = getCacheKey(type, name, userId);
    const cachePath = this.getCachePath(key);

    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }
  }

  /**
   * Remove all cached prompts
   */
  async clearAll(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      return;
    }

    const files = readdirSync(this.cacheDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        unlinkSync(join(this.cacheDir, file));
      }
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ entries: number; totalBytes: number }> {
    if (!existsSync(this.cacheDir)) {
      return { entries: 0, totalBytes: 0 };
    }

    const files = readdirSync(this.cacheDir);
    let totalBytes = 0;
    let entries = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = join(this.cacheDir, file);
        try {
          const content = readFileSync(filePath, 'utf8');
          totalBytes += Buffer.byteLength(content, 'utf8');
          entries++;
        } catch {
          // Skip files that can't be read
        }
      }
    }

    return { entries, totalBytes };
  }
}
