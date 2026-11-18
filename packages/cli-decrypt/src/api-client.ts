/**
 * API client for OSS Decrypt CLI
 * Fetches credentials and encrypted prompts from the OSS API
 *
 * SECURITY: On 401 responses, check for X-OSS-Clear-Cache header
 * and clear local cache to prevent extracted prompts from persisting.
 */

import { join } from 'path';
import { getConfigDir } from './config.js';
import { CacheService, validateType, validateName } from './cache.js';
import { stripControl } from './strip-control.js';
import { readCapped } from './capped-body.js';

/**
 * Get cache directory path
 */
function getCacheDir(): string {
  return join(getConfigDir(), 'prompt-cache');
}

/**
 * Check response for cache clear directive and execute if present
 */
async function handleCacheClearDirective(response: Response): Promise<void> {
  const clearCache = response.headers.get('X-OSS-Clear-Cache');
  if (clearCache === 'true') {
    try {
      const cache = new CacheService(getCacheDir());
      await cache.clearAll();
      console.error('[SECURITY] Local prompt cache cleared by server directive.');
    } catch {
      // Silently fail - cache may not exist
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
 * Custom prompt response from the API (plaintext, not encrypted)
 */
export interface CustomPromptResponse {
  prompt: string;
  name: string;
  displayName: string;
  isBlocking: boolean;
}

/**
 * fetch with redirects refused. Node's fetch reports a refused redirect only as
 * "fetch failed"; name it so the user knows to check apiUrl.
 */
async function fetchNoRedirect(
  url: string,
  init: Omit<RequestInit, 'headers'> & { headers: Record<string, string> }
): Promise<Response> {
  // fetch's own header error quotes the whole value, which would print the API key.
  if (Object.values(init.headers).some((value) => /[\r\n\0]/.test(value))) {
    throw new Error('Your stored API key contains invalid characters. Run /oss:login again.');
  }
  try {
    return await fetch(url, { ...init, redirect: 'error' });
  } catch (err: unknown) {
    const cause: unknown = err instanceof Error ? err.cause : undefined;
    if (cause instanceof Error && cause.message === 'unexpected redirect') {
      throw new Error(
        'The API answered with a redirect; refusing to send your API key. Check apiUrl in your OSS config.'
      );
    }
    throw err;
  }
}

/** How long a prompt fetch (request and body) may take before it gives up. */
export const PROMPT_FETCH_TIMEOUT_MS = 30_000;

/** Largest API response body read: 2 MiB, over 20x the largest live prompt as encrypted base64 JSON. */
export const PROMPT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The JSON body, read with the PROMPT_MAX_BYTES cap. A larger body is refused. A response object without a
 * body stream has nothing to cap and is parsed as it is.
 */
async function readJsonCapped(response: Response): Promise<unknown> {
  if (!response.body) return response.json();
  const text = await readCapped(response, PROMPT_MAX_BYTES);
  if (text === null) {
    throw new Error(`The API answer was larger than ${PROMPT_MAX_BYTES / (1024 * 1024)} MiB; refusing it.`);
  }
  return JSON.parse(text);
}

/** Run one API call (request and body) with a deadline; running out of time is reported as such. */
async function withinTimeout<T>(timeoutMs: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await call(signal);
  } catch (err: unknown) {
    if (signal.aborted) {
      throw new Error(
        `The API did not answer within ${Math.round(timeoutMs / 1000)} s; check your connection and run the command again.`
      );
    }
    throw err;
  }
}

/**
 * Fetch decryption credentials from the API
 *
 * @param apiKey - User's API key
 * @param apiUrl - Base API URL
 * @param hardwareId - Hardware ID to register
 * @param timeoutMs - Give up after this long (PROMPT_FETCH_TIMEOUT_MS)
 * @returns Credentials including userId, salt, and hardwareId
 * @throws Error if authentication fails, the API does not answer in time or answers more than PROMPT_MAX_BYTES
 */
export async function fetchCredentials(
  apiKey: string,
  apiUrl: string,
  hardwareId: string,
  timeoutMs: number = PROMPT_FETCH_TIMEOUT_MS
): Promise<CredentialsResponse> {
  const url = `${apiUrl}/api/v1/auth/credentials?hardwareId=${encodeURIComponent(hardwareId)}`;

  return withinTimeout(timeoutMs, async (signal) => {
    const response = await fetchNoRedirect(url, {
      method: 'GET',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // SECURITY: Check for cache clear directive on auth failures
      await handleCacheClearDirective(response);

      const error = (await readJsonCapped(response).catch(() => ({ error: 'Request failed' }))) as {
        error?: string;
      };
      throw new Error(stripControl(error.error || 'Request failed'));
    }

    return (await readJsonCapped(response)) as CredentialsResponse;
  });
}

/**
 * Fetch an encrypted prompt from the API
 *
 * @param apiKey - User's API key
 * @param apiUrl - Base API URL
 * @param type - Prompt type (commands, workflows, skills, agents, hooks, custom)
 * @param name - Prompt name
 * @param timeoutMs - Give up after this long (PROMPT_FETCH_TIMEOUT_MS)
 * @returns Encrypted prompt with iv and authTag
 * @throws Error if prompt not found, authentication fails, the API does not answer in time or answers
 *   more than PROMPT_MAX_BYTES
 */
export async function fetchEncryptedPrompt(
  apiKey: string,
  apiUrl: string,
  type: 'commands' | 'workflows' | 'skills' | 'agents' | 'hooks' | 'custom',
  name: string,
  timeoutMs: number = PROMPT_FETCH_TIMEOUT_MS
): Promise<EncryptedPromptResponse> {
  return withinTimeout(timeoutMs, (signal) => fetchEncryptedPromptWithin(apiKey, apiUrl, type, name, signal));
}

async function fetchEncryptedPromptWithin(
  apiKey: string,
  apiUrl: string,
  type: 'commands' | 'workflows' | 'skills' | 'agents' | 'hooks' | 'custom',
  name: string,
  signal: AbortSignal
): Promise<EncryptedPromptResponse> {
  validateType(type);
  validateName(name);
  // Build URL based on type. The name is encoded so it can only address its own endpoint.
  const encodedName = encodeURIComponent(name);
  let endpoint: string;
  if (type === 'workflows') {
    endpoint = `${apiUrl}/api/v1/prompts/workflows/${encodedName}`;
  } else if (type === 'commands') {
    endpoint = `${apiUrl}/api/v1/prompts/${encodedName}`;
  } else {
    endpoint = `${apiUrl}/api/v1/prompts/${type}/${encodedName}`;
  }

  const response = await fetchNoRedirect(endpoint, {
    method: 'GET',
    signal,
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
    const error = (await readJsonCapped(response).catch(() => ({ error: 'Request failed' }))) as {
      error?: string;
    };
    throw new Error(stripControl(error.error || 'Request failed'));
  }

  return (await readJsonCapped(response)) as EncryptedPromptResponse;
}

/**
 * Fetch a custom prompt from the API (plaintext, not encrypted)
 *
 * Custom commands are user-defined and returned as plaintext from the API,
 * bypassing the encryption/decryption pipeline entirely.
 *
 * @param apiKey - User's API key
 * @param apiUrl - Base API URL
 * @param name - Custom command name
 * @param timeoutMs - Give up after this long (PROMPT_FETCH_TIMEOUT_MS)
 * @returns Custom prompt with name, displayName, prompt content, and isBlocking flag
 * @throws Error if prompt not found, authentication fails, the API does not answer in time or answers
 *   more than PROMPT_MAX_BYTES
 */
export async function fetchCustomPrompt(
  apiKey: string,
  apiUrl: string,
  name: string,
  timeoutMs: number = PROMPT_FETCH_TIMEOUT_MS
): Promise<CustomPromptResponse> {
  validateName(name);
  const endpoint = `${apiUrl}/api/v1/prompts/custom/${encodeURIComponent(name)}`;

  return withinTimeout(timeoutMs, async (signal) => {
    const response = await fetchNoRedirect(endpoint, {
      method: 'GET',
      signal,
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
      const error = (await readJsonCapped(response).catch(() => ({ error: 'Request failed' }))) as {
        error?: string;
      };
      throw new Error(stripControl(error.error || 'Request failed'));
    }

    return (await readJsonCapped(response)) as CustomPromptResponse;
  });
}
