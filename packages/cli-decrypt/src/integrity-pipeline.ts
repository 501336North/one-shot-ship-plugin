/**
 * Integrity verification pipeline
 *
 * Checks a decrypted prompt against the signed manifest before delivery.
 *
 * Default-deny (R-273 D4, D5, D10):
 * 1. No manifest → blocked
 * 2. No own manifest entry for `${type}/${name}` → blocked ('not_in_manifest')
 * 3. Entry without servedHash → blocked
 * 4. sha256 of the exact served plaintext (watermarked, unstripped) must equal servedHash
 */

import { hashContent } from './prompt-integrity.js';
import type { SignedManifest } from './manifest-verifier.js';

export interface VerificationResult {
  verified: boolean;
  skipped: boolean;
  reason?: 'not_in_manifest';
}

/**
 * Verify a decrypted prompt's integrity against the manifest.
 *
 * @param plaintext - Decrypted prompt exactly as served (still watermarked)
 * @param type - Prompt type (commands, workflows, etc.)
 * @param name - Prompt name
 * @param manifest - Signed manifest (or null if unavailable)
 */
export async function verifyDecryptedPrompt(
  plaintext: string,
  type: string,
  name: string,
  manifest: SignedManifest | null
): Promise<VerificationResult> {
  if (!manifest) {
    return { verified: false, skipped: false };
  }

  const key = `${type}/${name}`;
  if (!Object.hasOwn(manifest.prompts, key)) {
    return { verified: false, skipped: false, reason: 'not_in_manifest' };
  }

  const servedHash = manifest.prompts[key].servedHash;
  if (!servedHash) {
    return { verified: false, skipped: false };
  }

  return { verified: hashContent(plaintext) === servedHash, skipped: false };
}
