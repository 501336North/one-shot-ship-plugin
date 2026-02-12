/**
 * Decrypt command for OSS Decrypt CLI
 * Fetches encrypted prompts from API and decrypts them locally
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fetchEncryptedPrompt, fetchCustomPrompt } from '../api-client.js';
import { retrieveCredentials } from '../storage.js';
import { deriveKey, decrypt, userIdToLicenseId } from '../encryption.js';
import { DebugLogger } from '../debug.js';
import { CacheService } from '../cache.js';

/**
 * Default API URL (can be overridden in config)
 */
const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';

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
}

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
 * Read API URL from config (or use default)
 */
function getApiUrl(): string {
  const configPath = join(getConfigDir(), 'config.json');

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8');
      const config = JSON.parse(content);
      return config.apiUrl || DEFAULT_API_URL;
    } catch {
      // Fall through to default
    }
  }

  return DEFAULT_API_URL;
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

  const apiUrl = getApiUrl();
  logger.log('FETCH', `API URL: ${apiUrl}`);

  // Custom commands are NOT encrypted - fetch and output directly
  if (type === 'custom') {
    logger.log('FETCH', `Fetching custom command: ${name}`);
    const startFetch = Date.now();
    const customPrompt = await fetchCustomPrompt(credentials.apiKey, apiUrl, name);
    logger.log('FETCH', `Custom command fetched in ${Date.now() - startFetch}ms`);
    console.log(customPrompt.prompt);
    return;
  }

  // Fetch encrypted prompt from API
  logger.log('FETCH', `Fetching prompt: ${type}/${name}`);
  const startFetch = Date.now();
  const encryptedPrompt = await fetchEncryptedPrompt(
    credentials.apiKey,
    apiUrl,
    type,
    name
  );
  logger.log('FETCH', `Fetch completed in ${Date.now() - startFetch}ms`);

  // Transform userId to licenseId (must match server-side format)
  const licenseId = userIdToLicenseId(credentials.userId);

  // Derive decryption key using licenseId (not raw userId)
  logger.log('DERIVE', 'Deriving decryption key');
  const startDerive = Date.now();
  const key = deriveKey(
    credentials.apiKey,
    licenseId,
    credentials.hardwareId,
    credentials.salt
  );
  logger.log('DERIVE', `Key derivation completed in ${Date.now() - startDerive}ms`);

  // Decrypt the prompt
  logger.log('DECRYPT', 'Decrypting prompt content');
  const startDecrypt = Date.now();
  const plaintext = decrypt(
    encryptedPrompt.encrypted,
    encryptedPrompt.iv,
    encryptedPrompt.authTag,
    key
  );
  logger.log('DECRYPT', `Decryption completed in ${Date.now() - startDecrypt}ms`);

  // SECURITY: Do NOT cache decrypted prompts to disk.
  // This prevents prompt extraction even after API key revocation.

  // Output to stdout
  console.log(plaintext);
}
