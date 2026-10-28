/**
 * @behavior A loopback apiUrl (http://localhost, 127.0.0.1, [::1]) is trusted only when config.json and the
 *           directory holding it are writable by the user alone. Otherwise a group member who can write the config
 *           (umask 002) could point the API key at a listener of their own on the same machine, so oss-decrypt
 *           refuses the address and never sends the key. The production and staging addresses are unaffected: a
 *           group-writable config pointing at them is still trusted.
 * @business-rule SR2 (release-channels ship round 2): one loopback-privacy rule, shared by the shell, the watcher
 *           and this CLI.
 * @boundary config.json and its directory on the real file system; fetch is the network boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getTrustedApiOrigin } from '../src/manifest-keys.js';
import { setupCommand } from '../src/commands/setup.js';

const LOOPBACK = 'http://127.0.0.1:3000';
const PRODUCTION = 'https://one-shot-ship-api.onrender.com';

describe('loopback apiUrl needs a config only the user can write', () => {
  let root: string;
  let dir: string;
  const fetchMock = vi.fn<typeof fetch>();

  function writeConfig(apiUrl: string, fileMode: number, dirMode: number): void {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ apiKey: 'ak_test', apiUrl }));
    chmodSync(path, fileMode);
    chmodSync(dir, dirMode);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oss-loopback-privacy-'));
    dir = join(root, 'oss');
    mkdirSync(dir, { mode: 0o700 });
    process.env.OSS_CONFIG_DIR = dir;
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env.OSS_CONFIG_DIR;
    chmodSync(dir, 0o700);
    rmSync(root, { recursive: true, force: true });
  });

  it('loopback with a group-writable (0664) config is refused and the key is never sent', async () => {
    writeConfig(LOOPBACK, 0o664, 0o700);
    expect(() => getTrustedApiOrigin()).toThrow(/apiUrl/);
    await expect(setupCommand()).rejects.toThrow(/apiUrl/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loopback with a private (0600) config in a group-writable (0775) directory is refused', async () => {
    writeConfig(LOOPBACK, 0o600, 0o775);
    expect(() => getTrustedApiOrigin()).toThrow(/apiUrl/);
    await expect(setupCommand()).rejects.toThrow(/apiUrl/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loopback with a private (0600) config in a private (0700) directory is trusted', () => {
    writeConfig(LOOPBACK, 0o600, 0o700);
    expect(getTrustedApiOrigin()).toBe(LOOPBACK);
  });

  it('production with a group-writable (0664) config in a group-writable directory is still trusted', () => {
    writeConfig(PRODUCTION, 0o664, 0o775);
    expect(getTrustedApiOrigin()).toBe(PRODUCTION);
  });
});
