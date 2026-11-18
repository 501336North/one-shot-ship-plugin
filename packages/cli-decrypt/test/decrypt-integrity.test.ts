/**
 * @behavior Decrypt flow integrates manifest verification and watermark stripping
 * @acceptance-criteria Verify prompt after decrypt, warn on mismatch, skip gracefully when no manifest
 * @boundary CLI Integration
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { verifyDecryptedPrompt } from '../src/integrity-pipeline.js';
import { stripWatermark } from '../src/watermark.js';
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

type Entry = { hash: string; size: number; servedHash?: string };

function createManifest(prompts: Record<string, Entry>, privKey?: string): SignedManifest {
  const keypair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const sortedKeys = Object.keys(prompts).sort();
  const sorted: Record<string, Entry> = {};
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

  // R-273 P1 (D5, D10): the genuine watermarked body now verifies through servedHash.
  it('should pass when the served watermarked body matches servedHash', async () => {
    const rawContent = '# Plan\nOriginal.';
    // Simulate watermarked version (Greek omicron in "fοllow")
    const watermarked = rawContent + ' fοllow the rules';
    const expectedRaw = rawContent + ' follow the rules';
    const manifest = createManifest({
      'commands/plan': {
        hash: sha256(expectedRaw),
        size: Buffer.byteLength(expectedRaw),
        servedHash: sha256(watermarked),
      },
    });

    const result = await verifyDecryptedPrompt(watermarked, 'commands', 'plan', manifest);

    expect(result.verified).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it('should fail when content does not match manifest hash after stripping', async () => {
    const manifest = createManifest({
      'commands/plan': { hash: sha256('original content'), size: 16 },
    });

    const result = await verifyDecryptedPrompt('tampered content', 'commands', 'plan', manifest);

    expect(result.verified).toBe(false);
    expect(result.skipped).toBe(false);
  });

  // R-273 P1 (D5 default-deny): a null manifest is blocked, not skipped.
  it('blocks a null manifest', async () => {
    const result = await verifyDecryptedPrompt('any content', 'commands', 'plan', null);

    expect(result.verified).toBe(false);
    expect(result.skipped).toBe(false);
  });

  // R-273 P1 (D5; DESIGN "File-backed name with no manifest entry → blocked").
  it('blocks a prompt whose key is not in the manifest', async () => {
    const manifest = createManifest({
      'commands/build': { hash: sha256('build content'), size: 13 },
    });

    const result = await verifyDecryptedPrompt('plan content', 'commands', 'plan', manifest);

    expect(result).toEqual({ verified: false, skipped: false, reason: 'not_in_manifest' });
  });

  it('should handle watermarked content with all three homoglyph types', async () => {
    const raw = 'follow the code, must pass test';
    const watermarked = 'fοllow the cοde, muѕt pass tеst';
    const manifest = createManifest({
      'commands/plan': { hash: sha256(raw), size: Buffer.byteLength(raw), servedHash: sha256(watermarked) },
    });

    const result = await verifyDecryptedPrompt(watermarked, 'commands', 'plan', manifest);

    expect(result.verified).toBe(true);
  });

  /**
   * @behavior A prompt is delivered only when its exact served bytes match the signed manifest
   * @business-rule R-273 D4/D5/D10: default-deny; servedHash is sha256 of the unstripped plaintext
   */
  describe('served-bytes check, default-deny (R-273 P1)', () => {
    const body = '# Plan\nRun the tests.\n```bash\nnpm test\n```\nfοllow the rules\n';

    it.each(['workflows', 'commands', 'skills', 'agents', 'hooks', 'prompts', 'templates'])(
      'blocks any non-custom type whose key is not in the manifest: %s',
      async (type) => {
        const manifest = createManifest({
          'commands/other': { hash: sha256('x'), size: 1, servedHash: sha256('x') },
        });

        const result = await verifyDecryptedPrompt(body, type, 'plan', manifest);

        expect(result).toEqual({ verified: false, skipped: false, reason: 'not_in_manifest' });
      }
    );

    it('verifies when sha256(plaintext) equals servedHash, with the plaintext not stripped', async () => {
      const manifest = createManifest({
        'workflows/plan': { hash: 'not-the-stripped-hash', size: 1, servedHash: sha256(body) },
      });

      const result = await verifyDecryptedPrompt(body, 'workflows', 'plan', manifest);

      expect(result).toEqual({ verified: true, skipped: false });
    });

    it('blocks a body with one lookalike letter swapped inside a code fence', async () => {
      const tampered = body.replace('npm test', 'npm tеst'); // Cyrillic ie inside the fence
      expect(stripWatermark(tampered)).toBe(stripWatermark(body));
      const manifest = createManifest({
        'workflows/plan': {
          hash: sha256(stripWatermark(body)),
          size: Buffer.byteLength(body),
          servedHash: sha256(body),
        },
      });

      const result = await verifyDecryptedPrompt(tampered, 'workflows', 'plan', manifest);

      expect(result.verified).toBe(false);
    });

    it('blocks an entry that has no servedHash (a pre-R-273 manifest)', async () => {
      const manifest = createManifest({
        'workflows/plan': { hash: sha256(stripWatermark(body)), size: Buffer.byteLength(body) },
      });

      const result = await verifyDecryptedPrompt(body, 'workflows', 'plan', manifest);

      expect(result.verified).toBe(false);
    });

    it('looks keys up as own properties only (a __proto__ key gives no inherited entry)', async () => {
      const parsed = JSON.parse(
        `{"__proto__": {"workflows/plan": {"hash": "h", "size": 1, "servedHash": "${sha256(body)}"}}}`
      ) as Record<string, Entry>;
      const prompts: Record<string, Entry> = Object.assign({}, parsed);
      expect(prompts['workflows/plan']?.servedHash).toBe(sha256(body)); // inherited, not own
      const manifest: SignedManifest = { ...createManifest({}), prompts };

      const result = await verifyDecryptedPrompt(body, 'workflows', 'plan', manifest);

      expect(result).toEqual({ verified: false, skipped: false, reason: 'not_in_manifest' });
    });

    it('looks keys up as own properties only (an inherited prototype entry is not an entry)', async () => {
      const inherited: Record<string, Entry> = Object.create({
        'workflows/plan': { hash: 'h', size: 1, servedHash: sha256(body) },
      }) as Record<string, Entry>;
      const manifest: SignedManifest = { ...createManifest({}), prompts: inherited };

      const result = await verifyDecryptedPrompt(body, 'workflows', 'plan', manifest);

      expect(result).toEqual({ verified: false, skipped: false, reason: 'not_in_manifest' });
    });
  });
});
