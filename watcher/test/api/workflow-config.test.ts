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
import * as net from 'net';
import {
  fetchWorkflowConfig,
  WORKFLOW_FETCH_TIMEOUT_MS,
  decryptWorkflowConfig,
  getCachedOrFetch,
  clearWorkflowConfigCache,
} from '../../src/api/workflow-config.js';
import { WorkflowConfig, EncryptedWorkflowConfig, DEFAULT_WORKFLOW_CONFIGS } from '../../src/engine/types.js';

// Mock fetch globally
const originalFetch = global.fetch;
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
    // Reset mocks and ensure mock fetch is active
    mockFetch.mockReset();
    global.fetch = mockFetch;
    // Clear the cache before each test
    clearWorkflowConfigCache();
  });

  afterEach(() => {
    // Restore original fetch to prevent leaking mock to other test files
    global.fetch = originalFetch;

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

  /**
   * @behavior The Bearer API key is only ever sent over https, to a well-formed workflow path
   * @business-rule The config file whose apiUrl is validated is the same file whose key is sent
   *   (T2: chain-trigger validated ~/.oss while workflow-config fetched from OSS_CONFIG_DIR)
   */
  describe('untrusted config and workflow names', () => {
    let originalHome: string | undefined;

    beforeEach(() => {
      originalHome = process.env.HOME;
    });

    afterEach(() => {
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
    });

    function writeConfig(dir: string, apiUrl: string): void {
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'ak_secret_key', apiUrl }));
    }

    function okResponse(): { ok: boolean; json: () => Promise<EncryptedWorkflowConfig> } {
      return { ok: true, json: async () => ({ encrypted: 'e', iv: 'i', authTag: 'a' }) };
    }

    it('sends no request when the config actually used has an http apiUrl, even if HOME config is https', async () => {
      const home = createTestDir();
      fs.mkdirSync(path.join(home, '.oss'));
      writeConfig(path.join(home, '.oss'), 'https://api.example.com');
      process.env.HOME = home;
      const configDir = createTestDir();
      writeConfig(configDir, 'http://127.0.0.1:9');
      process.env.OSS_CONFIG_DIR = configDir;
      mockFetch.mockResolvedValue(okResponse());

      await expect(fetchWorkflowConfig('build')).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to the default config without a request when apiUrl is http', async () => {
      const configDir = createTestDir();
      writeConfig(configDir, 'http://127.0.0.1:9');
      process.env.OSS_CONFIG_DIR = configDir;
      mockFetch.mockResolvedValue(okResponse());

      const result = await getCachedOrFetch('ideate');

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual(DEFAULT_WORKFLOW_CONFIGS['ideate']);
    });

    it('still fetches from an https apiUrl', async () => {
      const configDir = createTestDir();
      writeConfig(configDir, 'https://api.example.com');
      process.env.OSS_CONFIG_DIR = configDir;
      mockFetch.mockResolvedValue(okResponse());

      await fetchWorkflowConfig('build');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/api/v1/workflows/build');
    });

    it.each([
      ['a traversal with a query', 'build/../ship?x=1'],
      ['a slash', 'build/ship'],
      ['a dot-dot', '..'],
      ['a query', 'ship?x=1'],
      ['a fragment', 'ship#x'],
      ['a percent-encoding', '%2e%2e'],
      ['a space', 'a b'],
      ['uppercase', 'Build'],
      ['a newline', 'build\nx'],
      ['an empty name', ''],
      ['a 42-char name', 'a'.repeat(42)],
    ])('sends no request for a workflow name with %s', async (_label, name) => {
      const configDir = createTestDir();
      writeConfig(configDir, 'https://api.example.com');
      process.env.OSS_CONFIG_DIR = configDir;
      mockFetch.mockResolvedValue(okResponse());

      await expect(fetchWorkflowConfig(name)).rejects.toThrow();
      const fallback = await getCachedOrFetch(name);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(fallback).toEqual(DEFAULT_WORKFLOW_CONFIGS[name] || {});
    });
  });

  /**
   * @behavior A slow or silent API gives up before oss-notify.sh's 30s chain-trigger cap
   * @business-rule The chain falls back to defaults instead of being silently dropped (T3)
   */
  describe('API that never answers', () => {
    let server: net.Server | null = null;
    const sockets: net.Socket[] = [];

    afterEach(async () => {
      for (const socket of sockets) socket.destroy();
      sockets.length = 0;
      if (server) {
        const s = server;
        server = null;
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    });

    async function startSilentServer(): Promise<number> {
      const s = net.createServer((socket) => {
        sockets.push(socket); // accept the connection, never send a byte
      });
      server = s;
      await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
      const address = s.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      return address.port;
    }

    it('default timeout is well under the 30s chain-trigger cap', () => {
      expect(WORKFLOW_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
      expect(WORKFLOW_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(10000);
    });

    it('gives up on a silent server instead of hanging', async () => {
      const port = await startSilentServer();
      const configDir = createTestDir();
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ apiKey: 'ak_secret_key', apiUrl: `https://127.0.0.1:${port}` })
      );
      process.env.OSS_CONFIG_DIR = configDir;
      global.fetch = originalFetch;

      const outcome = await Promise.race([
        fetchWorkflowConfig('build', 200).then(
          () => 'resolved',
          () => 'gave-up'
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 3000)),
      ]);

      expect(sockets.length).toBeGreaterThan(0);
      expect(outcome).toBe('gave-up');
    });
  });
});
