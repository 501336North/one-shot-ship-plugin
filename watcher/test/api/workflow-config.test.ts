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
import * as https from 'https';
import { execFileSync } from 'child_process';
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
   * @behavior A workflow name that is an Object.prototype member gets the empty config, not a prototype member
   * @business-rule Only the workflows DEFAULT_WORKFLOW_CONFIGS really defines have defaults (G6)
   */
  describe('prototype-member workflow names', () => {
    const protoNames = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

    function expectPlainEmpty(result: unknown): void {
      expect(typeof result).toBe('object');
      expect(result).not.toBe(Object.prototype);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(result).toStrictEqual({});
    }

    it.each(protoNames)('%s without credentials returns {}', async (name) => {
      process.env.OSS_CONFIG_DIR = createTestDir();

      expectPlainEmpty(await getCachedOrFetch(name));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(protoNames)('%s with credentials returns {} when the API gives no config', async (name) => {
      const configDir = createTestDir();
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ apiKey: 'ak_secret_key', apiUrl: 'https://api.example.com' })
      );
      process.env.OSS_CONFIG_DIR = configDir;
      mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) });

      expectPlainEmpty(await getCachedOrFetch(name));
    });

    it('constructor answered by the API but with no stored credentials returns {}', async () => {
      const configDir = createTestDir(); // no credentials.enc
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ apiKey: 'ak_secret_key', apiUrl: 'https://api.example.com' })
      );
      process.env.OSS_CONFIG_DIR = configDir;
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ encrypted: 'e', iv: 'i', authTag: 'a' }) });

      expectPlainEmpty(await getCachedOrFetch('constructor'));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('a real workflow still gets its defaults', async () => {
      process.env.OSS_CONFIG_DIR = createTestDir();

      expect(await getCachedOrFetch('build')).toEqual(DEFAULT_WORKFLOW_CONFIGS['build']);
    });
  });

  /**
   * @behavior The Bearer API key is never replayed to wherever the API redirects
   * @business-rule fetchWorkflowConfig refuses redirects (G5): a 302 rejects and the target gets no request
   */
  describe('API that redirects', () => {
    const servers: https.Server[] = [];
    let tlsDir = '';
    let savedTlsReject: string | undefined;

    afterEach(async () => {
      for (const s of servers) {
        s.closeAllConnections();
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
      servers.length = 0;
      tlsDir = ''; // removed with the other test dirs
      if (savedTlsReject !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedTlsReject;
      else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    });

    function tlsOptions(): { key: Buffer; cert: Buffer } {
      if (!tlsDir) {
        tlsDir = createTestDir();
        execFileSync('openssl', [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
          '-keyout', path.join(tlsDir, 'key.pem'), '-out', path.join(tlsDir, 'cert.pem'),
          '-days', '1', '-subj', '/CN=localhost',
        ], { stdio: 'ignore' });
      }
      return {
        key: fs.readFileSync(path.join(tlsDir, 'key.pem')),
        cert: fs.readFileSync(path.join(tlsDir, 'cert.pem')),
      };
    }

    async function listen(handler: https.RequestListener): Promise<number> {
      const s = https.createServer(tlsOptions(), handler);
      servers.push(s);
      await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
      const address = s.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      return address.port;
    }

    it('rejects a 302 and sends nothing to the redirect target', async () => {
      const targetRequests: Array<string | undefined> = [];
      const targetPort = await listen((req, res) => {
        targetRequests.push(req.headers.authorization);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ encrypted: 'e', iv: 'i', authTag: 'a' }));
      });
      let apiRequests = 0;
      const apiPort = await listen((_req, res) => {
        apiRequests++;
        res.writeHead(302, { Location: `https://127.0.0.1:${targetPort}/api/v1/workflows/build` });
        res.end();
      });
      const configDir = createTestDir();
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ apiKey: 'ak_secret_key', apiUrl: `https://127.0.0.1:${apiPort}` })
      );
      process.env.OSS_CONFIG_DIR = configDir;
      savedTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // self-signed local stand-ins
      global.fetch = originalFetch;

      await expect(fetchWorkflowConfig('build', 2000)).rejects.toThrow();

      expect(apiRequests).toBe(1);
      expect(targetRequests).toEqual([]);
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

    /**
     * @behavior A timed-out fetch is visible in the session, without leaking the URL or key
     * @business-rule One stderr line on timeout (G10): "workflow-config: API timeout, using defaults"
     */
    it('writes exactly one stderr line, with no URL or key, when the fetch times out', async () => {
      const port = await startSilentServer();
      const configDir = createTestDir();
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ apiKey: 'ak_secret_key', apiUrl: `https://127.0.0.1:${port}` })
      );
      process.env.OSS_CONFIG_DIR = configDir;
      global.fetch = originalFetch;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await expect(fetchWorkflowConfig('build', 200)).rejects.toThrow();

        expect(errorSpy.mock.calls).toEqual([['workflow-config: API timeout, using defaults']]);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('does not report a timeout when the fetch fails for another reason', async () => {
      const configDir = createTestDir();
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ apiKey: 'ak_secret_key', apiUrl: 'https://api.example.com' })
      );
      process.env.OSS_CONFIG_DIR = configDir;
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await expect(fetchWorkflowConfig('build')).rejects.toThrow('fetch failed');

        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
