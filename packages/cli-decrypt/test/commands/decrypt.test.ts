/**
 * @behavior Decrypt command fetches and decrypts prompts
 * @acceptance-criteria AC-DECRYPT-007
 * @business-rule DECRYPT-007
 * @boundary CLI Commands
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { decryptCommand } from '../../src/commands/decrypt.js';
import * as apiClient from '../../src/api-client.js';
import * as storage from '../../src/storage.js';
import * as encryption from '../../src/encryption.js';

// Mock modules
vi.mock('../../src/api-client.js');
vi.mock('../../src/storage.js');
vi.mock('../../src/encryption.js');

describe('Decrypt Command', () => {
  const testDir = join(tmpdir(), 'oss-decrypt-decrypt-test-' + Date.now());
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();

    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    process.env.OSS_CONFIG_DIR = testDir;

    // Capture stdout
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Default mocks
    vi.mocked(storage.retrieveCredentials).mockResolvedValue({
      apiKey: 'ak_test',
      userId: 'user_123',
      hardwareId: 'hw_xyz',
      salt: 'salt_abc',
    });
    vi.mocked(apiClient.fetchEncryptedPrompt).mockResolvedValue({
      encrypted: 'enc_data',
      iv: 'iv_data',
      authTag: 'tag_data',
    });
    vi.mocked(encryption.deriveKey).mockReturnValue(Buffer.alloc(32));
    vi.mocked(encryption.decrypt).mockReturnValue('Decrypted prompt content!');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.OSS_CONFIG_DIR;
  });

  describe('decryptCommand', () => {
    it('should output decrypted prompt to stdout', async () => {
      await decryptCommand('commands', 'plan');

      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
    });

    it('should fail if credentials not setup', async () => {
      vi.mocked(storage.retrieveCredentials).mockResolvedValue(null);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('setup');
    });

    it('should fail on invalid prompt name', async () => {
      vi.mocked(apiClient.fetchEncryptedPrompt).mockRejectedValue(
        new Error('Prompt not found')
      );

      await expect(decryptCommand('commands', 'nonexistent')).rejects.toThrow(
        'Prompt not found'
      );
    });

    it('should handle all prompt types', async () => {
      const types = ['commands', 'workflows', 'skills', 'agents'] as const;

      for (const type of types) {
        await decryptCommand(type, 'test-name');
        expect(apiClient.fetchEncryptedPrompt).toHaveBeenCalledWith(
          'ak_test',
          expect.any(String),
          type,
          'test-name'
        );
      }
    });

    /**
     * @behavior Decrypt checks cache before API call
     * @acceptance-criteria AC-CACHE-002
     * @boundary CLI
     */
    it('should always fetch from API since disk caching is disabled', async () => {
      // First call fetches from API
      await decryptCommand('commands', 'plan');
      vi.mocked(apiClient.fetchEncryptedPrompt).mockClear();

      // Second call should ALSO fetch from API (disk caching disabled for security)
      await decryptCommand('commands', 'plan');

      // API should be called on every invocation
      expect(apiClient.fetchEncryptedPrompt).toHaveBeenCalledTimes(1);
    });

    it('should bypass cache with noCache option', async () => {
      // First call populates cache
      await decryptCommand('commands', 'plan');
      vi.mocked(apiClient.fetchEncryptedPrompt).mockClear();

      // Second call with noCache should hit API
      await decryptCommand('commands', 'plan', false, { noCache: true });

      expect(apiClient.fetchEncryptedPrompt).toHaveBeenCalled();
    });
  });
});
