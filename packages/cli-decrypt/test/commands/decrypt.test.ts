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
import crypto from 'crypto';

import { decryptCommand } from '../../src/commands/decrypt.js';
import * as apiClient from '../../src/api-client.js';
import * as storage from '../../src/storage.js';
import * as encryption from '../../src/encryption.js';
import * as manifestVerifier from '../../src/manifest-verifier.js';
import * as integrityPipeline from '../../src/integrity-pipeline.js';

// Mock modules
vi.mock('../../src/api-client.js');
vi.mock('../../src/storage.js');
vi.mock('../../src/encryption.js');
vi.mock('../../src/manifest-verifier.js');
vi.mock('../../src/integrity-pipeline.js');

describe('Decrypt Command', () => {
  const testDir = join(tmpdir(), 'oss-decrypt-decrypt-test-' + Date.now());
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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

    // Default: manifest fetch succeeds, signature valid, hash matches
    vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue({
      version: 1,
      generatedAt: new Date().toISOString(),
      algorithm: 'sha256',
      signing: 'ed25519',
      prompts: {},
      signature: 'valid-sig',
    });
    vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);
    vi.mocked(integrityPipeline.verifyDecryptedPrompt).mockResolvedValue({
      verified: true,
      skipped: false,
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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

    it('should NOT output prompt when manifest signature verification fails', async () => {
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(consoleSpy).not.toHaveBeenCalledWith('Decrypted prompt content!');
    });

    it('should NOT output prompt when prompt hash does not match manifest', async () => {
      vi.mocked(integrityPipeline.verifyDecryptedPrompt).mockResolvedValue({
        verified: false,
        skipped: false,
      });

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(consoleSpy).not.toHaveBeenCalledWith('Decrypted prompt content!');
    });

    it('should output prompt when verification passes', async () => {
      await decryptCommand('commands', 'plan');

      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
    });

    // R-273 P1 (D5 default-deny; P3 adds the retry and its final message): an unreachable manifest blocks.
    it('should NOT output prompt when manifest is unavailable', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(null);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(consoleSpy).not.toHaveBeenCalledWith('Decrypted prompt content!');
    });

    it('should output verification status messages to stderr', async () => {
      await decryptCommand('commands', 'plan');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[verify]'));
    });

    it('should show success message when verification passes', async () => {
      await decryptCommand('commands', 'plan');

      const calls = consoleErrorSpy.mock.calls.map(c => c[0]);
      expect(calls.some((msg: string) => msg.includes('valid') || msg.includes('verified'))).toBe(true);
    });

    it('should show failure message before throwing on signature failure', async () => {
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
    });

    // R-273 P1 (D5 default-deny; P3 adds the retry and its final message).
    it('should show a blocked message when manifest unavailable', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(null);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('prompt blocked'));
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('skipping'));
    });
  });

  /**
   * @behavior The decrypt command delivers a prompt only when the real integrity pipeline verifies it
   * @business-rule R-273 D4/D5: default-deny; a file-backed name with no manifest entry is blocked
   * @boundary CLI Commands (only the manifest fetch and signature check are stubbed)
   */
  describe('real integrity pipeline (R-273 P1)', () => {
    const body = 'Workflow plan body, fοllow the rules\n';
    const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

    beforeEach(async () => {
      const actual = await vi.importActual<typeof integrityPipeline>('../../src/integrity-pipeline.js');
      vi.mocked(integrityPipeline.verifyDecryptedPrompt).mockImplementation(actual.verifyDecryptedPrompt);
      vi.mocked(encryption.decrypt).mockReturnValue(body);
    });

    function manifestWith(prompts: manifestVerifier.SignedManifest['prompts']): manifestVerifier.SignedManifest {
      return {
        version: 1,
        generatedAt: new Date().toISOString(),
        algorithm: 'sha256',
        signing: 'ed25519',
        prompts,
        signature: 'valid-sig',
      };
    }

    it('prints "[verify] No manifest entry for workflows/plan — prompt blocked", prints no prompt, and rejects', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(
        manifestWith({ 'workflows/build': { hash: 'h', size: 1, servedHash: sha256('other') } })
      );

      await expect(decryptCommand('workflows', 'plan')).rejects.toThrow('[SECURITY]');

      const stderr = consoleErrorSpy.mock.calls.map(c => String(c[0]));
      const entryIdx = stderr.indexOf('[verify] No manifest entry for workflows/plan — prompt blocked');
      expect(entryIdx).toBeGreaterThanOrEqual(0);
      const hashFailIdx = stderr.findIndex(m => m.includes('Prompt hash: FAILED'));
      if (hashFailIdx >= 0) expect(entryIdx).toBeLessThan(hashFailIdx);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('prints "[verify] Prompt hash: verified" and the prompt for a matching servedHash', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(
        manifestWith({ 'workflows/plan': { hash: 'stripped', size: 1, servedHash: sha256(body) } })
      );

      await decryptCommand('workflows', 'plan');

      expect(consoleErrorSpy).toHaveBeenCalledWith('[verify] Prompt hash: verified');
      expect(consoleSpy).toHaveBeenCalledWith(body);
    });
  });
  /**
   * @behavior A team custom prompt is delivered as-is, labelled as outside the OSS manifest
   * @business-rule R-273 D6: team custom prompts are not verified and never claim to be
   * @boundary CLI Commands (only the custom-prompt fetch and the manifest fetch are stubbed)
   */
  describe('team custom prompts (R-273 P2)', () => {
    const customBody = 'Team custom prompt body';

    beforeEach(() => {
      vi.mocked(apiClient.fetchCustomPrompt).mockResolvedValue({
        prompt: customBody,
        name: 'team-review',
        displayName: 'Team Review',
        isBlocking: false,
      });
    });

    it('labels a custom prompt on stderr with "[verify] Team custom prompt — not covered by the OSS manifest"', async () => {
      await decryptCommand('custom', 'team-review');

      expect(consoleErrorSpy).toHaveBeenCalledWith('[verify] Team custom prompt — not covered by the OSS manifest');
    });

    it('prints only the custom prompt text on stdout', async () => {
      await decryptCommand('custom', 'team-review');

      expect(consoleSpy.mock.calls).toEqual([[customBody]]);
    });

    it('never fetches the manifest for a custom prompt', async () => {
      await decryptCommand('custom', 'team-review');

      expect(manifestVerifier.fetchManifest).not.toHaveBeenCalled();
    });

    it('never prints "Prompt hash: verified" for a custom prompt', async () => {
      await decryptCommand('custom', 'team-review');

      const output = [...consoleErrorSpy.mock.calls, ...consoleSpy.mock.calls].map(c => String(c[0]));
      expect(output.some(m => m.includes('Prompt hash: verified'))).toBe(false);
    });
  });
});
