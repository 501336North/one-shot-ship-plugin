/**
 * @behavior Monitor tracks system memory and CPU usage
 * @acceptance-criteria AC-DAEMON-004
 * @business-rule DAEMON-004
 * @boundary System Resources
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { ResourceMonitor, ResourceUsage, ResourceThresholds } from '../src/resource-monitor.js';

describe('ResourceMonitor', () => {
  const testDir = path.join(tmpdir(), `oss-resource-monitor-test-${Date.now()}`);
  let monitor: ResourceMonitor;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    monitor = new ResourceMonitor();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Memory Usage', () => {
    it('should track system memory usage', () => {
      const usage = monitor.getMemoryUsage();

      expect(usage.totalMB).toBeGreaterThan(0);
      expect(usage.usedMB).toBeGreaterThan(0);
      expect(usage.freeMB).toBeGreaterThanOrEqual(0);
      expect(usage.usedPercent).toBeGreaterThan(0);
      expect(usage.usedPercent).toBeLessThanOrEqual(100);
    });

    it('should calculate memory percentage correctly', () => {
      const usage = monitor.getMemoryUsage();

      const calculatedPercent = (usage.usedMB / usage.totalMB) * 100;
      expect(Math.abs(usage.usedPercent - calculatedPercent)).toBeLessThan(1);
    });
  });

  describe('CPU Usage', () => {
    it('should track system CPU usage', async () => {
      // CPU measurement requires sampling over time
      const usage = await monitor.getCpuUsage(100); // 100ms sample

      expect(usage.percent).toBeGreaterThanOrEqual(0);
      expect(usage.percent).toBeLessThanOrEqual(100);
      expect(usage.cores).toBeGreaterThan(0);
    });
  });

  describe('Resource Thresholds', () => {
    it('should alert when memory exceeds threshold', () => {
      const usage: ResourceUsage = {
        memory: { totalMB: 16000, usedMB: 15000, freeMB: 1000, usedPercent: 93.75 },
        cpu: { percent: 50, cores: 8 }
      };

      const thresholds: ResourceThresholds = {
        memoryPercent: 90,
        cpuPercent: 95
      };

      const alerts = monitor.checkThresholds(usage, thresholds);

      expect(alerts).toContainEqual(expect.objectContaining({
        type: 'memory',
        message: expect.stringContaining('93.75%')
      }));
    });

    it('should alert when CPU exceeds threshold', () => {
      const usage: ResourceUsage = {
        memory: { totalMB: 16000, usedMB: 8000, freeMB: 8000, usedPercent: 50 },
        cpu: { percent: 98, cores: 8 }
      };

      const thresholds: ResourceThresholds = {
        memoryPercent: 90,
        cpuPercent: 95
      };

      const alerts = monitor.checkThresholds(usage, thresholds);

      expect(alerts).toContainEqual(expect.objectContaining({
        type: 'cpu',
        message: expect.stringContaining('98%')
      }));
    });

    it('should not alert when usage is within thresholds', () => {
      const usage: ResourceUsage = {
        memory: { totalMB: 16000, usedMB: 8000, freeMB: 8000, usedPercent: 50 },
        cpu: { percent: 30, cores: 8 }
      };

      const thresholds: ResourceThresholds = {
        memoryPercent: 90,
        cpuPercent: 95
      };

      const alerts = monitor.checkThresholds(usage, thresholds);

      expect(alerts).toHaveLength(0);
    });
  });

  describe('Full Resource Usage', () => {
    it('should return complete resource usage snapshot', async () => {
      const usage = await monitor.getResourceUsage();

      expect(usage.memory).toBeDefined();
      expect(usage.cpu).toBeDefined();
      expect(usage.memory.totalMB).toBeGreaterThan(0);
      expect(usage.cpu.cores).toBeGreaterThan(0);
    });
  });
});
