/**
 * @behavior Health checks run on a configurable schedule
 * @acceptance-criteria AC-DAEMON-006
 * @business-rule DAEMON-006
 * @boundary System Scheduler
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { HealthCheckScheduler, SchedulerConfig, HealthCheckResult } from '../src/health-check-scheduler.js';

describe('HealthCheckScheduler', () => {
  const testDir = path.join(tmpdir(), `oss-healthcheck-test-${Date.now()}`);
  let scheduler: HealthCheckScheduler;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    scheduler = new HealthCheckScheduler({
      ossDir: testDir,
      intervalMs: 1000,  // 1 second for tests
      healthCheckCommand: 'echo "health check ok"'
    });
  });

  afterEach(async () => {
    scheduler.stop();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Configuration', () => {
    it('should accept interval configuration', () => {
      const config = scheduler.getConfig();

      expect(config.intervalMs).toBe(1000);
    });

    it('should accept health check command', () => {
      const config = scheduler.getConfig();

      expect(config.healthCheckCommand).toBe('echo "health check ok"');
    });

    it('should have default interval of 5 minutes', () => {
      const defaultScheduler = new HealthCheckScheduler({
        ossDir: testDir
      });

      expect(defaultScheduler.getConfig().intervalMs).toBe(5 * 60 * 1000);
    });
  });

  describe('Health Check Execution', () => {
    it('should run health check and return result', async () => {
      const result = await scheduler.runHealthCheck();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('duration');
    });

    it('should capture health check output', async () => {
      const result = await scheduler.runHealthCheck();

      expect(result.success).toBe(true);
      expect(result.output).toContain('health check ok');
    });

    it('should detect failed health checks', async () => {
      const failScheduler = new HealthCheckScheduler({
        ossDir: testDir,
        healthCheckCommand: 'exit 1'
      });

      const result = await failScheduler.runHealthCheck();

      expect(result.success).toBe(false);
    });
  });

  describe('Result Logging', () => {
    it('should log health check results to file', async () => {
      await scheduler.runHealthCheck();

      const logPath = path.join(testDir, 'health-check.log');
      const logExists = await fs.access(logPath).then(() => true).catch(() => false);

      expect(logExists).toBe(true);
    });

    it('should include timestamp in log', async () => {
      await scheduler.runHealthCheck();

      const logPath = path.join(testDir, 'health-check.log');
      const logContent = await fs.readFile(logPath, 'utf-8');

      // Check for ISO timestamp format
      expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Scheduler Lifecycle', () => {
    it('should start scheduling health checks', () => {
      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);
    });

    it('should stop scheduling', () => {
      scheduler.start();
      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });

    it('should not start twice', () => {
      scheduler.start();
      scheduler.start();

      // Should not throw, just keep running
      expect(scheduler.isRunning()).toBe(true);
    });
  });

  describe('Last Check Status', () => {
    it('should track last check result', async () => {
      await scheduler.runHealthCheck();

      const lastResult = scheduler.getLastResult();

      expect(lastResult).not.toBeNull();
      expect(lastResult?.success).toBe(true);
    });

    it('should return null if no check has run', () => {
      const lastResult = scheduler.getLastResult();

      expect(lastResult).toBeNull();
    });
  });
});
