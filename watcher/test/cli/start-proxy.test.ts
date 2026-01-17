/**
 * @behavior start-proxy CLI starts ModelProxy server for agent model routing
 * @acceptance-criteria AC-SP.1 through AC-SP.18
 * @boundary CLI
 *
 * Usage:
 *   npx tsx src/cli/start-proxy.ts --model ollama/codellama
 *   npx tsx src/cli/start-proxy.ts --model ollama/codellama --port 3457
 *   npx tsx src/cli/start-proxy.ts --model openrouter/claude-3-haiku --api-key sk-or-xxx
 *   npx tsx src/cli/start-proxy.ts --model ollama/codellama --background
 *
 * Output (JSON):
 *   {"port": 3456, "pid": 12345, "model": "ollama/codellama", "background": false}
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as childProcess from 'child_process';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

// Don't mock child_process entirely - we need spawn to work for background mode
// Instead we'll selectively mock what we need

describe('start-proxy CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockServer: { listen: Mock; close: Mock; address: Mock; on: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir to return a predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default: no config file exists
    (fs.existsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockReturnValue('{}');
    (fs.writeFileSync as Mock).mockImplementation(() => {});
    (fs.unlinkSync as Mock).mockImplementation(() => {});
    (fs.mkdirSync as Mock).mockImplementation(() => {});

    // Mock server for testing
    mockServer = {
      listen: vi.fn((port: number, host: string, callback: () => void) => {
        callback();
      }),
      close: vi.fn((callback: () => void) => {
        callback();
      }),
      address: vi.fn(() => ({ port: 3456, address: '127.0.0.1' })),
      on: vi.fn(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Task 3.1: Define CLI Arguments (5 tests)
  // ============================================================================

  /**
   * @behavior AC-SP.1: CLI requires --model argument
   */
  describe('CLI arguments', () => {
    it('should require --model argument', async () => {
      const { parseCliArgs } = await import('../../src/cli/start-proxy.js');

      const result = parseCliArgs([]);

      expect(result.model).toBeUndefined();
      expect(result.errors).toContain('--model is required');
    });

    it('should accept --port argument (default 3456)', async () => {
      const { parseCliArgs } = await import('../../src/cli/start-proxy.js');

      // Without --port, should default to 3456
      const result1 = parseCliArgs(['--model', 'ollama/codellama']);
      expect(result1.port).toBe(3456);

      // With --port, should use specified port
      const result2 = parseCliArgs(['--model', 'ollama/codellama', '--port', '4567']);
      expect(result2.port).toBe(4567);
    });

    it('should accept --api-key argument', async () => {
      const { parseCliArgs } = await import('../../src/cli/start-proxy.js');

      const result = parseCliArgs([
        '--model', 'openrouter/anthropic/claude-3-haiku',
        '--api-key', 'sk-or-test123',
      ]);

      expect(result.apiKey).toBe('sk-or-test123');
    });

    it('should accept --background flag', async () => {
      const { parseCliArgs } = await import('../../src/cli/start-proxy.js');

      // Without --background
      const result1 = parseCliArgs(['--model', 'ollama/codellama']);
      expect(result1.background).toBe(false);

      // With --background
      const result2 = parseCliArgs(['--model', 'ollama/codellama', '--background']);
      expect(result2.background).toBe(true);
    });

    it('should show help with --help', async () => {
      const { parseCliArgs } = await import('../../src/cli/start-proxy.js');

      const result = parseCliArgs(['--help']);

      expect(result.showHelp).toBe(true);
    });
  });

  // ============================================================================
  // Task 3.2: Implement Proxy Startup (5 tests)
  // ============================================================================

  /**
   * @behavior AC-SP.6-10: Proxy startup
   */
  describe('proxy startup', () => {
    it('should start ModelProxy on specified port', async () => {
      const { startProxy } = await import('../../src/cli/start-proxy.js');

      // Create a mock ModelProxy that we control
      const mockProxy = {
        start: vi.fn().mockResolvedValue(undefined),
        getPort: vi.fn().mockReturnValue(3456),
        shutdown: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      const result = await startProxy({
        model: 'ollama/codellama',
        port: 3456,
        background: false,
        _testProxy: mockProxy,
      });

      expect(mockProxy.start).toHaveBeenCalled();
      expect(result.port).toBe(3456);
    });

    it('should output JSON with port and pid', async () => {
      const { formatOutput } = await import('../../src/cli/start-proxy.js');

      const output = formatOutput({
        port: 3456,
        pid: 12345,
        model: 'ollama/codellama',
        background: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed).toEqual({
        port: 3456,
        pid: 12345,
        model: 'ollama/codellama',
        background: false,
      });
    });

    it('should handle port already in use', async () => {
      const { startProxy } = await import('../../src/cli/start-proxy.js');

      // Create a mock that throws EADDRINUSE error
      const mockProxy = {
        start: vi.fn().mockRejectedValue(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })),
        getPort: vi.fn().mockReturnValue(0),
        shutdown: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(false),
      };

      const result = await startProxy({
        model: 'ollama/codellama',
        port: 3456,
        background: false,
        _testProxy: mockProxy,
      });

      expect(result.error).toContain('Port 3456 is already in use');
    });

    it('should validate model format', async () => {
      const { validateModel } = await import('../../src/cli/start-proxy.js');

      // Valid formats
      expect(validateModel('ollama/codellama')).toEqual({ valid: true });
      expect(validateModel('openrouter/anthropic/claude-3-haiku')).toEqual({ valid: true });

      // Invalid formats
      expect(validateModel('invalid')).toEqual({ valid: false, error: 'Invalid model format. Expected: provider/model-name' });
      expect(validateModel('unknown/model')).toEqual({ valid: false, error: 'Unsupported provider: unknown. Supported: ollama, openrouter' });
      // Gemini is not supported (no GeminiHandler implemented yet)
      expect(validateModel('gemini/gemini-2.0-flash')).toEqual({ valid: false, error: 'Unsupported provider: gemini. Supported: ollama, openrouter' });
    });

    it('should load apiKey from config if not provided', async () => {
      // Set up config file with API key
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        return p.includes('config.json');
      });
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        openrouterApiKey: 'sk-or-from-config',
      }));

      const { loadApiKeyFromConfig } = await import('../../src/cli/start-proxy.js');

      const apiKey = loadApiKeyFromConfig('openrouter');

      expect(apiKey).toBe('sk-or-from-config');
    });
  });

  // ============================================================================
  // Task 3.3: Implement Background Mode (4 tests)
  // ============================================================================

  /**
   * @behavior AC-SP.11-14: Background mode
   */
  describe('background mode', () => {
    it('should detach when --background flag set', async () => {
      const { startProxyBackground } = await import('../../src/cli/start-proxy.js');

      // Mock child process
      const mockChild = {
        pid: 54321,
        unref: vi.fn(),
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };

      // Create mock spawn function
      const mockSpawn = vi.fn().mockReturnValue(mockChild);

      const result = await startProxyBackground({
        model: 'ollama/codellama',
        port: 3456,
        _testSpawn: mockSpawn as unknown as typeof childProcess.spawn,
      });

      expect(mockSpawn).toHaveBeenCalled();
      expect(mockChild.unref).toHaveBeenCalled();
      expect(result.background).toBe(true);
      expect(result.pid).toBe(54321);
    });

    it('should write pid file to .oss/proxy.pid', async () => {
      const { writePidFile, getPidFilePath } = await import('../../src/cli/start-proxy.js');

      // Mock home directory
      (os.homedir as Mock).mockReturnValue('/home/testuser');

      const pidPath = getPidFilePath();
      expect(pidPath).toBe('/home/testuser/.oss/proxy.pid');

      writePidFile(12345);

      expect(fs.mkdirSync).toHaveBeenCalledWith('/home/testuser/.oss', { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith('/home/testuser/.oss/proxy.pid', '12345');
    });

    it('should allow multiple proxies on different ports', async () => {
      const { writePidFile, getPidFilePath } = await import('../../src/cli/start-proxy.js');

      // When a port is specified, the PID file should include the port
      const pidPath = getPidFilePath(3457);
      expect(pidPath).toBe('/home/testuser/.oss/proxy-3457.pid');

      writePidFile(12345, 3457);

      expect(fs.writeFileSync).toHaveBeenCalledWith('/home/testuser/.oss/proxy-3457.pid', '12345');
    });

    it('should output JSON with background: true', async () => {
      const { formatOutput } = await import('../../src/cli/start-proxy.js');

      const output = formatOutput({
        port: 3456,
        pid: 54321,
        model: 'ollama/codellama',
        background: true,
      });

      const parsed = JSON.parse(output);
      expect(parsed.background).toBe(true);
      expect(parsed.pid).toBe(54321);
    });
  });

  // ============================================================================
  // Task 3.4: Implement Proxy Shutdown (4 tests)
  // ============================================================================

  /**
   * @behavior AC-SP.15-18: Graceful shutdown
   */
  describe('proxy shutdown', () => {
    it('should handle SIGTERM gracefully', async () => {
      const { createShutdownHandler } = await import('../../src/cli/start-proxy.js');

      const mockProxy = {
        shutdown: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      const handler = createShutdownHandler(mockProxy);

      // Simulate SIGTERM
      await handler('SIGTERM');

      expect(mockProxy.shutdown).toHaveBeenCalled();
    });

    it('should handle SIGINT gracefully', async () => {
      const { createShutdownHandler } = await import('../../src/cli/start-proxy.js');

      const mockProxy = {
        shutdown: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      const handler = createShutdownHandler(mockProxy);

      // Simulate SIGINT
      await handler('SIGINT');

      expect(mockProxy.shutdown).toHaveBeenCalled();
    });

    it('should clean up pid file on shutdown', async () => {
      const { cleanupPidFile, getPidFilePath } = await import('../../src/cli/start-proxy.js');

      // Set up mock to say file exists
      (fs.existsSync as Mock).mockReturnValue(true);

      cleanupPidFile();

      expect(fs.unlinkSync).toHaveBeenCalledWith('/home/testuser/.oss/proxy.pid');
    });

    it('should close all connections before exit', async () => {
      const { createShutdownHandler } = await import('../../src/cli/start-proxy.js');

      const mockProxy = {
        shutdown: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      const cleanupCalled = vi.fn();

      const handler = createShutdownHandler(mockProxy, cleanupCalled);

      await handler('SIGTERM');

      // shutdown should be called first (closes connections), then cleanup
      expect(mockProxy.shutdown).toHaveBeenCalled();
      expect(cleanupCalled).toHaveBeenCalled();
    });
  });
});
