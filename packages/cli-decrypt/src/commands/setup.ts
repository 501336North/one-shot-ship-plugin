/**
 * Setup command for OSS Decrypt CLI
 * Fetches credentials from API and stores them locally
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fetchCredentials } from '../api-client.js';
import { storeCredentials } from '../storage.js';
import { getHardwareId } from '../hardware.js';
import { CacheService } from '../cache.js';

/**
 * Default API URL (can be overridden in config)
 */
const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';

/**
 * Get config directory path
 */
function getConfigDir(): string {
  return process.env.OSS_CONFIG_DIR || join(homedir(), '.oss');
}

/**
 * Get cache directory path
 */
function getCacheDir(): string {
  return join(getConfigDir(), 'prompt-cache');
}

/**
 * Read configuration file
 */
function readConfig(): { apiKey?: string; apiUrl?: string } {
  const configPath = join(getConfigDir(), 'config.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Run setup - fetch and store credentials
 *
 * @throws Error if API key not configured or API call fails
 */
export async function setupCommand(): Promise<void> {
  // Read API key from config
  const config = readConfig();
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('No API key configured. Run /oss:login first.');
  }

  const apiUrl = config.apiUrl || DEFAULT_API_URL;

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
