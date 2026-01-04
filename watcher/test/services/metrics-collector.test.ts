/**
 * @behavior Metrics collector aggregates workflow telemetry for analytics
 * @acceptance-criteria Session duration, commands used, success rates tracked
 * @business-rule Metrics prove ROI and drive product improvements
 * @boundary Service (MetricsCollector)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Metrics Collector Service', () => {
  let testDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = testDir;
    fs.mkdirSync(path.join(testDir, '.oss'), { recursive: true });
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('session metrics', () => {
    /**
     * @behavior Session duration is tracked from start to end
     * @acceptance-criteria Duration is recorded in milliseconds
     */
    it('should track session duration', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();
      collector.startSession();

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 50));

      collector.endSession();

      const metrics = collector.getSessionMetrics();
      expect(metrics.duration).toBeGreaterThanOrEqual(50);
    });

    /**
     * @behavior Commands executed in session are counted
     * @acceptance-criteria Each command is tracked with success/failure
     */
    it('should count commands executed', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();
      collector.startSession();

      collector.recordCommand('plan', 'success');
      collector.recordCommand('build', 'success');
      collector.recordCommand('ship', 'failure');

      const metrics = collector.getSessionMetrics();
      expect(metrics.commandCount).toBe(3);
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(1);
    });

    /**
     * @behavior Success rate is calculated correctly
     * @acceptance-criteria Success rate = successful / total commands
     */
    it('should calculate success rate', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();
      collector.startSession();

      collector.recordCommand('plan', 'success');
      collector.recordCommand('build', 'success');
      collector.recordCommand('ship', 'failure');
      collector.recordCommand('review', 'success');

      const metrics = collector.getSessionMetrics();
      expect(metrics.successRate).toBe(0.75); // 3/4 = 75%
    });
  });

  describe('command metrics', () => {
    /**
     * @behavior Individual command timing is tracked
     * @acceptance-criteria Each command has start/end time and duration
     */
    it('should track command execution time', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();
      collector.startSession();

      collector.startCommand('build');
      await new Promise(resolve => setTimeout(resolve, 30));
      collector.endCommand('build', 'success');

      const commandMetrics = collector.getCommandMetrics('build');
      expect(commandMetrics.averageDuration).toBeGreaterThanOrEqual(30);
      expect(commandMetrics.count).toBe(1);
    });

    /**
     * @behavior Command usage frequency is tracked
     * @acceptance-criteria Can see which commands are used most
     */
    it('should track command frequency', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();
      collector.startSession();

      collector.recordCommand('build', 'success');
      collector.recordCommand('build', 'success');
      collector.recordCommand('ship', 'success');
      collector.recordCommand('build', 'failure');

      const topCommands = collector.getTopCommands(3);
      expect(topCommands[0].command).toBe('build');
      expect(topCommands[0].count).toBe(3);
      expect(topCommands[1].command).toBe('ship');
    });
  });

  describe('aggregate metrics', () => {
    /**
     * @behavior Daily metrics are aggregated
     * @acceptance-criteria Can get metrics for today, this week, this month
     */
    it('should aggregate daily metrics', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();

      // Simulate multiple sessions
      collector.startSession();
      collector.recordCommand('plan', 'success');
      collector.endSession();

      collector.startSession();
      collector.recordCommand('build', 'success');
      collector.recordCommand('ship', 'success');
      collector.endSession();

      const daily = collector.getDailyMetrics();
      expect(daily.sessionCount).toBe(2);
      expect(daily.totalCommands).toBe(3);
    });

    /**
     * @behavior All-time metrics are available
     * @acceptance-criteria Lifetime totals are tracked
     */
    it('should track all-time metrics', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();
      collector.startSession();
      collector.recordCommand('ideate', 'success');
      collector.endSession();

      const allTime = collector.getAllTimeMetrics();
      expect(allTime.totalSessions).toBeGreaterThanOrEqual(1);
      expect(allTime.totalCommands).toBeGreaterThanOrEqual(1);
    });
  });

  describe('persistence', () => {
    /**
     * @behavior Metrics are persisted to disk
     * @acceptance-criteria Metrics survive process restarts
     */
    it('should persist metrics to disk', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector1 = new MetricsCollector();
      collector1.startSession();
      collector1.recordCommand('build', 'success');
      collector1.endSession();
      collector1.save();

      // Create new instance
      const collector2 = new MetricsCollector();
      collector2.load();

      const allTime = collector2.getAllTimeMetrics();
      expect(allTime.totalCommands).toBeGreaterThanOrEqual(1);
    });

    /**
     * @behavior Old metrics are archived, not deleted
     * @acceptance-criteria Metrics older than 30 days are archived
     */
    it('should have configurable retention period', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector({ retentionDays: 30 });
      expect(collector.getRetentionDays()).toBe(30);
    });
  });

  describe('TDD phase tracking', () => {
    /**
     * @behavior TDD phase transitions are tracked
     * @acceptance-criteria RED → GREEN → REFACTOR cycle is measured
     */
    it('should track TDD phase time', async () => {
      const { MetricsCollector } = await import('../../src/services/metrics-collector');

      const collector = new MetricsCollector();
      collector.startSession();

      collector.startTddPhase('red');
      await new Promise(resolve => setTimeout(resolve, 20));
      collector.endTddPhase('red');

      collector.startTddPhase('green');
      await new Promise(resolve => setTimeout(resolve, 30));
      collector.endTddPhase('green');

      const tddMetrics = collector.getTddMetrics();
      expect(tddMetrics.redPhaseTime).toBeGreaterThanOrEqual(20);
      expect(tddMetrics.greenPhaseTime).toBeGreaterThanOrEqual(30);
    });
  });
});
