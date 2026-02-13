/**
 * @behavior Manifest verifier fetches and validates Ed25519-signed manifest
 * @acceptance-criteria Verify signature, detect tampering, handle fetch errors
 * @boundary CLI Verification
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  verifyManifestSignature,
  fetchManifest,
  type SignedManifest,
} from '../src/manifest-verifier.js';

function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64'),
  };
}

function createTestManifest(privateKey: string): SignedManifest {
  const prompts: Record<string, { hash: string; size: number }> = {
    'commands/plan': { hash: 'abc123', size: 100 },
    'commands/build': { hash: 'def456', size: 200 },
  };
  const sortedKeys = Object.keys(prompts).sort();
  const sortedPrompts: Record<string, { hash: string; size: number }> = {};
  for (const key of sortedKeys) {
    sortedPrompts[key] = prompts[key];
  }
  const data = JSON.stringify(sortedPrompts);
  const sig = crypto.sign(
    null,
    Buffer.from(data, 'utf8'),
    crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  );
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts,
    signature: sig.toString('base64'),
  };
}

describe('Manifest Signature Verifier', () => {
  it('should return true for a valid signed manifest', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);

    const result = verifyManifestSignature(manifest, keypair.publicKey);

    expect(result).toBe(true);
  });

  it('should return false when prompts have been tampered with', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);
    manifest.prompts['commands/plan'].hash = 'tampered';

    const result = verifyManifestSignature(manifest, keypair.publicKey);

    expect(result).toBe(false);
  });

  it('should return false when signature is from a different key', () => {
    const keypair1 = generateTestKeypair();
    const keypair2 = generateTestKeypair();
    const manifest = createTestManifest(keypair1.privateKey);

    const result = verifyManifestSignature(manifest, keypair2.publicKey);

    expect(result).toBe(false);
  });

  describe('fetchManifest', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch and parse manifest from API', async () => {
      const keypair = generateTestKeypair();
      const manifest = createTestManifest(keypair.privateKey);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(manifest), { status: 200 })
      );

      const result = await fetchManifest('https://api.example.com');

      expect(result).toEqual(manifest);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/prompts/manifest',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return null on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );

      const result = await fetchManifest('https://api.example.com');

      expect(result).toBeNull();
    });
  });
});
