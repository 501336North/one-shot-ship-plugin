/**
 * @behavior oss-decrypt reads ~/.oss/config.json (apiUrl, apiKey) only when it is a regular file owned by the user
 *           and not writable by everyone. A symlinked, foreign-owned or world-writable config is refused before any
 *           request, so another local user cannot point the CLI (and the API key) at their own server.
 *           A group-writable config (umask 002, mode 0664) is accepted.
 * @business-rule FR7 (release-channels ship round 1): one config-file trust rule, shared by the shell, the watcher
 *           and this CLI.
 * @boundary config.json on the real file system; process.getuid is stubbed only to impersonate another owner;
 *           fetch is the network boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getApiUrl } from '../src/config.js';
import { setupCommand } from '../src/commands/setup.js';

const STAGING = 'https://one-shot-ship-api-staging.onrender.com';

describe('config.json trust rule', () => {
  let dir: string;
  const fetchMock = vi.fn<typeof fetch>();

  function writeConfig(mode: number): string {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ apiKey: 'ak_test', apiUrl: STAGING }));
    chmodSync(path, mode);
    return path;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oss-config-trust-'));
    process.env.OSS_CONFIG_DIR = dir;
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    delete process.env.OSS_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([0o600, 0o644, 0o664])('a config with mode %o owned by the user is read', (mode) => {
    writeConfig(mode);
    expect(getApiUrl()).toBe(STAGING);
  });

  it('setup reads the API key from a group-writable (0664) config and sends it', async () => {
    writeConfig(0o664);
    await setupCommand().catch(() => undefined);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('a world-writable config is refused by every reader, before any request', async () => {
    writeConfig(0o666);
    expect(() => getApiUrl()).toThrow(/config\.json/);
    await expect(setupCommand()).rejects.toThrow(/config\.json/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a symlinked config is refused by every reader, before any request', async () => {
    const real = join(dir, 'elsewhere.json');
    writeFileSync(real, JSON.stringify({ apiKey: 'ak_test', apiUrl: STAGING }));
    chmodSync(real, 0o600);
    symlinkSync(real, join(dir, 'config.json'));
    expect(() => getApiUrl()).toThrow(/config\.json/);
    await expect(setupCommand()).rejects.toThrow(/config\.json/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a config owned by another user is refused by every reader, before any request', async () => {
    writeConfig(0o600);
    const me = process.getuid?.() ?? 0;
    vi.spyOn(process, 'getuid').mockReturnValue(me + 1);
    expect(() => getApiUrl()).toThrow(/config\.json/);
    await expect(setupCommand()).rejects.toThrow(/config\.json/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no config at all still means the default API', () => {
    expect(getApiUrl()).toBe('https://one-shot-ship-api.onrender.com');
  });
});
