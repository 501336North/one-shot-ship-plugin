/**
 * @behavior Decrypt flow integrates manifest verification and watermark stripping
 * @acceptance-criteria Verify prompt after decrypt; a mismatch or a prompt absent from the manifest is not verified (FR3)
 * @boundary CLI Integration
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { verifyDecryptedPrompt } from '../src/integrity-pipeline.js';
import type { SignedManifest } from '../src/manifest-verifier.js';

const PUBLIC_KEY = (() => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return publicKey.toString('base64');
})();

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function createManifest(prompts: Record<string, { hash: string; size: number }>, privKey?: string): SignedManifest {
  const keypair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const sortedKeys = Object.keys(prompts).sort();
  const sorted: Record<string, { hash: string; size: number }> = {};
  for (const key of sortedKeys) sorted[key] = prompts[key];
  const data = JSON.stringify({
    version: 1,
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts: sorted,
  });
  const sig = crypto.sign(null, Buffer.from(data), crypto.createPrivateKey({
    key: privKey ? Buffer.from(privKey, 'base64') : keypair.privateKey,
    format: 'der',
    type: 'pkcs8',
  }));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts,
    signature: sig.toString('base64'),
  };
}

describe('Decrypt Integrity Pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass when watermark-stripped content matches manifest hash', async () => {
    const rawContent = '# Plan\nOriginal.';
    // Simulate watermarked version (Greek omicron in "fοllow")
    const watermarked = rawContent + ' fοllow the rules';
    const expectedRaw = rawContent + ' follow the rules';
    const manifest = createManifest({
      'commands/plan': { hash: sha256(expectedRaw), size: Buffer.byteLength(expectedRaw) },
    });

    const result = await verifyDecryptedPrompt(watermarked, 'commands', 'plan', manifest);

    expect(result.verified).toBe(true);
    expect(result.status).toBe('match');
  });

  it('should fail when content does not match manifest hash after stripping', async () => {
    const manifest = createManifest({
      'commands/plan': { hash: sha256('original content'), size: 16 },
    });

    const result = await verifyDecryptedPrompt('tampered content', 'commands', 'plan', manifest);

    expect(result.verified).toBe(false);
    expect(result.status).toBe('mismatch');
  });

  // FR3: fail closed. A prompt the signed manifest does not list is NOT verified.
  it('should not verify a prompt whose key is not in the manifest', async () => {
    const manifest = createManifest({
      'commands/build': { hash: sha256('build content'), size: 13 },
    });

    const result = await verifyDecryptedPrompt('plan content', 'commands', 'plan', manifest);

    expect(result.verified).toBe(false);
    expect(result.status).toBe('not_in_manifest');
  });

  it('should handle watermarked content with all three homoglyph types', async () => {
    const raw = 'follow the code, must pass test';
    const watermarked = 'fοllow the cοde, muѕt pass tеst';
    const manifest = createManifest({
      'commands/plan': { hash: sha256(raw), size: Buffer.byteLength(raw) },
    });

    const result = await verifyDecryptedPrompt(watermarked, 'commands', 'plan', manifest);

    expect(result.verified).toBe(true);
  });
});
