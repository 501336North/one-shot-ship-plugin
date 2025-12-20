/**
 * @behavior Hung processes are killed after timeout
 * @acceptance-criteria AC-DAEMON-003
 * @business-rule DAEMON-003
 * @boundary System Process
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { HungProcessKiller, KillResult, TimeoutConfig } from '../src/hung-process-killer.js';
import { ProcessInfo } from '../src/process-monitor.js';

describe('HungProcessKiller', () => {
  const testDir = path.join(tmpdir(), `oss-hung-killer-test-${Date.now()}`);
  let killer: HungProcessKiller;
  let logFile: string;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    logFile = path.join(testDir, 'kills.log');
    killer = new HungProcessKiller({ logFile });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Timeout Configuration', () => {
    it('should have default timeout of 5 minutes for vitest', () => {
      const config = killer.getTimeoutConfig('vitest');
      expect(config.timeoutMs).toBe(5 * 60 * 1000);
    });

    it('should have default timeout of 10 minutes for npm test', () => {
      const config = killer.getTimeoutConfig('npm-test');
      expect(config.timeoutMs).toBe(10 * 60 * 1000);
    });

    it('should allow custom timeout configuration', () => {
      killer = new HungProcessKiller({
        logFile,
        timeouts: {
          vitest: 2 * 60 * 1000,
          'npm-test': 5 * 60 * 1000
        }
      });

      expect(killer.getTimeoutConfig('vitest').timeoutMs).toBe(2 * 60 * 1000);
      expect(killer.getTimeoutConfig('npm-test').timeoutMs).toBe(5 * 60 * 1000);
    });
  });

  describe('Kill Decision', () => {
    it('should decide to kill process exceeding vitest timeout', () => {
      const hungProcess: ProcessInfo = {
        pid: 12345,
        command: 'node vitest run',
        startTime: new Date(Date.now() - 6 * 60 * 1000), // 6 minutes ago
        cpuPercent: 90,
        memoryMB: 500
      };

      const shouldKill = killer.shouldKillProcess(hungProcess, 'vitest');
      expect(shouldKill).toBe(true);
    });

    it('should NOT kill process within timeout', () => {
      const youngProcess: ProcessInfo = {
        pid: 12345,
        command: 'node vitest run',
        startTime: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
        cpuPercent: 90,
        memoryMB: 500
      };

      const shouldKill = killer.shouldKillProcess(youngProcess, 'vitest');
      expect(shouldKill).toBe(false);
    });
  });

  describe('Kill Logging', () => {
    it('should log kill action with process details', async () => {
      const process: ProcessInfo = {
        pid: 99999,
        command: 'node vitest run tests/',
        startTime: new Date(Date.now() - 10 * 60 * 1000),
        cpuPercent: 95,
        memoryMB: 800
      };

      await killer.logKill(process, 'vitest', 'exceeded timeout');

      const logContent = await fs.readFile(logFile, 'utf-8');
      expect(logContent).toContain('99999');
      expect(logContent).toContain('vitest');
      expect(logContent).toContain('exceeded timeout');
    });

    it('should include timestamp in kill log', async () => {
      const process: ProcessInfo = {
        pid: 12345,
        command: 'npm test',
        startTime: new Date(),
        cpuPercent: 50,
        memoryMB: 200
      };

      await killer.logKill(process, 'npm-test', 'test reason');

      const logContent = await fs.readFile(logFile, 'utf-8');
      // Check for ISO timestamp format
      expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Kill Execution', () => {
    it('should return success result for mock kill', async () => {
      // We can't actually kill a real process in tests, so we test the interface
      const result = await killer.killProcess(process.pid, true); // dryRun = true

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('pid');
      expect(result.dryRun).toBe(true);
    });

    it('should support dry-run mode', async () => {
      const process: ProcessInfo = {
        pid: 12345,
        command: 'vitest',
        startTime: new Date(Date.now() - 10 * 60 * 1000),
        cpuPercent: 90,
        memoryMB: 500
      };

      const result = await killer.killProcess(process.pid, true);

      expect(result.dryRun).toBe(true);
      expect(result.success).toBe(true);
      expect(result.message).toContain('dry-run');
    });
  });
});
