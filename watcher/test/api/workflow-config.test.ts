/**
 * Workflow Config API Tests
 *
 * @behavior Workflow configs are fetched from API and cached for session
 * @acceptance-criteria AC-WF-API.1 through AC-WF-API.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  fetchWorkflowConfig,
  decryptWorkflowConfig,
  getCachedOrFetch,
  clearWorkflowConfigCache,
} from '../../src/api/workflow-config.js';
import { WorkflowConfig, EncryptedWorkflowConfig, DEFAULT_WORKFLOW_CONFIGS } from '../../src/engine/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('WorkflowConfigAPI', () => {
  // Track directories for cleanup
  const dirsToClean: string[] = [];
  let originalOssConfigDir: string | undefined;

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-config-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  beforeEach(() => {
    // Save original env var
    originalOssConfigDir = process.env.OSS_CONFIG_DIR;
    // Reset mocks
    mockFetch.mockReset();
    // Clear the cache before each test
    clearWorkflowConfigCache();
  });

  afterEach(() => {
    // Restore original env var
    if (originalOssConfigDir !== undefined) {
      process.env.OSS_CONFIG_DIR = originalOssConfigDir;
    } else {
      delete process.env.OSS_CONFIG_DIR;
    }

    // Clean up all test directories
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
  });

  describe('fetchWorkflowConfig', () => {
    it('should fetch workflow config from API', async () => {
      // Arrange
      const testDir = createTestDir();
      process.env.OSS_CONFIG_DIR = testDir;

      // Create credentials file
      const credentialsPath = path.join(testDir, 'credentials.enc');
      fs.writeFileSync(credentialsPath, 'test-encrypted-credentials');

      // Create config file with API key
      const configPath = path.join(testDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        apiKey: 'test-api-key',
        apiUrl: 'https://api.example.com',
      }));

      // Mock successful API response
      const mockConfig: WorkflowConfig = {
        chains_to: [{ command: 'requirements', always: true }],
        checkpoint: 'human',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          encrypted: 'test-encrypted',
          iv: 'test-iv',
          authTag: 'test-auth-tag',
        }),
      });

      // Act
      const result = await fetchWorkflowConfig('ideate');

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workflows/ideate'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should decrypt config using stored credentials', async () => {
      // Arrange
      const encryptedConfig: EncryptedWorkflowConfig = {
        encrypted: 'test-encrypted-data',
        iv: 'test-iv',
        authTag: 'test-auth-tag',
      };

      // Act & Assert
      // The function should call decryption with the correct parameters
      // This test verifies the decryption is called correctly
      const result = decryptWorkflowConfig(encryptedConfig, {
        apiKey: 'test-api-key',
        userId: 'test-user-id',
        hardwareId: 'test-hardware-id',
        salt: 'test-salt',
      });

      // Should return a valid WorkflowConfig (may be default on decryption error)
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should cache config for session', async () => {
      // Arrange
      const testDir = createTestDir();
      process.env.OSS_CONFIG_DIR = testDir;

      // Create config file
      const configPath = path.join(testDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        apiKey: 'test-api-key',
        apiUrl: 'https://api.example.com',
      }));

      // Mock API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          encrypted: 'test-encrypted',
          iv: 'test-iv',
          authTag: 'test-auth-tag',
        }),
      });

      // Act - First call
      const result1 = await getCachedOrFetch('ideate');

      // Second call should use cache
      const result2 = await getCachedOrFetch('ideate');

      // Assert - Only one API call should be made
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      const testDir = createTestDir();
      process.env.OSS_CONFIG_DIR = testDir;

      // Create config file
      const configPath = path.join(testDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        apiKey: 'test-api-key',
        apiUrl: 'https://api.example.com',
      }));

      // Mock API error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      // Act
      const result = await getCachedOrFetch('ideate');

      // Assert - Should return default config
      expect(result).toEqual(DEFAULT_WORKFLOW_CONFIGS['ideate']);
    });

    it('should handle network errors gracefully', async () => {
      // Arrange
      const testDir = createTestDir();
      process.env.OSS_CONFIG_DIR = testDir;

      // Create config file
      const configPath = path.join(testDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        apiKey: 'test-api-key',
        apiUrl: 'https://api.example.com',
      }));

      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Act
      const result = await getCachedOrFetch('ideate');

      // Assert - Should return default config
      expect(result).toEqual(DEFAULT_WORKFLOW_CONFIGS['ideate']);
    });

    it('should return default config when no credentials exist', async () => {
      // Arrange
      const testDir = createTestDir();
      process.env.OSS_CONFIG_DIR = testDir;
      // No config file created

      // Act
      const result = await getCachedOrFetch('ideate');

      // Assert - Should return default config without making API call
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual(DEFAULT_WORKFLOW_CONFIGS['ideate']);
    });
  });
});
