/**
 * @behavior Prompt cache reduces command startup latency
 * @acceptance-criteria Cache hit returns prompt in <10ms, cache miss fetches from API
 * @business-rule Cached prompts expire after 24 hours or on version change
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

  describe('getCachedPrompt', () => {
    it('should return null when cache file does not exist', async () => {
      // This test will fail until we implement PromptCache
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(false);

      const cache = new PromptCache();
      const result = cache.getCachedPrompt('commands', 'build');

      expect(result).toBeNull();
    });

    it('should return cached prompt when valid cache exists', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        content: '# Build Command\nThis is the prompt content.',
        version: '1.4.0',
        cachedAt: Date.now(),
        expiresAt: Date.now() + 86400000, // 24 hours
      }));

      const cache = new PromptCache();
      const result = cache.getCachedPrompt('commands', 'build');

      expect(result).toBe('# Build Command\nThis is the prompt content.');
    });

    it('should return null when cache is expired', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        content: '# Build Command',
        version: '1.4.0',
        cachedAt: Date.now() - 86400001, // More than 24 hours ago
        expiresAt: Date.now() - 1, // Already expired
      }));

      const cache = new PromptCache();
      const result = cache.getCachedPrompt('commands', 'build');

      expect(result).toBeNull();
    });

    it('should return null when cached version differs from current', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        content: '# Build Command',
        version: '1.3.0', // Old version
        cachedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      }));

      const cache = new PromptCache('1.4.0'); // Current version is different
      const result = cache.getCachedPrompt('commands', 'build');

      expect(result).toBeNull();
    });
  });

  describe('setCachedPrompt', () => {
    it('should write prompt to cache file', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const cache = new PromptCache('1.4.0');
      cache.setCachedPrompt('commands', 'build', '# Build Command\nContent here.');

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const callArgs = mockFs.writeFileSync.mock.calls[0];
      expect(callArgs[0]).toContain('commands');
      expect(callArgs[0]).toContain('build');

      const writtenData = JSON.parse(callArgs[1] as string);
      expect(writtenData.content).toBe('# Build Command\nContent here.');
      expect(writtenData.version).toBe('1.4.0');
    });

    it('should create cache directory if it does not exist', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const cache = new PromptCache();
      cache.setCachedPrompt('agents', 'code-reviewer', '# Code Reviewer');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
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
    it('should return cached prompt in under 10ms', async () => {
      const { PromptCache } = await import('../../src/services/prompt-cache');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        content: '# Fast Prompt',
        version: '1.4.0',
        cachedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      }));

      const cache = new PromptCache('1.4.0');

      const start = performance.now();
      cache.getCachedPrompt('commands', 'build');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10); // Must be under 10ms
    });
  });
});
