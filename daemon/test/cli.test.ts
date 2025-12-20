/**
 * @behavior CLI provides start/stop/status commands for daemon
 * @acceptance-criteria AC-DAEMON-007
 * @business-rule DAEMON-007
 * @boundary User Interface
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { DaemonCli, CliCommand } from '../src/cli.js';

describe('DaemonCli', () => {
  const testDir = path.join(tmpdir(), `oss-daemon-cli-test-${Date.now()}`);
  let cli: DaemonCli;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    cli = new DaemonCli({ ossDir: testDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Command Parsing', () => {
    it('should parse start command', () => {
      const cmd = cli.parseCommand(['start']);

      expect(cmd.action).toBe('start');
    });

    it('should parse stop command', () => {
      const cmd = cli.parseCommand(['stop']);

      expect(cmd.action).toBe('stop');
    });

    it('should parse status command', () => {
      const cmd = cli.parseCommand(['status']);

      expect(cmd.action).toBe('status');
    });

    it('should default to status if no command given', () => {
      const cmd = cli.parseCommand([]);

      expect(cmd.action).toBe('status');
    });

    it('should parse --daemonize flag', () => {
      const cmd = cli.parseCommand(['start', '--daemonize']);

      expect(cmd.action).toBe('start');
      expect(cmd.flags.daemonize).toBe(true);
    });

    it('should parse --dry-run flag', () => {
      const cmd = cli.parseCommand(['start', '--dry-run']);

      expect(cmd.action).toBe('start');
      expect(cmd.flags.dryRun).toBe(true);
    });
  });

  describe('Status Command', () => {
    it('should return status when daemon is not running', async () => {
      const result = await cli.execute(['status']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('not running');
    });

    it('should show running status when PID file exists', async () => {
      // Create a mock PID file
      await fs.writeFile(path.join(testDir, 'daemon.pid'), String(process.pid));

      const result = await cli.execute(['status']);

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/running|pid/i);
    });
  });

  describe('Help Command', () => {
    it('should show help with --help flag', async () => {
      const result = await cli.execute(['--help']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Usage');
      expect(result.output).toContain('start');
      expect(result.output).toContain('stop');
      expect(result.output).toContain('status');
    });

    it('should show version with --version flag', async () => {
      const result = await cli.execute(['--version']);

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Install Command', () => {
    it('should have install command for launchd setup', async () => {
      const cmd = cli.parseCommand(['install']);

      expect(cmd.action).toBe('install');
    });

    it('should have uninstall command', async () => {
      const cmd = cli.parseCommand(['uninstall']);

      expect(cmd.action).toBe('uninstall');
    });
  });

  /**
   * @behavior CLI keeps process alive in foreground mode
   * @acceptance-criteria AC-DAEMON-008
   * @business-rule DAEMON-008 - Foreground mode must stay running until signaled
   */
  describe('Foreground Mode', () => {
    it('should return a promise that stays pending in foreground mode', async () => {
      // Execute start in foreground mode (no --daemonize)
      const startPromise = cli.execute(['start']);

      // The promise should not resolve immediately
      const timeoutPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('timeout'), 200);
      });

      // Race between start and timeout - timeout should win
      const result = await Promise.race([
        startPromise.then(() => 'resolved'),
        timeoutPromise
      ]);

      expect(result).toBe('timeout');

      // Clean up by stopping
      await cli.execute(['stop']);
    });

    it('should return immediately in daemonize mode', async () => {
      // Execute start in daemonize mode
      const result = await cli.execute(['start', '--daemonize']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('started');

      // Clean up
      await cli.execute(['stop']);
    });
  });
});
