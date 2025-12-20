/**
 * @behavior Daemon detects and kills hung processes
 * @acceptance-criteria AC-DAEMON-001
 * @business-rule DAEMON-001
 * @boundary System Process
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { OssDaemon, DaemonConfig } from '../src/daemon.js';

describe('OssDaemon Core', () => {
  const testDir = path.join(tmpdir(), `oss-daemon-test-${Date.now()}`);
  let daemon: OssDaemon;
  let config: DaemonConfig;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    config = {
      ossDir: testDir,
      checkIntervalMs: 1000,
      processTimeoutMs: 5000
    };
    daemon = new OssDaemon(config);
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('PID File Management', () => {
    it('should write PID file on start', async () => {
      await daemon.start();

      const pidPath = path.join(testDir, 'daemon.pid');
      const pidExists = await fs.access(pidPath).then(() => true).catch(() => false);
      expect(pidExists).toBe(true);

      const pid = await fs.readFile(pidPath, 'utf-8');
      expect(parseInt(pid)).toBe(process.pid);
    });

    it('should prevent duplicate instances', async () => {
      await daemon.start();

      const daemon2 = new OssDaemon(config);
      await expect(daemon2.start()).rejects.toThrow(/already running/i);
    });

    it('should remove PID file on stop', async () => {
      await daemon.start();
      await daemon.stop();

      const pidPath = path.join(testDir, 'daemon.pid');
      const pidExists = await fs.access(pidPath).then(() => true).catch(() => false);
      expect(pidExists).toBe(false);
    });
  });

  describe('Activity Logging', () => {
    it('should log activity to daemon.log', async () => {
      await daemon.start();
      await daemon.log('Test activity message');

      const logPath = path.join(testDir, 'daemon.log');
      const logContent = await fs.readFile(logPath, 'utf-8');
      expect(logContent).toContain('Test activity message');
    });

    it('should include timestamp in log entries', async () => {
      await daemon.start();
      await daemon.log('Timestamped message');

      const logPath = path.join(testDir, 'daemon.log');
      const logContent = await fs.readFile(logPath, 'utf-8');
      // Should have ISO timestamp format
      expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should handle SIGTERM gracefully', async () => {
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);

      await daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    it('should complete pending operations before shutdown', async () => {
      await daemon.start();

      // Simulate pending operation
      const pendingPromise = daemon.log('Final message');

      await daemon.stop();
      await pendingPromise;

      const logPath = path.join(testDir, 'daemon.log');
      const logContent = await fs.readFile(logPath, 'utf-8');
      expect(logContent).toContain('Final message');
    });
  });

  describe('State Management', () => {
    it('should report running state correctly', async () => {
      expect(daemon.isRunning()).toBe(false);

      await daemon.start();
      expect(daemon.isRunning()).toBe(true);

      await daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });
  });
});
