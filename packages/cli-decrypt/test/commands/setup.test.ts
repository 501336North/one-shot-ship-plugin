/**
 * @behavior Setup command fetches and stores credentials
 * @acceptance-criteria AC-DECRYPT-006
 * @business-rule DECRYPT-006
 * @boundary CLI Commands
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { setupCommand } from '../../src/commands/setup.js';
import * as apiClient from '../../src/api-client.js';
import * as storage from '../../src/storage.js';
import * as hardware from '../../src/hardware.js';

// Mock modules
vi.mock('../../src/api-client.js');
vi.mock('../../src/storage.js');
vi.mock('../../src/hardware.js');

describe('Setup Command', () => {
  const testDir = join(tmpdir(), 'oss-decrypt-setup-test-' + Date.now());

  beforeEach(() => {
    vi.resetAllMocks();

    // Create test directory with config
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    process.env.OSS_CONFIG_DIR = testDir;

    // Default mock implementations
    vi.mocked(hardware.getHardwareId).mockReturnValue('test-hw-id');
    vi.mocked(apiClient.fetchCredentials).mockResolvedValue({
      userId: 'user_123',
      salt: 'salt_abc',
      hardwareId: 'test-hw-id',
    });
    vi.mocked(storage.storeCredentials).mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.OSS_CONFIG_DIR;
  });

  describe('setupCommand', () => {
    it('should fetch and store credentials', async () => {
      // Create config file with API key
      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ apiKey: 'ak_test_123' }));

      await setupCommand();

      expect(apiClient.fetchCredentials).toHaveBeenCalledWith(
        'ak_test_123',
        expect.any(String),
        'test-hw-id'
      );
      expect(storage.storeCredentials).toHaveBeenCalledWith({
        apiKey: 'ak_test_123',
        userId: 'user_123',
        hardwareId: 'test-hw-id',
        salt: 'salt_abc',
      });
    });

    it('should read API key from config', async () => {
      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ apiKey: 'ak_from_config' }));

      await setupCommand();

      expect(apiClient.fetchCredentials).toHaveBeenCalledWith(
        'ak_from_config',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should fail if no API key configured', async () => {
      // No config file = no API key
      await expect(setupCommand()).rejects.toThrow('API key');
    });

    it('should generate hardware ID', async () => {
      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ apiKey: 'ak_test' }));

      await setupCommand();

      expect(hardware.getHardwareId).toHaveBeenCalled();
      expect(apiClient.fetchCredentials).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'test-hw-id'
      );
    });
  });
});
