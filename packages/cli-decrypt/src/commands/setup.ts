/**
 * Setup command for OSS Decrypt CLI
 * Fetches credentials from API and stores them locally
 */

import { join } from 'path';
import { fetchCredentials } from '../api-client.js';
import { storeCredentials } from '../storage.js';
import { getHardwareId } from '../hardware.js';
import { CacheService } from '../cache.js';
import { getConfigDir, readConfigFile } from '../config.js';
import { getTrustedApiOrigin } from '../manifest-keys.js';

/**
 * Get cache directory path
 */
function getCacheDir(): string {
  return join(getConfigDir(), 'prompt-cache');
}

/**
 * Run setup - fetch and store credentials
 *
 * @throws Error if API key not configured or API call fails
 */
export async function setupCommand(): Promise<void> {
  // Read API key from config
  const apiKey = readConfigFile().apiKey;

  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error('No API key configured. Run /oss:login first.');
  }

  const apiUrl = getTrustedApiOrigin();

  // Generate hardware ID
  const hardwareId = getHardwareId();

  // SECURITY: Clear any existing cached prompts before re-authentication
  // This ensures old/potentially leaked prompts are removed
  const cache = new CacheService(getCacheDir());
  await cache.clearAll();

  // Fetch credentials from API
  const response = await fetchCredentials(apiKey, apiUrl, hardwareId);

  // Store credentials locally
  await storeCredentials({
    apiKey,
    userId: response.userId,
    hardwareId: response.hardwareId,
    salt: response.salt,
  });

  console.log('Setup complete. Credentials stored securely.');
  console.log('Note: Any previously cached prompts have been cleared for security.');
}
