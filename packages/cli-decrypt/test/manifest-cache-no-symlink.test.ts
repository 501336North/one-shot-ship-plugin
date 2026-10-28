/**
 * @behavior oss-decrypt caches the verified manifest under <config dir>/run, but never writes or changes permissions
 *           through a symlink: if run/ or the cache file is a symlink (or run/ belongs to another user), the cache is
 *           skipped and whatever the link points at is left untouched. The verified manifest is still served.
 * @business-rule SR4 (release-channels ship round 2): the manifest cache never writes through a symlink.
 * @boundary fetchVerifiedManifest against the real file system; fetch (the network) is stubbed with a manifest
 *           signed by a test key; process.getuid is stubbed only to impersonate another owner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { fetchVerifiedManifest } from '../src/verified-manifest.js';
import type { SignedManifest } from '../src/manifest-verifier.js';

const ORIGIN = 'http://127.0.0.1:4100';

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

describe('manifest cache never writes through a symlink', () => {
  let root: string;
  let configDir: string;
  let target: string;
  const { manifest, publicKey } = signedManifest();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oss-manifest-cache-link-'));
    configDir = join(root, 'oss');
    mkdirSync(configDir, { mode: 0o700 });
    target = join(root, 'victim');
    process.env.OSS_CONFIG_DIR = configDir;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OSS_CONFIG_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('a symlinked run directory: the target is neither chmodded nor written, the manifest is still served', async () => {
    mkdirSync(target);
    chmodSync(target, 0o755);
    symlinkSync(target, join(configDir, 'run'));

    await expect(fetchVerifiedManifest(ORIGIN, publicKey)).resolves.toEqual(manifest);

    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(readdirSync(target)).toEqual([]);
  });

  it('a symlinked cache file: the target keeps its content and mode, the manifest is still served', async () => {
    await fetchVerifiedManifest(ORIGIN, publicKey);
    const runDir = join(configDir, 'run');
    const [cacheName] = readdirSync(runDir);
    writeFileSync(target, 'original');
    chmodSync(target, 0o644);
    unlinkSync(join(runDir, cacheName));
    symlinkSync(target, join(runDir, cacheName));

    await expect(fetchVerifiedManifest(ORIGIN, publicKey)).resolves.toEqual(manifest);

    expect(readFileSync(target, 'utf8')).toBe('original');
    expect(statSync(target).mode & 0o777).toBe(0o644);
  });

  it('a run directory owned by another user is not cached into, the manifest is still served', async () => {
    const runDir = join(configDir, 'run');
    mkdirSync(runDir, { mode: 0o755 });
    const me = process.getuid?.() ?? 0;
    vi.spyOn(process, 'getuid').mockReturnValue(me + 1);

    await expect(fetchVerifiedManifest(ORIGIN, publicKey)).resolves.toEqual(manifest);

    expect(readdirSync(runDir)).toEqual([]);
    expect(statSync(runDir).mode & 0o777).toBe(0o755);
  });

  it('an ordinary run directory still gets an owner-only cache file', async () => {
    await fetchVerifiedManifest(ORIGIN, publicKey);
    const runDir = join(configDir, 'run');
    const files = readdirSync(runDir);
    expect(files).toHaveLength(1);
    expect(statSync(join(runDir, files[0])).mode & 0o777).toBe(0o600);
    expect(statSync(runDir).mode & 0o777).toBe(0o700);
  });

  it('an existing run directory of the user that others can read is tightened to owner-only', async () => {
    const runDir = join(configDir, 'run');
    mkdirSync(runDir);
    chmodSync(runDir, 0o755);
    await fetchVerifiedManifest(ORIGIN, publicKey);
    expect(statSync(runDir).mode & 0o777).toBe(0o700);
  });
});
