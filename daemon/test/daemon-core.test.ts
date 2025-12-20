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

  /**
   * @behavior Daemon runs a monitoring loop periodically
   * @acceptance-criteria AC-DAEMON-002
   * @business-rule DAEMON-002 - Supervisor must continuously monitor
   * @boundary Timer/Interval
   */
  describe('Monitoring Run Loop', () => {
    it('should start a monitoring loop that runs periodically', async () => {
      // Use a shorter interval for testing
      const fastConfig: DaemonConfig = {
        ...config,
        checkIntervalMs: 100, // 100ms for fast test
      };
      const fastDaemon = new OssDaemon(fastConfig);

      await fastDaemon.start();

      expect(fastDaemon.isRunning()).toBe(true);

      // Wait for at least 2 ticks
      await new Promise(r => setTimeout(r, 250));

      expect(fastDaemon.getTickCount()).toBeGreaterThan(0);

      await fastDaemon.stop();
    });

    it('should stop the monitoring loop on stop()', async () => {
      const fastConfig: DaemonConfig = {
        ...config,
        checkIntervalMs: 100,
      };
      const fastDaemon = new OssDaemon(fastConfig);

      await fastDaemon.start();
      const tickCountBefore = fastDaemon.getTickCount();

      await fastDaemon.stop();

      // Wait to ensure no more ticks happen
      await new Promise(r => setTimeout(r, 200));

      const tickCountAfter = fastDaemon.getTickCount();
      expect(tickCountAfter).toBe(tickCountBefore);
      expect(fastDaemon.isRunning()).toBe(false);
    });

    /**
     * @behavior Daemon writes heartbeat to workflow-state.json
     * @acceptance-criteria AC-DAEMON-003
     * @business-rule DAEMON-003 - Status line must know daemon is alive
     */
    it('should write heartbeat timestamp to workflow-state.json', async () => {
      const fastConfig: DaemonConfig = {
        ...config,
        checkIntervalMs: 100,
      };
      const fastDaemon = new OssDaemon(fastConfig);

      await fastDaemon.start();

      // Wait for at least one tick
      await new Promise(r => setTimeout(r, 150));

      const statePath = path.join(testDir, 'workflow-state.json');
      const stateContent = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(stateContent);

      expect(state.daemonHeartbeat).toBeDefined();
      expect(Date.now() - new Date(state.daemonHeartbeat).getTime()).toBeLessThan(2000);

      await fastDaemon.stop();
    });
  });

  /**
   * @behavior Daemon prioritizes issues by severity
   * @acceptance-criteria AC-DAEMON-012
   * @business-rule DAEMON-012 - Critical issues must be shown first
   */
  describe('Issue Prioritization', () => {
    it('should report highest priority issue (error > warning > info)', () => {
      const issues = [
        { type: 'stale_phase', severity: 'info' as const, message: 'Info' },
        { type: 'hung_process', severity: 'warning' as const, message: 'Warning' },
        { type: 'branch_violation', severity: 'error' as const, message: 'Error' }
      ];

      const topIssue = OssDaemon.prioritizeIssues(issues);

      expect(topIssue?.severity).toBe('error');
      expect(topIssue?.type).toBe('branch_violation');
    });

    it('should return null for empty issues array', () => {
      const topIssue = OssDaemon.prioritizeIssues([]);

      expect(topIssue).toBeNull();
    });

    it('should return first issue when all same severity', () => {
      const issues = [
        { type: 'issue1', severity: 'warning' as const, message: 'First' },
        { type: 'issue2', severity: 'warning' as const, message: 'Second' }
      ];

      const topIssue = OssDaemon.prioritizeIssues(issues);

      expect(topIssue?.type).toBe('issue1');
    });
  });
});
