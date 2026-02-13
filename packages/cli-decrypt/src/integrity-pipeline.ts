/**
 * Integrity verification pipeline
 *
 * Orchestrates watermark stripping + hash verification after decryption.
 * This is the main integration point called from the decrypt command.
 *
 * Flow:
 * 1. Strip watermark homoglyphs from decrypted content
 * 2. Hash the stripped content with SHA-256
 * 3. Compare against the signed manifest entry
 * 4. Return verification result (pass/fail/skip)
 */

import { stripWatermark } from './watermark.js';
import { verifyPromptHash } from './prompt-integrity.js';
import type { SignedManifest } from './manifest-verifier.js';

export interface VerificationResult {
  verified: boolean;
  skipped: boolean;
}

/**
 * Verify a decrypted prompt's integrity against the manifest.
 *
 * Gracefully degrades: if manifest is null or prompt isn't in manifest,
 * returns verified=true with skipped=true (warn + continue).
 *
 * @param watermarkedContent - Decrypted prompt (still watermarked)
 * @param type - Prompt type (commands, workflows, etc.)
 * @param name - Prompt name
 * @param manifest - Signed manifest (or null if unavailable)
 */
export async function verifyDecryptedPrompt(
  watermarkedContent: string,
  type: string,
  name: string,
  manifest: SignedManifest | null
): Promise<VerificationResult> {
  if (!manifest) {
    return { verified: true, skipped: true };
  }

  const stripped = stripWatermark(watermarkedContent);
  const result = verifyPromptHash(stripped, type, name, manifest);

  if (result.status === 'not_in_manifest') {
    return { verified: true, skipped: true };
  }

  return { verified: result.valid, skipped: false };
}
