/**
 * @behavior Analytics formatter creates human-readable metrics display
 * @acceptance-criteria Metrics are formatted for terminal output
 * @business-rule Dashboard provides visibility into workflow effectiveness
 * @boundary Service (AnalyticsFormatter)
 */

import { describe, it, expect } from 'vitest';

describe('Analytics Formatter Service', () => {
  describe('formatDashboard', () => {
    /**
     * @behavior Dashboard shows session summary
     * @acceptance-criteria Session count, duration, success rate displayed
     */
    it('should format session summary', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      const output = formatter.formatDashboard({
        sessionCount: 5,
        totalCommands: 25,
        successRate: 0.92,
        averageSessionDuration: 1800000, // 30 minutes in ms
      });

      // Strip ANSI codes for content verification
      const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('Sessions: 5');
      expect(stripped).toContain('Commands: 25');
      expect(stripped).toContain('92%');
      expect(stripped).toContain('30m'); // formatted duration
    });

    /**
     * @behavior Dashboard shows top commands
     * @acceptance-criteria Most used commands are listed with counts
     */
    it('should format top commands', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      const output = formatter.formatTopCommands([
        { command: 'build', count: 15 },
        { command: 'ship', count: 8 },
        { command: 'plan', count: 5 },
      ]);

      expect(output).toContain('build');
      expect(output).toContain('15');
      expect(output).toContain('ship');
      expect(output).toContain('8');
    });
  });

  describe('formatDuration', () => {
    /**
     * @behavior Duration is formatted as human-readable string
     * @acceptance-criteria Shows hours, minutes, seconds as appropriate
     */
    it('should format short durations as seconds', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      expect(formatter.formatDuration(5000)).toBe('5s');
      expect(formatter.formatDuration(45000)).toBe('45s');
    });

    it('should format medium durations as minutes', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      expect(formatter.formatDuration(60000)).toBe('1m');
      expect(formatter.formatDuration(90000)).toBe('1m 30s');
      expect(formatter.formatDuration(1800000)).toBe('30m');
    });

    it('should format long durations as hours', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      expect(formatter.formatDuration(3600000)).toBe('1h');
      expect(formatter.formatDuration(5400000)).toBe('1h 30m');
    });
  });

  describe('formatSuccessRate', () => {
    /**
     * @behavior Success rate is formatted as percentage with color
     * @acceptance-criteria Green for >90%, yellow for 70-90%, red for <70%
     */
    it('should format high success rate in green', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      const output = formatter.formatSuccessRate(0.95);
      expect(output).toContain('95%');
      expect(output).toContain('\x1b[32m'); // Green ANSI code
    });

    it('should format medium success rate in yellow', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      const output = formatter.formatSuccessRate(0.8);
      expect(output).toContain('80%');
      expect(output).toContain('\x1b[33m'); // Yellow ANSI code
    });

    it('should format low success rate in red', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      const output = formatter.formatSuccessRate(0.5);
      expect(output).toContain('50%');
      expect(output).toContain('\x1b[31m'); // Red ANSI code
    });
  });

  describe('formatTddMetrics', () => {
    /**
     * @behavior TDD phase breakdown is displayed
     * @acceptance-criteria RED, GREEN, REFACTOR time and ratios shown
     */
    it('should format TDD phase metrics', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      const output = formatter.formatTddMetrics({
        redPhaseTime: 60000,   // 1 minute
        greenPhaseTime: 120000, // 2 minutes
        refactorPhaseTime: 30000, // 30 seconds
        cycleCount: 5,
      });

      expect(output).toContain('RED');
      expect(output).toContain('GREEN');
      expect(output).toContain('REFACTOR');
      expect(output).toContain('Cycles: 5');
    });
  });

  describe('formatCompactSummary', () => {
    /**
     * @behavior Compact one-line summary for status line
     * @acceptance-criteria Shows key metrics in minimal space
     */
    it('should format compact summary', async () => {
      const { AnalyticsFormatter } = await import('../../src/services/analytics-formatter');

      const formatter = new AnalyticsFormatter();
      const output = formatter.formatCompactSummary({
        commandCount: 10,
        successRate: 0.9,
        duration: 1800000,
      });

      expect(output).toContain('10 cmds');
      expect(output).toContain('90%');
      expect(output).toContain('30m');
    });
  });
});
