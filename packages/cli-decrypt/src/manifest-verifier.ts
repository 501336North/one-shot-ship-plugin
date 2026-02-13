/**
 * Manifest signature verification
 *
 * Fetches the signed prompt manifest from the API and verifies
 * its Ed25519 signature against the published public key.
 * This ensures the manifest hasn't been tampered with.
 */

import crypto from 'crypto';

export interface ManifestPromptEntry {
  hash: string;
  size: number;
}

export interface SignedManifest {
  version: number;
  generatedAt: string;
  algorithm: string;
  signing: string;
  prompts: Record<string, ManifestPromptEntry>;
  signature: string;
}

/**
 * Verify the Ed25519 signature on a manifest.
 *
 * @param manifest - The signed manifest to verify
 * @param publicKey - Base64-encoded SPKI DER public key
 * @returns true if signature is valid
 */
export function verifyManifestSignature(
  manifest: SignedManifest,
  publicKey: string
): boolean {
  try {
    const sortedKeys = Object.keys(manifest.prompts).sort();
    const sortedPrompts: Record<string, ManifestPromptEntry> = {};
    for (const key of sortedKeys) {
      sortedPrompts[key] = manifest.prompts[key];
    }
    const data = JSON.stringify(sortedPrompts);
    const keyObj = crypto.createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      null,
      Buffer.from(data, 'utf8'),
      keyObj,
      Buffer.from(manifest.signature, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * Fetch the signed manifest from the API.
 *
 * @param apiUrl - Base API URL
 * @param signal - Optional AbortSignal for timeout control
 * @returns The signed manifest, or null on failure
 */
export async function fetchManifest(
  apiUrl: string,
  signal?: AbortSignal
): Promise<SignedManifest | null> {
  try {
    const response = await fetch(`${apiUrl}/api/v1/prompts/manifest`, {
      method: 'GET',
      signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as SignedManifest;
  } catch {
    return null;
  }
}
