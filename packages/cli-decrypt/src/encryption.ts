/**
 * Encryption utilities for OSS Decrypt CLI
 * These MUST match the server-side implementation exactly
 */

import crypto from 'crypto';

/**
 * PBKDF2 iterations - MUST match server-side value
 * 100,000 is NIST recommended minimum and provides strong security
 */
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits

/**
 * Derives a 256-bit encryption key from license credentials
 * Uses PBKDF2-SHA256 with high iteration count for brute-force resistance
 * MUST match server-side implementation exactly
 *
 * @param apiKey - User's API key
 * @param licenseId - License identifier (derived from userId)
 * @param hardwareId - Hardware identifier for device binding
 * @param salt - User-specific salt for additional entropy
 * @returns 32-byte Buffer (256-bit key)
 */
export function deriveKey(
  apiKey: string,
  licenseId: string,
  hardwareId: string,
  salt: string
): Buffer {
  // Combine inputs (excluding salt which is passed separately to PBKDF2)
  const combined = `${apiKey}:${licenseId}:${hardwareId}`;

  // Use PBKDF2 with SHA-256 and high iteration count
  // This is resistant to brute-force attacks unlike simple SHA-256
  return crypto.pbkdf2Sync(
    combined,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );
}

/**
 * Transforms userId to licenseId format
 * MUST match server-side getLicenseInfoForUser() implementation
 *
 * @param userId - Raw user ID from credentials
 * @returns License ID in format: lic_<24-char-hex>
 */
export function userIdToLicenseId(userId: string): string {
  return `lic_${crypto.createHash('sha256').update(userId).digest('hex').substring(0, 24)}`;
}

/**
 * Decrypts AES-256-GCM ciphertext
 * Throws error if authentication fails (tampered data or wrong key)
 *
 * @param encrypted - Base64-encoded ciphertext
 * @param iv - Base64-encoded initialization vector
 * @param authTag - Base64-encoded authentication tag
 * @param key - 256-bit decryption key (must match encryption key)
 * @returns Decrypted plaintext
 * @throws Error if decryption or authentication fails
 */
export function decrypt(
  encrypted: string,
  iv: string,
  authTag: string,
  key: Buffer
): string {
  // Create decipher with AES-256-GCM
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );

  // Set authentication tag for verification
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  // Decrypt the ciphertext
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
