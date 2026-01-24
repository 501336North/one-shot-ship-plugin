/**
 * Workflow Config API
 *
 * Fetches workflow configs from the API and manages caching.
 *
 * @behavior Workflow configs are fetched from API, decrypted, and cached for session
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  WorkflowConfig,
  EncryptedWorkflowConfig,
  DEFAULT_WORKFLOW_CONFIGS,
} from '../engine/types.js';

const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32;

/**
 * Credentials structure from credentials.enc
 */
interface StoredCredentials {
  apiKey: string;
  userId: string;
  hardwareId: string;
  salt: string;
}

/**
 * In-memory cache for workflow configs (session-scoped)
 */
const configCache: Map<string, WorkflowConfig> = new Map();

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return process.env.OSS_CONFIG_DIR || path.join(os.homedir(), '.oss');
}

/**
 * Read the config.json file
 */
function readConfig(): { apiKey?: string; apiUrl?: string } {
  const configPath = path.join(getConfigDir(), 'config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Get machine-specific key for decrypting stored credentials
 */
function getMachineKey(): Buffer {
  const machineId = [
    process.env.USER || 'user',
    os.homedir(),
    process.platform,
    process.arch,
  ].join(':');
  return crypto.createHash('sha256').update(machineId).digest();
}

/**
 * Retrieve stored credentials
 */
function retrieveCredentials(): StoredCredentials | null {
  const credentialsPath = path.join(getConfigDir(), 'credentials.enc');
  if (!fs.existsSync(credentialsPath)) {
    return null;
  }
  try {
    const stored = fs.readFileSync(credentialsPath, 'utf8');
    const [ivBase64, authTagBase64, encrypted] = stored.split(':');
    if (!ivBase64 || !authTagBase64 || !encrypted) {
      return null;
    }

    const key = getMachineKey();
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/**
 * Derive decryption key from credentials
 */
function deriveKey(apiKey: string, licenseId: string, hardwareId: string, salt: string): Buffer {
  const combined = `${apiKey}:${licenseId}:${hardwareId}`;
  return crypto.pbkdf2Sync(combined, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Convert userId to licenseId
 */
function userIdToLicenseId(userId: string): string {
  return `lic_${crypto.createHash('sha256').update(userId).digest('hex').substring(0, 24)}`;
}

/**
 * Fetch encrypted workflow config from API
 */
export async function fetchWorkflowConfig(workflowName: string): Promise<EncryptedWorkflowConfig> {
  const config = readConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error('No API key configured');
  }

  const apiUrl = config.apiUrl || DEFAULT_API_URL;
  const endpoint = `${apiUrl}/api/v1/workflows/${workflowName}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorResponse = await response.json().catch(() => ({ error: 'Request failed' })) as { error?: string };
    throw new Error(errorResponse.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<EncryptedWorkflowConfig>;
}

/**
 * Decrypt workflow config using stored credentials
 */
export function decryptWorkflowConfig(
  encrypted: EncryptedWorkflowConfig,
  credentials: StoredCredentials
): WorkflowConfig {
  try {
    const licenseId = userIdToLicenseId(credentials.userId);
    const key = deriveKey(credentials.apiKey, licenseId, credentials.hardwareId, credentials.salt);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(encrypted.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    let decrypted = decipher.update(encrypted.encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted) as WorkflowConfig;
  } catch {
    // Return empty config on decryption failure (will use defaults)
    return {};
  }
}

/**
 * Get workflow config from cache or fetch from API
 */
export async function getCachedOrFetch(workflowName: string): Promise<WorkflowConfig> {
  // Check cache first
  const cached = configCache.get(workflowName);
  if (cached) {
    return cached;
  }

  // Check if we have credentials
  const config = readConfig();
  if (!config.apiKey) {
    // No credentials, cache and return default
    const defaultConfig = DEFAULT_WORKFLOW_CONFIGS[workflowName] || {};
    configCache.set(workflowName, defaultConfig);
    return defaultConfig;
  }

  try {
    // Fetch from API
    const encrypted = await fetchWorkflowConfig(workflowName);

    // Get credentials for decryption
    const credentials = retrieveCredentials();
    if (!credentials) {
      const defaultConfig = DEFAULT_WORKFLOW_CONFIGS[workflowName] || {};
      configCache.set(workflowName, defaultConfig);
      return defaultConfig;
    }

    // Decrypt and cache
    const decrypted = decryptWorkflowConfig(encrypted, credentials);

    // Merge with defaults to ensure all fields exist
    const merged = {
      ...DEFAULT_WORKFLOW_CONFIGS[workflowName],
      ...decrypted,
    };

    configCache.set(workflowName, merged);
    return merged;
  } catch {
    // On error, cache and return default config
    const defaultConfig = DEFAULT_WORKFLOW_CONFIGS[workflowName] || {};
    configCache.set(workflowName, defaultConfig);
    return defaultConfig;
  }
}

/**
 * Clear the workflow config cache (for testing)
 */
export function clearWorkflowConfigCache(): void {
  configCache.clear();
}
