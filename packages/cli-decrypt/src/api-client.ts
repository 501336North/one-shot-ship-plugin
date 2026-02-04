/**
 * API client for OSS Decrypt CLI
 * Fetches credentials and encrypted prompts from the OSS API
 *
 * SECURITY: On 401 responses, check for X-OSS-Clear-Cache header
 * and clear local cache to prevent extracted prompts from persisting.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, rmSync } from 'fs';
import { CacheService } from './cache.js';

/**
 * SECURITY: All known prompt cache directories
 * Both cli-decrypt and watcher use different cache locations
 */
function getAllCacheDirectories(): string[] {
  const configDir = process.env.OSS_CONFIG_DIR || join(homedir(), '.oss');
  return [
    join(configDir, 'prompt-cache'),       // cli-decrypt cache
    join(configDir, 'cache', 'prompts'),   // watcher cache
  ];
}

/**
 * Check response for cache clear directive and execute if present
 * SECURITY: Clears ALL known prompt cache directories
 */
async function handleCacheClearDirective(response: Response): Promise<void> {
  const clearCache = response.headers.get('X-OSS-Clear-Cache');
  if (clearCache === 'true') {
    let clearedAny = false;
    for (const cacheDir of getAllCacheDirectories()) {
      try {
        if (existsSync(cacheDir)) {
          rmSync(cacheDir, { recursive: true, force: true });
          clearedAny = true;
        }
      } catch {
        // Silently fail - directory may not exist or already cleared
      }
    }
    if (clearedAny) {
      console.error('[SECURITY] Local prompt caches cleared by server directive.');
    }
  }
}

/**
 * Credentials response from the API
 */
export interface CredentialsResponse {
  userId: string;
  salt: string;
  hardwareId: string;
}

/**
 * Encrypted prompt response from the API
 */
export interface EncryptedPromptResponse {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Fetch decryption credentials from the API
 *
 * @param apiKey - User's API key
 * @param apiUrl - Base API URL
 * @param hardwareId - Hardware ID to register
 * @returns Credentials including userId, salt, and hardwareId
 * @throws Error if authentication fails
 */
export async function fetchCredentials(
  apiKey: string,
  apiUrl: string,
  hardwareId: string
): Promise<CredentialsResponse> {
  const url = `${apiUrl}/api/v1/auth/credentials?hardwareId=${encodeURIComponent(hardwareId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    // SECURITY: Check for cache clear directive on auth failures
    await handleCacheClearDirective(response);

    const error = (await response.json().catch(() => ({ error: 'Request failed' }))) as {
      error?: string;
    };
    throw new Error(error.error || 'Request failed');
  }

  return response.json() as Promise<CredentialsResponse>;
}

/**
 * Fetch an encrypted prompt from the API
 *
 * @param apiKey - User's API key
 * @param apiUrl - Base API URL
 * @param type - Prompt type (commands, workflows, skills, agents, hooks)
 * @param name - Prompt name
 * @returns Encrypted prompt with iv and authTag
 * @throws Error if prompt not found or authentication fails
 */
export async function fetchEncryptedPrompt(
  apiKey: string,
  apiUrl: string,
  type: 'commands' | 'workflows' | 'skills' | 'agents' | 'hooks',
  name: string
): Promise<EncryptedPromptResponse> {
  // Build URL based on type
  let endpoint: string;
  if (type === 'workflows') {
    endpoint = `${apiUrl}/api/v1/prompts/workflows/${name}`;
  } else if (type === 'commands') {
    endpoint = `${apiUrl}/api/v1/prompts/${name}`;
  } else {
    endpoint = `${apiUrl}/api/v1/prompts/${type}/${name}`;
  }

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    // SECURITY: Check for cache clear directive on any error (especially 401)
    await handleCacheClearDirective(response);

    if (response.status === 404) {
      throw new Error('Prompt not found');
    }
    if (response.status === 401) {
      throw new Error('Unauthorized');
    }
    const error = (await response.json().catch(() => ({ error: 'Request failed' }))) as {
      error?: string;
    };
    throw new Error(error.error || 'Request failed');
  }

  return response.json() as Promise<EncryptedPromptResponse>;
}
