/**
 * Decrypt command for OSS Decrypt CLI
 * Fetches encrypted prompts from API and decrypts them locally
 */

import { join } from 'path';
import { getConfigDir } from '../config.js';
import { fetchEncryptedPrompt, fetchCustomPrompt } from '../api-client.js';
import { retrieveCredentials } from '../storage.js';
import { deriveKey, decrypt, userIdToLicenseId } from '../encryption.js';
import { DebugLogger } from '../debug.js';
import { CacheService } from '../cache.js';
import type { SignedManifest } from '../manifest-verifier.js';
import { getTrustedApiOrigin, publicKeyFor, type ManifestKeys } from '../manifest-keys.js';
import { fetchVerifiedManifest, readCachedManifest } from '../verified-manifest.js';
import { verifyDecryptedPrompt } from '../integrity-pipeline.js';
import { readUpdateState, writeUpdateState } from '../update-state.js';
import { detectPromptChange } from '../change-detection.js';

/**
 * Options for decrypt command
 *
 * SECURITY: Disk caching is DISABLED by default to prevent prompt extraction.
 * Prompts only exist in memory during command execution.
 */
export interface DecryptOptions {
  /** @deprecated Disk caching is now disabled by default for security */
  noCache?: boolean;
  clearCache?: boolean;
  /** The pinned manifest keys; injectable so tests can sign with a throwaway staging key. */
  manifestKeys?: ManifestKeys;
}

/**
 * Get cache directory path
 */
function getCacheDir(): string {
  return join(getConfigDir(), 'prompt-cache');
}

/**
 * Decrypt a prompt and output to stdout
 *
 * @param type - Prompt type (commands, workflows, skills, agents, hooks, custom)
 * @param name - Prompt name
 * @param debug - Enable debug output
 * @param options - Additional options (noCache, clearCache)
 * @throws Error if credentials not setup or decryption fails
 */
export async function decryptCommand(
  type: 'commands' | 'workflows' | 'skills' | 'agents' | 'hooks' | 'custom',
  name: string,
  debug = false,
  options: DecryptOptions = {}
): Promise<void> {
  const logger = new DebugLogger(debug);

  // Handle clear cache option - cleans up any legacy cached prompts
  // Only instantiate CacheService when actually clearing
  if (options.clearCache) {
    logger.log('CACHE', 'Clearing all cached prompts');
    const cache = new CacheService(getCacheDir());
    await cache.clearAll();
    console.log('Cache cleared. All locally cached prompts have been removed.');
    console.log('Note: Disk caching is now disabled by default for security.');
    return;
  }

  // Load credentials from storage
  logger.log('FETCH', 'Loading credentials from storage');
  const credentials = await retrieveCredentials();

  if (!credentials) {
    throw new Error('Credentials not found. Run setup first.');
  }

  // SECURITY: Disk caching is DISABLED by default to prevent prompt extraction.
  // Prompts are fetched fresh from API each time to ensure:
  // 1. Revoked API keys immediately stop access
  // 2. No plaintext prompts persist on disk
  // 3. Subscription status is verified on every request
  logger.log('SECURITY', 'Disk caching disabled - fetching fresh from API');

  const apiUrl = getTrustedApiOrigin();
  logger.log('FETCH', `API URL: ${apiUrl}`);

  // The manifest key for this address, resolved before any request: an address this build holds no key
  // for is refused here, so no prompt is fetched against a manifest that could not be verified.
  const manifestPublicKey = publicKeyFor(apiUrl, options.manifestKeys);

  // Team custom commands are the ONE documented unverified exception (ADR-005): they come from the team's
  // database, not the signed manifest. They are fetched only from a trusted address (above), and marked.
  if (type === 'custom') {
    logger.log('FETCH', `Fetching custom command: ${name}`);
    const customPrompt = await fetchCustomPrompt(credentials.apiKey, apiUrl, name);
    console.error('[verify] UNVERIFIED: team custom command (not covered by the signed manifest)');
    console.log(customPrompt.prompt);
    return;
  }

  const fetchPlaintext = async (): Promise<string> => {
    logger.log('FETCH', `Fetching prompt: ${type}/${name}`);
    const encryptedPrompt = await fetchEncryptedPrompt(credentials.apiKey, apiUrl, type, name);
    // Transform userId to licenseId (must match server-side format), then derive the key and decrypt.
    const licenseId = userIdToLicenseId(credentials.userId);
    const key = deriveKey(credentials.apiKey, licenseId, credentials.hardwareId, credentials.salt);
    return decrypt(encryptedPrompt.encrypted, encryptedPrompt.iv, encryptedPrompt.authTag, key);
  };

  // SECURITY: Do NOT cache decrypted prompts to disk. Only the signed manifest is cached (verified-manifest.ts).
  // Verify prompt integrity against the signed manifest (BLOCKING, fail closed — FR3). The manifest is fetched
  // in parallel with the prompt; no prompt is ever delivered without a verified manifest entry.
  console.error('[verify] Checking prompt integrity...');
  const cached = readCachedManifest(apiUrl, manifestPublicKey);
  let plaintext: string;
  let manifest: SignedManifest;
  try {
    [plaintext, manifest] = await Promise.all([
      fetchPlaintext(),
      cached ? Promise.resolve(cached) : fetchVerifiedManifest(apiUrl, manifestPublicKey),
    ]);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('[SECURITY]')) {
      console.error('[verify] Manifest: FAILED — prompt blocked');
    }
    throw err;
  }
  console.error('[verify] Manifest signature: valid');

  let integrity = await verifyDecryptedPrompt(plaintext, type, name, manifest);
  if (!integrity.verified && cached) {
    // The prompt may have changed since the manifest was cached: check it against a fresh manifest once.
    manifest = await fetchVerifiedManifest(apiUrl, manifestPublicKey);
    integrity = await verifyDecryptedPrompt(plaintext, type, name, manifest);
  }
  if (integrity.status === 'not_in_manifest') {
    console.error('[verify] Prompt not in the signed manifest — prompt blocked');
    throw new Error(`[SECURITY] ${type}/${name} is not in the signed prompt manifest. Prompt delivery blocked.`);
  }
  if (!integrity.verified) {
    console.error('[verify] Prompt hash: FAILED — prompt blocked');
    throw new Error('[SECURITY] Prompt integrity check FAILED. Content may have been tampered with.');
  }
  console.error('[verify] Prompt hash: verified');

  // Detect prompt hash changes for update notifications
  const manifestKey = `${type}/${name}`;
  const currentHash = manifest.prompts[manifestKey]?.hash ?? null;
  const statePath = join(getConfigDir(), 'update-state.json');
  const updateState = readUpdateState(statePath);
  const detection = detectPromptChange(updateState, type, name, currentHash);

  if (detection.changed) {
    console.error(`[update] /oss:${name} prompt updated`);
  }

  if (Object.keys(detection.updatedSignatures).length > 0) {
    writeUpdateState(statePath, {
      ...updateState,
      promptSignatures: {
        ...updateState.promptSignatures,
        ...detection.updatedSignatures,
      },
    });
  }

  // Only output once verification passed
  console.log(plaintext);
}
