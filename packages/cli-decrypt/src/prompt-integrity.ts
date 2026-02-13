/**
 * Post-decryption prompt integrity verification
 *
 * After decrypting a prompt and stripping watermarks, computes its
 * SHA-256 hash and compares against the signed manifest to detect tampering.
 */

import crypto from 'crypto';
import type { SignedManifest } from './manifest-verifier.js';

export interface IntegrityResult {
  valid: boolean;
  status: 'match' | 'mismatch' | 'not_in_manifest';
}

/**
 * Compute SHA-256 hex digest of content.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Verify a decrypted (and watermark-stripped) prompt against the manifest.
 *
 * @param strippedContent - Prompt content after watermark removal
 * @param type - Prompt type (commands, workflows, etc.)
 * @param name - Prompt name
 * @param manifest - The signed manifest to check against
 * @returns IntegrityResult indicating match, mismatch, or not found
 */
export function verifyPromptHash(
  strippedContent: string,
  type: string,
  name: string,
  manifest: SignedManifest
): IntegrityResult {
  const key = `${type}/${name}`;
  const entry = manifest.prompts[key];

  if (!entry) {
    return { valid: true, status: 'not_in_manifest' };
  }

  const hash = hashContent(strippedContent);
  if (hash === entry.hash) {
    return { valid: true, status: 'match' };
  }

  return { valid: false, status: 'mismatch' };
}
