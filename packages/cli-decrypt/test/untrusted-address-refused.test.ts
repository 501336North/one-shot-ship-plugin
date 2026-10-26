/**
 * @behavior oss-decrypt refuses to fetch any prompt, or the manifest it would verify, from an API
 *           address it holds no signing key for. The refusal happens before the first request, so the
 *           user's API key never reaches that server.
 * @acceptance-criteria AC-004.x (release-channels, Task 10)
 * @business-rule ADR-005 decision 1: unknown address -> refuse, naming apiUrl; staging/loopback -> the pinned
 *                staging key (Task 11). Never prompts against an unverifiable manifest.
 * @boundary decryptCommand and `oss-decrypt --verify-manifest`, with fetch (network) and the credential
 *           store as the external boundaries
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { decryptCommand } from '../src/commands/decrypt.js';
import { runCli } from '../src/cli-entry.js';
import { STAGING_API_URL } from '../src/manifest-keys.js';
import * as storage from '../src/storage.js';

vi.mock('../src/storage.js');

describe('an address without a signing key is refused before any request', () => {
  let testDir: string;
  const fetchMock = vi.fn<typeof fetch>();

  function useApiUrl(apiUrl: string): void {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({ apiKey: 'ak_test', apiUrl }));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    testDir = join(tmpdir(), `oss-decrypt-untrusted-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.OSS_CONFIG_DIR = testDir;
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(storage.retrieveCredentials).mockResolvedValue({
      apiKey: 'ak_test',
      userId: 'user_1',
      hardwareId: 'hw_test',
      salt: 'salt',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OSS_CONFIG_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it.each(['commands', 'custom'] as const)(
    'decrypt (%s) refuses an unknown https apiUrl without asking for the prompt',
    async (type) => {
      useApiUrl('https://api.example.com');
      await expect(decryptCommand(type, 'plan')).rejects.toThrow(/apiUrl/);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('decrypt refuses a look-alike of the production host without asking for the prompt', async () => {
    useApiUrl('https://one-shot-ship-api.onrender.com.evil.com');
    await expect(decryptCommand('commands', 'plan')).rejects.toThrow(/apiUrl/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([STAGING_API_URL, 'http://localhost:4100', 'http://127.0.0.1', 'http://[::1]:4100'])(
    'decrypt asks %s for the prompt, now that this build pins the staging key',
    async (apiUrl) => {
      useApiUrl(apiUrl);
      await decryptCommand('commands', 'plan').catch(() => undefined);
      expect(fetchMock).toHaveBeenCalled();
      expect(String(fetchMock.mock.calls[0][0])).toContain(new URL(apiUrl).host);
    }
  );

  it('decrypt still asks the production API for the prompt', async () => {
    useApiUrl('https://one-shot-ship-api.onrender.com');
    await decryptCommand('commands', 'plan').catch(() => undefined);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('--verify-manifest refuses an unknown https apiUrl without fetching the manifest', async () => {
    useApiUrl('https://api.example.com');
    await expect(runCli(['--verify-manifest'])).rejects.toThrow(/apiUrl/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('--verify-manifest fetches the staging manifest, now that this build pins the staging key', async () => {
    useApiUrl(STAGING_API_URL);
    await runCli(['--verify-manifest']).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain(new URL(STAGING_API_URL).host);
  });
});
