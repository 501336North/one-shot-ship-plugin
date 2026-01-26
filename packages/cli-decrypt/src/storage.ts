/**
 * Secure credential storage for OSS Decrypt CLI
 * Uses encrypted file storage with machine-derived key
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';

/**
 * Credentials structure for decryption
 */
export interface Credentials {
  apiKey: string;
  userId: string;
  hardwareId: string;
  salt: string;
}

/**
 * Get the config directory path
 * Can be overridden with OSS_CONFIG_DIR env var for testing
 */
function getConfigDir(): string {
  return process.env.OSS_CONFIG_DIR || join(homedir(), '.oss');
}

/**
 * Get the credentials file path
 */
function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.enc');
}

/**
 * Derive a simple encryption key from machine identifier
 * This provides basic protection against casual copying
 */
function getMachineKey(): Buffer {
  // Use a combination of hostname and machine-specific data
  const machineId = [
    process.env.USER || 'user',
    homedir(),
    process.platform,
    process.arch,
  ].join(':');

  return crypto.createHash('sha256').update(machineId).digest();
}

/**
 * Encrypt credentials for storage
 */
function encryptCredentials(credentials: Credentials): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const data = JSON.stringify(credentials);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Store as: iv:authTag:encrypted
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt credentials from storage
 */
function decryptCredentials(stored: string): Credentials {
  const [ivBase64, authTagBase64, encrypted] = stored.split(':');
  if (!ivBase64 || !authTagBase64 || !encrypted) {
    throw new Error('Invalid credentials format');
  }

  const key = getMachineKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted) as Credentials;
}

/**
 * Store credentials securely
 */
export async function storeCredentials(credentials: Credentials): Promise<void> {
  const configDir = getConfigDir();

  // Ensure config directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  const encrypted = encryptCredentials(credentials);
  const credentialsPath = getCredentialsPath();

  writeFileSync(credentialsPath, encrypted, { mode: 0o600 });
}

/**
 * Retrieve stored credentials
 * Returns null if no credentials are stored
 */
export async function retrieveCredentials(): Promise<Credentials | null> {
  const credentialsPath = getCredentialsPath();

  if (!existsSync(credentialsPath)) {
    return null;
  }

  try {
    const stored = readFileSync(credentialsPath, 'utf8');
    return decryptCredentials(stored);
  } catch {
    return null;
  }
}

/**
 * Delete stored credentials
 */
export async function deleteCredentials(): Promise<void> {
  const credentialsPath = getCredentialsPath();

  if (existsSync(credentialsPath)) {
    unlinkSync(credentialsPath);
  }
}
