/**
 * @behavior Post-decryption hash verifier checks prompt content matches manifest
 * @acceptance-criteria Hash match passes, hash mismatch fails, missing entry warns
 * @boundary CLI Verification
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyPromptHash, hashContent } from '../src/prompt-integrity.js';
import type { SignedManifest } from '../src/manifest-verifier.js';

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('Post-Decryption Hash Verification', () => {
  const manifest: SignedManifest = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    algorithm: 'sha256',
    signing: 'ed25519',
    signature: 'test-sig',
    prompts: {
      'commands/plan': { hash: sha256('# Plan\nOriginal content.'), size: 25 },
      'commands/build': { hash: sha256('# Build\nOriginal content.'), size: 26 },
    },
  };

  it('should return valid when stripped content hash matches manifest', () => {
    const content = '# Plan\nOriginal content.';
    const result = verifyPromptHash(content, 'commands', 'plan', manifest);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('match');
  });

  it('should return invalid when content hash does not match manifest', () => {
    const content = '# Plan\nTampered content!';
    const result = verifyPromptHash(content, 'commands', 'plan', manifest);
    expect(result.valid).toBe(false);
    expect(result.status).toBe('mismatch');
  });

  it('should return skip when prompt key is not in manifest', () => {
    const content = '# Unknown\nSome content.';
    const result = verifyPromptHash(content, 'commands', 'unknown', manifest);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('not_in_manifest');
  });

  it('should compute SHA-256 hash correctly', () => {
    const content = 'hello world';
    const expected = sha256('hello world');
    expect(hashContent(content)).toBe(expected);
  });
});
