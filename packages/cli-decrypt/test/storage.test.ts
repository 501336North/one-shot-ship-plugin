/**
 * @behavior Credential storage securely stores and retrieves credentials
 * @acceptance-criteria AC-DECRYPT-003
 * @business-rule DECRYPT-003
 * @boundary CLI Storage
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  storeCredentials,
  retrieveCredentials,
  deleteCredentials,
  type Credentials,
} from '../src/storage.js';

describe('Credential Storage', () => {
  const testDir = join(tmpdir(), 'oss-decrypt-test-' + Date.now());

  beforeEach(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    // Set test environment
    process.env.OSS_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.OSS_CONFIG_DIR;
  });

  describe('storeCredentials', () => {
    it('should store and retrieve credentials', async () => {
      const credentials: Credentials = {
        apiKey: 'ak_test_123',
        userId: 'user_456',
        hardwareId: 'hw_789',
        salt: 'salt_abc',
      };

      await storeCredentials(credentials);
      const retrieved = await retrieveCredentials();

      expect(retrieved).not.toBeNull();
      expect(retrieved?.apiKey).toBe(credentials.apiKey);
      expect(retrieved?.userId).toBe(credentials.userId);
      expect(retrieved?.hardwareId).toBe(credentials.hardwareId);
      expect(retrieved?.salt).toBe(credentials.salt);
    });
  });

  describe('retrieveCredentials', () => {
    it('should return null when no credentials stored', async () => {
      const credentials = await retrieveCredentials();
      expect(credentials).toBeNull();
    });
  });

  describe('overwrite', () => {
    it('should overwrite existing credentials', async () => {
      const creds1: Credentials = {
        apiKey: 'ak_first',
        userId: 'user_first',
        hardwareId: 'hw_first',
        salt: 'salt_first',
      };
      const creds2: Credentials = {
        apiKey: 'ak_second',
        userId: 'user_second',
        hardwareId: 'hw_second',
        salt: 'salt_second',
      };

      await storeCredentials(creds1);
      await storeCredentials(creds2);
      const retrieved = await retrieveCredentials();

      expect(retrieved?.apiKey).toBe('ak_second');
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials', async () => {
      const credentials: Credentials = {
        apiKey: 'ak_to_delete',
        userId: 'user_delete',
        hardwareId: 'hw_delete',
        salt: 'salt_delete',
      };

      await storeCredentials(credentials);
      await deleteCredentials();
      const retrieved = await retrieveCredentials();

      expect(retrieved).toBeNull();
    });
  });
});
