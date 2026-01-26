/**
 * @behavior Encryption utilities derive keys and decrypt content correctly
 * @acceptance-criteria AC-DECRYPT-002
 * @business-rule DECRYPT-002
 * @boundary CLI Encryption
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Import will fail until implemented - this is the RED phase
import { deriveKey, decrypt } from '../src/encryption.js';

describe('Encryption Utilities', () => {
  describe('deriveKey', () => {
    it('should produce consistent 32-byte key', () => {
      const apiKey = 'test-api-key-123';
      const licenseId = 'license-456';
      const hardwareId = 'hw-789';
      const salt = 'salt-abc';

      const key1 = deriveKey(apiKey, licenseId, hardwareId, salt);
      const key2 = deriveKey(apiKey, licenseId, hardwareId, salt);

      // Should be 32 bytes (256 bits)
      expect(key1.length).toBe(32);

      // Should be consistent
      expect(key1.equals(key2)).toBe(true);
    });

    it('should produce different keys for different inputs', () => {
      const key1 = deriveKey('key1', 'license', 'hw', 'salt');
      const key2 = deriveKey('key2', 'license', 'hw', 'salt');

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('decrypt', () => {
    // Helper to encrypt for testing
    function encrypt(plaintext: string, key: Buffer): {
      encrypted: string;
      iv: string;
      authTag: string;
    } {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const authTag = cipher.getAuthTag();

      return {
        encrypted,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      };
    }

    it('should decrypt valid ciphertext', () => {
      const key = deriveKey('api-key', 'license', 'hw', 'salt');
      const plaintext = 'Hello, World! This is a test message.';
      const { encrypted, iv, authTag } = encrypt(plaintext, key);

      const decrypted = decrypt(encrypted, iv, authTag, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw on wrong key', () => {
      const key1 = deriveKey('api-key-1', 'license', 'hw', 'salt');
      const key2 = deriveKey('api-key-2', 'license', 'hw', 'salt');
      const plaintext = 'Secret message';
      const { encrypted, iv, authTag } = encrypt(plaintext, key1);

      expect(() => {
        decrypt(encrypted, iv, authTag, key2);
      }).toThrow();
    });

    it('should throw on tampered data', () => {
      const key = deriveKey('api-key', 'license', 'hw', 'salt');
      const plaintext = 'Original message';
      const { encrypted, iv, authTag } = encrypt(plaintext, key);

      // Tamper with the encrypted data
      const tampered = Buffer.from(encrypted, 'base64');
      tampered[0] = (tampered[0] + 1) % 256;
      const tamperedBase64 = tampered.toString('base64');

      expect(() => {
        decrypt(tamperedBase64, iv, authTag, key);
      }).toThrow();
    });
  });
});
