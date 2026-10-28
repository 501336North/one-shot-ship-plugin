/**
 * @behavior Release channels make ~/.oss a symlink to ~/.oss-stable, ~/.oss-beta or ~/.oss-dev
 *           (scripts/oss-channel.sh). oss-decrypt resolves the config directory itself once and writes there when the
 *           resolved directory is a real directory the user owns: setup stores credentials, and the prompt cache,
 *           manifest cache and update state are written into the channel directory. Everything inside the config
 *           directory stays no-follow: a symlinked run/ or prompt-cache/ inside it is still refused, and a config
 *           directory that resolves to another user's directory is refused.
 * @business-rule SR17 follow-up (release-channels ship round 2): the channel symlink is the one trusted link.
 * @boundary Real file system under a temp HOME; fetch (the network) is stubbed; process.getuid is stubbed only to
 *           impersonate another owner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

import { setupCommand } from '../src/commands/setup.js';
import { storeCredentials } from '../src/storage.js';
import { CacheService } from '../src/cache.js';
import { writeUpdateState } from '../src/update-state.js';
import { fetchVerifiedManifest } from '../src/verified-manifest.js';
import type { SignedManifest } from '../src/manifest-verifier.js';

const ORIGIN = 'https://one-shot-ship-api.onrender.com';
const STATE = {
  lastPluginVersion: '1.0.0',
  lastCheckedAt: '2026-10-27T00:00:00Z',
  manifestVersion: 1,
  manifestHashes: {},
  promptSignatures: {},
};

function signedManifest(): { manifest: SignedManifest; publicKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const prompts = { 'commands/build': { hash: 'abc123', size: 100 } };
  const data = JSON.stringify({ version: 1, algorithm: 'sha256', signing: 'ed25519', prompts });
  const signature = crypto.sign(
    null,
    Buffer.from(data, 'utf8'),
    crypto.createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' })
  );
  return {
    manifest: {
      version: 1,
      generatedAt: '2026-10-27T00:00:00Z',
      algorithm: 'sha256',
      signing: 'ed25519',
      prompts,
      signature: signature.toString('base64'),
    },
    publicKey: publicKey.toString('base64'),
  };
}

describe('the release-channel layout: ~/.oss is a symlink to the channel directory', () => {
  const realHome = process.env.HOME;
  const { manifest, publicKey } = signedManifest();
  let home: string;
  let beta: string;
  let link: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'oss-channel-home-'));
    process.env.HOME = home;
    delete process.env.OSS_CONFIG_DIR;
    // Never let this test reach the real ~/.oss.
    if (homedir() !== home) throw new Error('os.homedir() does not follow HOME; refusing to run');
    beta = join(home, '.oss-beta');
    mkdirSync(beta, { mode: 0o700 });
    link = join(home, '.oss');
    symlinkSync(beta, link);
    writeFileSync(join(beta, 'config.json'), JSON.stringify({ apiKey: 'ak_test' }), { mode: 0o600 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/api/v1/prompts/manifest')
          ? new Response(JSON.stringify(manifest), { status: 200 })
          : new Response(JSON.stringify({ userId: 'user_1', salt: 'salt', hardwareId: 'hw' }), { status: 200 })
      )
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('setup, the prompt cache, the manifest cache and the update state all write into the channel directory', async () => {
    await setupCommand();
    await new CacheService(join(link, 'prompt-cache')).set('commands', 'plan', 'user_1', '# Plan');
    await fetchVerifiedManifest(ORIGIN, publicKey);
    writeUpdateState(join(link, 'update-state.json'), STATE);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(beta, 'credentials.enc'))).toBe(true);
    expect(statSync(join(beta, 'credentials.enc')).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(beta, 'prompt-cache'))).toHaveLength(1);
    expect(readdirSync(join(beta, 'run'))).toHaveLength(1);
    expect(existsSync(join(beta, 'update-state.json'))).toBe(true);
  });

  it('a symlinked run/ or prompt-cache/ inside the channel directory is still refused', async () => {
    const victim = join(home, 'victim');
    mkdirSync(victim, { mode: 0o755 });
    symlinkSync(victim, join(beta, 'run'));
    symlinkSync(victim, join(beta, 'prompt-cache'));

    await expect(fetchVerifiedManifest(ORIGIN, publicKey)).resolves.toEqual(manifest);
    await expect(
      new CacheService(join(link, 'prompt-cache')).set('commands', 'plan', 'user_1', '# Plan')
    ).rejects.toThrow();

    expect(readdirSync(victim)).toEqual([]);
    expect(statSync(victim).mode & 0o777).toBe(0o755);
  });

  it("a config directory that resolves to another user's directory is refused", async () => {
    const me = process.getuid?.() ?? 0;
    vi.spyOn(process, 'getuid').mockReturnValue(me + 1);

    await expect(
      storeCredentials({ apiKey: 'ak_test', userId: 'user_1', hardwareId: 'hw', salt: 'salt' })
    ).rejects.toThrow();
    writeUpdateState(join(link, 'update-state.json'), STATE);

    expect(existsSync(join(beta, 'credentials.enc'))).toBe(false);
    expect(existsSync(join(beta, 'update-state.json'))).toBe(false);
  });
});
