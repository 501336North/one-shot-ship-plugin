/**
 * @behavior Every command that talks to the API reads apiUrl the same way, and refuses an apiUrl
 *   that would send the API key in cleartext or to a different path than the endpoint.
 * @business-rule The Bearer key only ever goes over https (plain http only to this machine), and
 *   only to the API path we built; one config dir rule (OSS_CONFIG_DIR or ~/.oss) for all commands.
 * @boundary CLI commands (setup, decrypt, --verify-manifest) with fetch as the external boundary
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { setupCommand } from '../src/commands/setup.js';
import { decryptCommand } from '../src/commands/decrypt.js';
import { runCli } from '../src/cli-entry.js';
import * as storage from '../src/storage.js';
import * as hardware from '../src/hardware.js';

vi.mock('../src/storage.js');
vi.mock('../src/hardware.js');

const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';

describe('apiUrl has one source and is checked before the key is sent', () => {
  let testDir: string;
  const fetchMock = vi.fn<typeof fetch>();

  function writeConfig(config: Record<string, string>): void {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({ apiKey: 'ak_test', ...config }));
  }

  function fetchedUrls(): string[] {
    return fetchMock.mock.calls.map(([input]) => String(input));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    testDir = join(tmpdir(), `oss-decrypt-apiurl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.OSS_CONFIG_DIR = testDir;
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(hardware.getHardwareId).mockReturnValue('hw_test');
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

  describe('plain http to another host is refused', () => {
    it('setup refuses http:// before any request', async () => {
      writeConfig({ apiUrl: 'http://api.example.com' });
      await expect(setupCommand()).rejects.toThrow(/https/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('decrypt refuses http:// before any request', async () => {
      writeConfig({ apiUrl: 'http://api.example.com' });
      await expect(decryptCommand('commands', 'plan')).rejects.toThrow(/https/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // decrypt on loopback needs the staging signing key (ADR-005); untrusted-address-refused.test.ts
    // covers it. setup sends no manifest-verified request, so it still shows loopback http is allowed.
    it.each(['http://127.0.0.1:4100', 'http://localhost:4100'])(
      'plain http to this machine (%s) is allowed',
      async (apiUrl) => {
        writeConfig({ apiUrl });
        await setupCommand().catch(() => undefined);
        const urls = fetchedUrls();
        expect(urls.length).toBeGreaterThanOrEqual(1);
        for (const url of urls) {
          expect(url.startsWith(`${apiUrl}/api/v1/`)).toBe(true);
        }
      }
    );
  });

  describe('an apiUrl that would move the endpoint path is refused', () => {
    it.each(['https://api.example.com/?x=', 'https://api.example.com/#', 'not a url'])(
      'refuses %s before any request',
      async (apiUrl) => {
        writeConfig({ apiUrl });
        await expect(setupCommand()).rejects.toThrow(/apiUrl/);
        await expect(decryptCommand('commands', 'plan')).rejects.toThrow(/apiUrl/);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it('the refusal does not print the config contents', async () => {
      writeConfig({ apiUrl: 'http://api.example.com/secret-path' });
      const err: unknown = await setupCommand().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toMatch(/https/);
      expect(message).not.toContain('ak_test');
      expect(message).not.toContain('secret-path');
    });
  });

  // An address with no signing key is refused by both (ADR-005). Had --verify-manifest read apiUrl from
  // anywhere else it would fall back to the default API and fetch its manifest.
  it('with OSS_CONFIG_DIR set, --verify-manifest uses the same apiUrl as decrypt', async () => {
    writeConfig({ apiUrl: 'https://custom-api.example.com' });
    await expect(decryptCommand('commands', 'plan')).rejects.toThrow(/apiUrl/);
    await expect(runCli(['--verify-manifest'])).rejects.toThrow(/apiUrl/);
    expect(fetchedUrls()).toEqual([]);
  });

  // FR4: --list-prompts follows the same trusted-address rule as decrypt (a custom host is refused).
  it('with OSS_CONFIG_DIR set, --list-prompts uses the same apiUrl', async () => {
    writeConfig({ apiUrl: 'https://one-shot-ship-api-staging.onrender.com' });
    await runCli(['--list-prompts']);
    expect(fetchedUrls()).toEqual(['https://one-shot-ship-api-staging.onrender.com/api/v1/prompts/manifest']);
  });

  it('no apiUrl in config means the default API for every command', async () => {
    writeConfig({});
    await setupCommand().catch(() => undefined);
    await decryptCommand('commands', 'plan').catch(() => undefined);
    await runCli(['--verify-manifest']);
    process.exitCode = undefined;
    const urls = fetchedUrls();
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const url of urls) {
      expect(url.startsWith(`${DEFAULT_API_URL}/api/v1/`)).toBe(true);
    }
  });
});
