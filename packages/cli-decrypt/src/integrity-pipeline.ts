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
 * 4. Return the result. Fail closed (FR3): only 'match' is verified; a prompt the manifest does not list is not.
 */

import { stripWatermark } from './watermark.js';
import { verifyPromptHash, type IntegrityResult } from './prompt-integrity.js';
import type { SignedManifest } from './manifest-verifier.js';

export interface VerificationResult {
  verified: boolean;
  status: IntegrityResult['status'];
}

/**
 * Verify a decrypted prompt's integrity against a signed (already verified) manifest.
 *
 * @param watermarkedContent - Decrypted prompt (still watermarked)
 * @param type - Prompt type (commands, workflows, etc.)
 * @param name - Prompt name
 * @param manifest - Signed manifest whose signature has been checked
 */
export async function verifyDecryptedPrompt(
  watermarkedContent: string,
  type: string,
  name: string,
  manifest: SignedManifest
): Promise<VerificationResult> {
  const result = verifyPromptHash(stripWatermark(watermarkedContent), type, name, manifest);
  return { verified: result.status === 'match', status: result.status };
}
