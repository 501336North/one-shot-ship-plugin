/**
 * @behavior Prompt cache service with disk caching disabled by default for security
 * @acceptance-criteria Caching disabled returns null, clearCache still works
 * @business-rule Decrypted prompts must not persist on disk after API key revocation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock the module before importing
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('PromptCache Service', () => {
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCachedPrompt (caching disabled by default)', () => {
    it('should return null when caching is disabled (default)', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        content: '# Build Command\nThis is the prompt content.',
        version: '1.4.0',
        cachedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      }));

      const cache = new PromptCache();
      const result = cache.getCachedPrompt('commands', 'build');

      // SECURITY: Caching is disabled by default, always returns null
      expect(result).toBeNull();
    });

    it('should return null when cache file does not exist', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(false);

      const cache = new PromptCache();
      const result = cache.getCachedPrompt('commands', 'build');

      expect(result).toBeNull();
    });
  });

  describe('setCachedPrompt (caching disabled by default)', () => {
    it('should be a no-op when caching is disabled', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(true);

      const cache = new PromptCache('1.4.0');
      cache.setCachedPrompt('commands', 'build', '# Build Command\nContent here.');

      // SECURITY: No disk writes when caching is disabled
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should not create cache directory when caching is disabled', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(false);

      const cache = new PromptCache();
      cache.setCachedPrompt('agents', 'code-reviewer', '# Code Reviewer');

      // SECURITY: No directory creation when caching is disabled
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('clearCache', () => {
    it('should remove all cached prompts', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      const rmSync = vi.spyOn(fs, 'rmSync').mockReturnValue(undefined);
      mockFs.existsSync.mockReturnValue(true);

      const cache = new PromptCache();
      cache.clearCache();

      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('.oss'),
        { recursive: true, force: true }
      );
    });
  });

  describe('performance', () => {
    it('should return null in under 10ms when caching is disabled', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');

      const cache = new PromptCache('1.4.0');

      const start = performance.now();
      const result = cache.getCachedPrompt('commands', 'build');
      const duration = performance.now() - start;

      expect(result).toBeNull();
      expect(duration).toBeLessThan(10); // Must be under 10ms
    });
  });
});
