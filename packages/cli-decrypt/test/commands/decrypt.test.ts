/**
 * @behavior Decrypt command fetches and decrypts prompts
 * @acceptance-criteria AC-DECRYPT-007
 * @business-rule DECRYPT-007
 * @boundary CLI Commands
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
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

const MANIFEST_UNREACHABLE =
  '[SECURITY] Could not verify prompt: manifest unreachable — check your connection and run the command again';

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
      version: 1794940034,
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

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow(MANIFEST_UNREACHABLE);
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

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow(MANIFEST_UNREACHABLE);
      expect(consoleErrorSpy).toHaveBeenCalledWith(MANIFEST_UNREACHABLE);
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
        version: 1794940034,
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

  /**
   * @behavior A manifest that can't be reached gets one longer retry, then the prompt is blocked
   * @business-rule R-273 D7: first attempt 3 s, one retry 10 s; both failing blocks delivery (never fail-open)
   * @boundary CLI Commands (fetchManifest is the network boundary; it rejects when its signal aborts, like fetch)
   */
  describe('unreachable manifest retry (R-273 P3)', () => {
    const manifest: manifestVerifier.SignedManifest = {
      version: 1794940034,
      generatedAt: new Date().toISOString(),
      algorithm: 'sha256',
      signing: 'ed25519',
      prompts: {},
      signature: 'valid-sig',
    };

    function hangUntilAborted(_apiUrl: string, signal?: AbortSignal): Promise<manifestVerifier.SignedManifest | null> {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('verifies and prints the prompt when the first attempt fails and the retry succeeds', async () => {
      vi.useFakeTimers();
      vi.mocked(manifestVerifier.fetchManifest)
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce(manifest);

      const run = decryptCommand('commands', 'plan');
      await vi.advanceTimersByTimeAsync(3000);
      await run;

      expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[verify] Prompt hash: verified');
      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('blocks with the unreachable message when both attempts reject', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockRejectedValue(new Error('fetch failed'));

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow(MANIFEST_UNREACHABLE);
      expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(MANIFEST_UNREACHABLE);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('blocks with the unreachable message when both attempts return null', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(null);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow(MANIFEST_UNREACHABLE);
      expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(MANIFEST_UNREACHABLE);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    /**
     * @behavior A server that fails fast (HTTP 503 while it restarts) is given until 3 s before the retry
     * @business-rule R-273 ship round 2 (perf F1): the retry starts no earlier than 3 s after the first attempt
     *   started; the 3 s / 10 s budgets themselves are unchanged (ADR-002)
     */
    it('a server answering 503 for its first second: the retry waits until 3 s, then the prompt is verified', async () => {
      vi.useFakeTimers();
      const t0 = Date.now();
      const started: number[] = [];
      vi.mocked(manifestVerifier.fetchManifest).mockImplementation(async () => {
        started.push(Date.now());
        return Date.now() - t0 < 1000 ? null : manifest;
      });

      const run = decryptCommand('commands', 'plan');
      await vi.advanceTimersByTimeAsync(2999);
      expect(started).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await run;

      expect(started).toHaveLength(2);
      expect(started[1] - started[0]).toBeGreaterThanOrEqual(3000);
      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('the first attempt aborts at 3 s and the retry at 10 s', async () => {
      vi.useFakeTimers();
      vi.mocked(manifestVerifier.fetchManifest).mockImplementation(hangUntilAborted);

      const run = decryptCommand('commands', 'plan');
      const outcome = run.then(() => 'resolved', (err: unknown) => err);
      await vi.advanceTimersByTimeAsync(0);

      const signalOf = (call: number): AbortSignal | undefined =>
        vi.mocked(manifestVerifier.fetchManifest).mock.calls[call]?.[1];

      expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2900);
      expect(signalOf(0)?.aborted).toBe(false);
      expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(signalOf(0)?.aborted).toBe(true);

      expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(9900);
      expect(signalOf(1)?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(signalOf(1)?.aborted).toBe(true);

      const err = await outcome;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(MANIFEST_UNREACHABLE);
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
  /**
   * @behavior A prompt arrives sooner: the manifest is requested together with the prompt, not after it
   * @business-rule R-273 ship round 1: same verify-before-output order; only the manifest request starts earlier
   * @boundary CLI Commands (prompt and manifest fetches stubbed)
   */
  describe('manifest requested alongside the prompt', () => {
    it('the manifest request has started by the time the prompt request starts', async () => {
      let manifestRequestedFirst = false;
      vi.mocked(apiClient.fetchEncryptedPrompt).mockImplementation(async () => {
        manifestRequestedFirst = vi.mocked(manifestVerifier.fetchManifest).mock.calls.length > 0;
        return { encrypted: 'enc_data', iv: 'iv_data', authTag: 'tag_data' };
      });

      await decryptCommand('commands', 'plan');

      expect(manifestRequestedFirst).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
    });

    it('a failed prompt fetch is the error reported, and the early manifest failure is not an unhandled rejection', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        vi.mocked(manifestVerifier.fetchManifest).mockRejectedValue(new Error('fetch failed'));
        vi.mocked(apiClient.fetchEncryptedPrompt).mockRejectedValue(new Error('Unauthorized'));

        await expect(decryptCommand('commands', 'plan')).rejects.toThrow('Unauthorized');
        await new Promise(done => setTimeout(done, 50));

        expect(unhandled).toEqual([]);
        expect(consoleSpy).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('a failed prompt fetch stops the manifest request: no retry is sent after the command has failed', async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(null);
        vi.mocked(apiClient.fetchEncryptedPrompt).mockRejectedValue(new Error('Unauthorized'));

        await expect(decryptCommand('commands', 'plan')).rejects.toThrow('Unauthorized');
        await vi.advanceTimersByTimeAsync(20_000);

        expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('nothing reaches stdout until the manifest has been checked', async () => {
      let releaseManifest: (m: manifestVerifier.SignedManifest) => void = () => undefined;
      vi.mocked(manifestVerifier.fetchManifest).mockReturnValue(
        new Promise(done => {
          releaseManifest = done;
        })
      );

      const run = decryptCommand('commands', 'plan');
      await new Promise(done => setTimeout(done, 20));
      expect(consoleSpy).not.toHaveBeenCalled();

      releaseManifest({
        version: 1794940034,
        generatedAt: new Date().toISOString(),
        algorithm: 'sha256',
        signing: 'ed25519',
        prompts: {},
        signature: 'valid-sig',
      });
      await run;
      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
    });
  });

  /**
   * @behavior A prompt name cannot drive the terminal through the "No manifest entry" line
   * @business-rule R-273 ship round 1: text shown on stderr goes through stripControl
   */
  it('strips control characters from the name in the "No manifest entry" line', async () => {
    vi.mocked(integrityPipeline.verifyDecryptedPrompt).mockResolvedValue({
      verified: false,
      skipped: false,
      reason: 'not_in_manifest',
    });

    await expect(decryptCommand('commands', 'pl\u001b[2Jan\u202e')).rejects.toThrow('[SECURITY]');

    const lines = consoleErrorSpy.mock.calls.map(c => String(c[0]));
    expect(lines).toContain('[verify] No manifest entry for commands/pl[2Jan — prompt blocked');
    expect(lines.join('\n')).not.toMatch(/[\u001b\u202e]/);
  });

  /**
   * @behavior A signed manifest older than the newest one already accepted from the same API is refused
   * @business-rule R-273 D11 / ADR-007: anti-rollback floor in ~/.oss/manifest-floor.d/ (one folder per apiUrl,
   *   one empty file per recorded version),
   *   starting at the compiled live version, recorded only after the signature verifies
   * @boundary CLI Commands (manifest fetch and signature stubbed; the floor file is real, in a temp config dir)
   */
  describe('anti-rollback floor (R-273 P4)', () => {
    const LIVE = 1794940034;
    const API = 'https://one-shot-ship-api.onrender.com';
    const OLDER = '[SECURITY] Manifest is older than one already seen — prompt blocked';
    const storePath = (): string => join(testDir, 'manifest-floor.d');
    const keyDir = (configDir: string, api: string): string =>
      join(configDir, 'manifest-floor.d', crypto.createHash('sha256').update(api).digest('hex'));
    const seedFloor = (api: string, version: number): void => {
      mkdirSync(keyDir(testDir, api), { recursive: true, mode: 0o700 });
      writeFileSync(join(keyDir(testDir, api), String(version)), '');
    };
    const floorOf = (api: string, configDir = testDir): number | undefined =>
      existsSync(keyDir(configDir, api)) ? Math.max(...readdirSync(keyDir(configDir, api)).filter(n => /^[0-9]+$/.test(n)).map(Number)) : undefined;

    function serve(version: unknown, prompts: manifestVerifier.SignedManifest['prompts'] = {}): void {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue({
        version: version as number,
        generatedAt: new Date().toISOString(),
        algorithm: 'sha256',
        signing: 'ed25519',
        prompts,
        signature: 'valid-sig',
      });
    }

    const stderr = (): string[] => consoleErrorSpy.mock.calls.map(c => String(c[0]));

    it('blocks a manifest below the floor with the older-manifest message and prints no prompt', async () => {
      seedFloor(API, LIVE + 10);
      serve(LIVE + 5);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(stderr()).toContain(OLDER);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('accepts a newer manifest and records it as the floor', async () => {
      serve(LIVE + 10);

      await decryptCommand('commands', 'plan');

      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
      expect(floorOf(API)).toBe(LIVE + 10);
    });

    it('accepts an equal manifest without recording anything new', async () => {
      seedFloor(API, LIVE + 10);
      serve(LIVE + 10);

      await decryptCommand('commands', 'plan');

      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
      expect(readdirSync(keyDir(testDir, API))).toEqual([String(LIVE + 10)]);
    });

    it('blocks a bad signature with a higher version and leaves the floor unchanged', async () => {
      seedFloor(API, LIVE + 10);
      serve(LIVE + 1000);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(floorOf(API)).toBe(LIVE + 10);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('still refuses a lower version after update-state.json is re-initialised (check-updates first run)', async () => {
      serve(LIVE + 10);
      await decryptCommand('commands', 'plan');
      writeFileSync(
        join(testDir, 'update-state.json'),
        JSON.stringify({ lastPluginVersion: '', lastCheckedAt: '', manifestVersion: 0, manifestHashes: {}, promptSignatures: {} })
      );
      consoleSpy.mockClear();
      serve(LIVE + 5);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(stderr()).toContain(OLDER);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('names in the floor folder that are not a version fall back to the compiled floor: below it is refused', async () => {
      mkdirSync(keyDir(testDir, API), { recursive: true, mode: 0o700 });
      for (const junk of ['abc', `${LIVE + 99}.tmp`]) writeFileSync(join(keyDir(testDir, API), junk), '');
      serve(LIVE - 1);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(stderr()).toContain(OLDER);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('names in the floor folder that are not a version fall back to the compiled floor: above it is accepted', async () => {
      mkdirSync(keyDir(testDir, API), { recursive: true, mode: 0o700 });
      for (const junk of ['abc', `${LIVE + 99}.tmp`]) writeFileSync(join(keyDir(testDir, API), junk), '');
      serve(LIVE + 1);

      await decryptCommand('commands', 'plan');

      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
      expect(floorOf(API)).toBe(LIVE + 1);
    });

    it('parallel decrypts never leave the floor below an accepted version nor accept one below the floor', async () => {
      const versions = [5, 1, 9, 3, 7].map(d => LIVE + d);
      const fetchMock = vi.mocked(manifestVerifier.fetchManifest);
      for (const v of versions) {
        fetchMock.mockResolvedValueOnce({
          version: v,
          generatedAt: new Date().toISOString(),
          algorithm: 'sha256',
          signing: 'ed25519',
          prompts: {},
          signature: 'valid-sig',
        });
      }

      const results = await Promise.allSettled(versions.map(() => decryptCommand('commands', 'plan')));

      const accepted = versions.filter((_v, i) => results[i].status === 'fulfilled');
      const refused = versions.filter((_v, i) => results[i].status === 'rejected');
      expect(accepted.length).toBeGreaterThan(0);
      expect(floorOf(API)).toBe(Math.max(...accepted));
      expect(consoleSpy).toHaveBeenCalledTimes(accepted.length);
      for (const v of refused) expect(v).toBeLessThan(Math.max(...accepted));
      const firstAccepted = versions.findIndex((_v, i) => results[i].status === 'fulfilled');
      expect(versions[firstAccepted]).toBeGreaterThanOrEqual(LIVE);
    });

    it('delivers the prompt when the config dir does not exist yet and records the floor there', async () => {
      const absent = join(testDir, 'absent', '.oss');
      process.env.OSS_CONFIG_DIR = absent;
      serve(LIVE + 10);

      await decryptCommand('commands', 'plan');

      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
      expect(floorOf(API, absent)).toBe(LIVE + 10);
    });

    it('switching apiUrl does not block: another API has its own floor starting at the compiled value', async () => {
      seedFloor(API, LIVE + 1000);
      writeFileSync(join(testDir, 'config.json'), JSON.stringify({ apiUrl: 'https://sprint-d.example.com' }));
      serve(LIVE);

      await decryptCommand('commands', 'plan');

      expect(consoleSpy).toHaveBeenCalledWith('Decrypted prompt content!');
      expect(floorOf(API)).toBe(LIVE + 1000);
    });

    it('blocks a pre-R-273 manifest snapshot (version 1, no servedHash)', async () => {
      const actual = await vi.importActual<typeof integrityPipeline>('../../src/integrity-pipeline.js');
      vi.mocked(integrityPipeline.verifyDecryptedPrompt).mockImplementation(actual.verifyDecryptedPrompt);
      serve(1, { 'commands/plan': { hash: 'old-stripped-hash', size: 25 } });

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(stderr()).toContain(OLDER);
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(existsSync(storePath())).toBe(false);
    });

    it.each([
      ['missing', undefined],
      ['a fraction', 1794940034.5],
      ['a numeric string', '1794940099'],
      ['null', null],
    ])('blocks a manifest whose version is %s and prints no prompt', async (_label, version) => {
      serve(version);

      await expect(decryptCommand('commands', 'plan')).rejects.toThrow('[SECURITY]');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(existsSync(storePath())).toBe(false);
    });
  });

  /**
   * @behavior --debug output cannot drive the terminal either: the type and name it echoes are stripped
   * @business-rule R-273 ship round 2 (pen F8): every stderr line built from user or server text goes through stripControl
   * @boundary CLI Commands (stderr)
   */
  it.each([
    ['an encrypted prompt', 'commands', 'pl\u001b[2Jan‮'],
    ['a custom prompt', 'custom', 'de\u001b]8;;http://x\u0007ploy'],
  ])('--debug lines for %s carry no control characters', async (_label, type, name) => {
    vi.mocked(apiClient.fetchCustomPrompt).mockResolvedValue({
      prompt: 'custom text',
      name: 'deploy',
      displayName: 'Deploy',
      isBlocking: false,
    });

    await decryptCommand(type as 'commands' | 'custom', name, true).catch(() => undefined);

    const lines = consoleErrorSpy.mock.calls.map(c => String(c[0]));
    expect(lines.filter(line => line.includes('[FETCH]')).join(' ')).toMatch(/pl\[2Jan|ploy/);
    for (const line of lines) expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202e]/);
  });
});
