/**
 * Decrypt command for OSS Decrypt CLI
 * Fetches encrypted prompts from API and decrypts them locally
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fetchEncryptedPrompt } from '../api-client.js';
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
 */
export interface DecryptOptions {
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
 * @param type - Prompt type (commands, workflows, skills, agents, hooks)
 * @param name - Prompt name
 * @param debug - Enable debug output
 * @param options - Additional options (noCache, clearCache)
 * @throws Error if credentials not setup or decryption fails
 */
export async function decryptCommand(
  type: 'commands' | 'workflows' | 'skills' | 'agents' | 'hooks',
  name: string,
  debug = false,
  options: DecryptOptions = {}
): Promise<void> {
  const logger = new DebugLogger(debug);
  const cache = new CacheService(getCacheDir());

  // Load credentials from storage
  logger.log('FETCH', 'Loading credentials from storage');
  const credentials = await retrieveCredentials();

  if (!credentials) {
    throw new Error('Credentials not found. Run setup first.');
  }

  // Handle clear cache option
  if (options.clearCache) {
    logger.log('CACHE', 'Clearing all cached prompts');
    await cache.clearAll();
    console.log('Cache cleared.');
    return;
  }

  // Check cache first (unless noCache is set)
  if (!options.noCache) {
    logger.log('CACHE', `Checking cache for ${type}/${name}`);
    const cached = await cache.get(type, name, credentials.userId);
    if (cached) {
      logger.log('CACHE', 'Cache hit - returning cached content');
      console.log(cached);
      return;
    }
    logger.log('CACHE', 'Cache miss - fetching from API');
  }

  const apiUrl = getApiUrl();
  logger.log('FETCH', `API URL: ${apiUrl}`);

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

  // Store in cache (unless noCache is set)
  if (!options.noCache) {
    logger.log('CACHE', 'Storing decrypted prompt in cache');
    await cache.set(type, name, credentials.userId, plaintext);
  }

  // Output to stdout
  console.log(plaintext);
}
