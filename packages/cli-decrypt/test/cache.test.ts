/**
 * @behavior Prompts are cached after first decryption
 * @acceptance-criteria AC-CACHE-001
 * @business-rule CACHE-001
 * @boundary Filesystem
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { CacheService, getCacheKey, validateType, validateName } from '../src/cache.js';

describe('Cache Storage', () => {
  const testDir = join(tmpdir(), 'oss-cache-test-' + Date.now());
  let cacheService: CacheService;

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    cacheService = new CacheService(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getCacheKey', () => {
    it('should generate a hash from type, name, and userId', () => {
      const key = getCacheKey('commands', 'plan', 'user_123');
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBe(64); // SHA256 produces 64 hex chars
    });

    it('should produce different keys for different inputs', () => {
      const key1 = getCacheKey('commands', 'plan', 'user_123');
      const key2 = getCacheKey('commands', 'build', 'user_123');
      const key3 = getCacheKey('workflows', 'plan', 'user_123');
      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('should produce same key for same inputs', () => {
      const key1 = getCacheKey('commands', 'plan', 'user_123');
      const key2 = getCacheKey('commands', 'plan', 'user_123');
      expect(key1).toBe(key2);
    });
  });

  describe('validateType', () => {
    it('should accept valid types', () => {
      expect(() => validateType('commands')).not.toThrow();
      expect(() => validateType('workflows')).not.toThrow();
      expect(() => validateType('skills')).not.toThrow();
      expect(() => validateType('agents')).not.toThrow();
      expect(() => validateType('hooks')).not.toThrow();
    });

    it('should reject invalid types', () => {
      expect(() => validateType('invalid')).toThrow('Invalid prompt type');
      expect(() => validateType('../etc')).toThrow('Invalid prompt type');
      expect(() => validateType('')).toThrow('Invalid prompt type');
    });
  });

  describe('validateName', () => {
    it('should accept valid names', () => {
      expect(() => validateName('plan')).not.toThrow();
      expect(() => validateName('build')).not.toThrow();
      expect(() => validateName('my-command')).not.toThrow();
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateName('../etc/passwd')).toThrow('path traversal');
      expect(() => validateName('..\\windows\\system32')).toThrow('path traversal');
      expect(() => validateName('foo/../bar')).toThrow('path traversal');
    });

    it('should reject forward slashes', () => {
      expect(() => validateName('foo/bar')).toThrow('path traversal');
    });

    it('should reject backslashes', () => {
      expect(() => validateName('foo\\bar')).toThrow('path traversal');
    });

    it('should reject null bytes', () => {
      expect(() => validateName('foo\0bar')).toThrow('path traversal');
    });

    it('should reject empty names', () => {
      expect(() => validateName('')).toThrow('must be 1-100 characters');
    });

    it('should reject names over 100 characters', () => {
      const longName = 'a'.repeat(101);
      expect(() => validateName(longName)).toThrow('must be 1-100 characters');
    });
  });

  describe('CacheService', () => {
    describe('set', () => {
      it('should store prompt with hash key', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'cached prompt content');

        const cached = await cacheService.get('commands', 'plan', 'user_123');
        expect(cached).toBe('cached prompt content');
      });

      it('should create cache directory if not exists', async () => {
        const newDir = join(testDir, 'new-cache');
        const newCache = new CacheService(newDir);

        await newCache.set('commands', 'plan', 'user_123', 'content');
        expect(existsSync(newDir)).toBe(true);
      });
    });

    describe('get', () => {
      it('should retrieve stored prompt', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'my prompt');
        const result = await cacheService.get('commands', 'plan', 'user_123');
        expect(result).toBe('my prompt');
      });

      it('should return null for missing entries', async () => {
        const result = await cacheService.get('commands', 'nonexistent', 'user_123');
        expect(result).toBeNull();
      });

      it('should return null for expired entries', async () => {
        // Set with a very short TTL (0)
        await cacheService.set('commands', 'plan', 'user_123', 'content', 0);

        // Wait a bit for expiry
        await new Promise(resolve => setTimeout(resolve, 10));

        const result = await cacheService.get('commands', 'plan', 'user_123');
        expect(result).toBeNull();
      });

      it('should respect TTL (default 1 hour)', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'content');

        // Should be valid immediately
        const result = await cacheService.get('commands', 'plan', 'user_123');
        expect(result).toBe('content');
      });
    });

    describe('clear', () => {
      it('should remove specific cache entry', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'content1');
        await cacheService.set('commands', 'build', 'user_123', 'content2');

        await cacheService.clear('commands', 'plan', 'user_123');

        expect(await cacheService.get('commands', 'plan', 'user_123')).toBeNull();
        expect(await cacheService.get('commands', 'build', 'user_123')).toBe('content2');
      });
    });

    describe('clearAll', () => {
      it('should remove all cached prompts', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'content1');
        await cacheService.set('commands', 'build', 'user_123', 'content2');

        await cacheService.clearAll();

        expect(await cacheService.get('commands', 'plan', 'user_123')).toBeNull();
        expect(await cacheService.get('commands', 'build', 'user_123')).toBeNull();
      });
    });

    describe('has', () => {
      it('should return true for existing valid entry', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'content');
        expect(await cacheService.has('commands', 'plan', 'user_123')).toBe(true);
      });

      it('should return false for missing entry', async () => {
        expect(await cacheService.has('commands', 'missing', 'user_123')).toBe(false);
      });

      it('should return false for expired entry', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'content', 0);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(await cacheService.has('commands', 'plan', 'user_123')).toBe(false);
      });
    });

    describe('getStats', () => {
      it('should return cache statistics', async () => {
        await cacheService.set('commands', 'plan', 'user_123', 'content1');
        await cacheService.set('commands', 'build', 'user_123', 'content2');

        const stats = await cacheService.getStats();
        expect(stats.entries).toBe(2);
        expect(stats.totalBytes).toBeGreaterThan(0);
      });

      it('should report zero entries for empty cache', async () => {
        const stats = await cacheService.getStats();
        expect(stats.entries).toBe(0);
        expect(stats.totalBytes).toBe(0);
      });
    });
  });
});
