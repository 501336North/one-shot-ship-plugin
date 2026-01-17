/**
 * SpecMetricsService Tests
 *
 * Tests for the spec metrics service that provides long-term tracking
 * of spec compliance, coverage history, and reconciliation audit trails.
 *
 * @behavior Provides persistent storage for spec metrics
 * @acceptance-criteria AC-METRICS.1 - Load and save metrics to file
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpecMetricsService } from '../../src/services/spec-metrics.js';
import type {
  SpecMetricsFile,
  FeatureMetrics,
  ReconciliationEntry,
} from '../../src/services/spec-reconciler/index.js';

describe('SpecMetricsService', () => {
  let testDir: string;
  let service: SpecMetricsService;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-test-'));
    fs.mkdirSync(path.join(testDir, '.oss'), { recursive: true });
    service = new SpecMetricsService(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('loadMetrics()', () => {
    /**
     * @behavior Reads existing metrics file from disk
     * @acceptance-criteria AC-METRICS.1.1 - Load existing file
     */
    it('reads existing metrics file', async () => {
      // GIVEN: A metrics file exists with data
      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'auth-feature': {
            spec_path: '.oss/dev/active/auth-feature/SPEC.md',
            coverage: {
              components: { total: 5, implemented: 3, ratio: 0.6 },
              criteria: { total: 10, implemented: 8, ratio: 0.8 },
              behaviors: { total: 4, implemented: 4, ratio: 1.0 },
            },
            drift: {
              current_count: 2,
              types: ['structural_missing'],
            },
            history: [
              { date: '2025-01-14', coverage: 0.7, drift_count: 3 },
              { date: '2025-01-15', coverage: 0.8, drift_count: 2 },
            ],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 2.5,
          weekly_reconciliations: 3,
          trend: 'improving',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // WHEN: We load the metrics
      const result = await service.loadMetrics();

      // THEN: The existing data is returned
      expect(result.version).toBe('1.0');
      expect(result.features['auth-feature']).toBeDefined();
      expect(result.features['auth-feature'].coverage.components.ratio).toBe(0.6);
    });

    /**
     * @behavior Returns default metrics when file not found
     * @acceptance-criteria AC-METRICS.1.2 - Handle missing file
     */
    it('returns default when file not found', async () => {
      // GIVEN: No metrics file exists
      // (testDir is empty except for .oss directory)

      // WHEN: We load metrics
      const result = await service.loadMetrics();

      // THEN: Default metrics are returned
      expect(result.version).toBe('1.0');
      expect(result.features).toEqual({});
      expect(result.reconciliations).toEqual([]);
      expect(result.velocity).toEqual({
        weekly_drift_avg: 0,
        weekly_reconciliations: 0,
        trend: 'stable',
      });
    });
  });

  describe('saveMetrics()', () => {
    /**
     * @behavior Writes metrics to file
     * @acceptance-criteria AC-METRICS.1.3 - Persist metrics
     */
    it('writes metrics to file', async () => {
      // GIVEN: Metrics to save
      const metrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'test-feature': {
            spec_path: '.oss/dev/active/test-feature/SPEC.md',
            coverage: {
              components: { total: 3, implemented: 2, ratio: 0.67 },
              criteria: { total: 5, implemented: 4, ratio: 0.8 },
              behaviors: { total: 2, implemented: 2, ratio: 1.0 },
            },
            drift: {
              current_count: 1,
              types: ['behavioral_mismatch'],
            },
            history: [],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 1,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      // WHEN: We save the metrics
      await service.saveMetrics(metrics);

      // THEN: The file is written to disk
      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      expect(fs.existsSync(metricsPath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.features['test-feature']).toBeDefined();
      expect(saved.features['test-feature'].coverage.components.ratio).toBe(0.67);
    });

    /**
     * @behavior Updates timestamp on save
     * @acceptance-criteria AC-METRICS.1.4 - Track update time
     */
    it('updates updated_at timestamp', async () => {
      // GIVEN: Metrics with an old timestamp
      const oldTimestamp = '2025-01-01T00:00:00.000Z';
      const metrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: oldTimestamp,
        features: {},
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      // WHEN: We save the metrics
      const beforeSave = new Date();
      await service.saveMetrics(metrics);
      const afterSave = new Date();

      // THEN: The updated_at is set to a recent timestamp
      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;

      const savedTime = new Date(saved.updated_at);
      expect(savedTime.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());
      expect(savedTime.getTime()).toBeLessThanOrEqual(afterSave.getTime());
    });
  });

  describe('updateCoverage()', () => {
    /**
     * @behavior Adds new history snapshot for a feature
     * @acceptance-criteria AC-METRICS.2.1 - Track coverage over time
     */
    it('adds new snapshot to history', async () => {
      // GIVEN: A feature with existing metrics but no history
      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'my-feature': {
            spec_path: '.oss/dev/active/my-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 2, ratio: 0.5 },
              criteria: { total: 8, implemented: 4, ratio: 0.5 },
              behaviors: { total: 2, implemented: 1, ratio: 0.5 },
            },
            drift: {
              current_count: 2,
              types: ['structural_missing'],
            },
            history: [],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // GIVEN: Updated feature metrics
      const featureMetrics: FeatureMetrics = {
        feature: 'my-feature',
        specPath: '.oss/dev/active/my-feature/SPEC.md',
        coverage: {
          components: { total: 4, implemented: 3, ratio: 0.75 },
          criteria: { total: 8, implemented: 6, ratio: 0.75 },
          behaviors: { total: 2, implemented: 2, ratio: 1.0 },
        },
        drift: {
          count: 1,
          types: ['structural_missing'],
        },
      };

      // WHEN: We update coverage
      await service.updateCoverage('my-feature', featureMetrics);

      // THEN: History has a new entry
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.features['my-feature'].history.length).toBe(1);
      // Overall coverage: (0.75 + 0.75 + 1.0) / 3 = 0.833...
      expect(saved.features['my-feature'].history[0].coverage).toBeCloseTo(0.833, 2);
      expect(saved.features['my-feature'].history[0].drift_count).toBe(1);
    });

    /**
     * @behavior Limits history to 90 entries
     * @acceptance-criteria AC-METRICS.2.2 - Prevent unbounded growth
     */
    it('limits history to 90 entries', async () => {
      // GIVEN: A feature with 90 existing history entries
      const history = Array.from({ length: 90 }, (_, i) => ({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        coverage: 0.5 + i * 0.005,
        drift_count: 10 - Math.floor(i / 10),
      }));

      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'my-feature': {
            spec_path: '.oss/dev/active/my-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 3, ratio: 0.75 },
              criteria: { total: 8, implemented: 6, ratio: 0.75 },
              behaviors: { total: 2, implemented: 2, ratio: 1.0 },
            },
            drift: {
              current_count: 1,
              types: [],
            },
            history,
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // GIVEN: New metrics to add
      const featureMetrics: FeatureMetrics = {
        feature: 'my-feature',
        specPath: '.oss/dev/active/my-feature/SPEC.md',
        coverage: {
          components: { total: 4, implemented: 4, ratio: 1.0 },
          criteria: { total: 8, implemented: 8, ratio: 1.0 },
          behaviors: { total: 2, implemented: 2, ratio: 1.0 },
        },
        drift: {
          count: 0,
          types: [],
        },
      };

      // WHEN: We update coverage
      await service.updateCoverage('my-feature', featureMetrics);

      // THEN: History is still limited to 90 entries (oldest removed)
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.features['my-feature'].history.length).toBe(90);
      // Newest entry should be at the end
      const newest = saved.features['my-feature'].history[89];
      expect(newest.coverage).toBe(1.0);
      expect(newest.drift_count).toBe(0);
    });

    /**
     * @behavior Uses today's date for snapshot
     * @acceptance-criteria AC-METRICS.2.3 - Date tracking
     */
    it('uses today\'s date for snapshot', async () => {
      // GIVEN: A feature with no history
      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'my-feature': {
            spec_path: '.oss/dev/active/my-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 2, ratio: 0.5 },
              criteria: { total: 8, implemented: 4, ratio: 0.5 },
              behaviors: { total: 2, implemented: 1, ratio: 0.5 },
            },
            drift: {
              current_count: 2,
              types: [],
            },
            history: [],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // GIVEN: A mocked date
      const mockDate = new Date('2025-06-15T12:00:00.000Z');
      vi.setSystemTime(mockDate);

      const featureMetrics: FeatureMetrics = {
        feature: 'my-feature',
        specPath: '.oss/dev/active/my-feature/SPEC.md',
        coverage: {
          components: { total: 4, implemented: 3, ratio: 0.75 },
          criteria: { total: 8, implemented: 6, ratio: 0.75 },
          behaviors: { total: 2, implemented: 2, ratio: 1.0 },
        },
        drift: {
          count: 1,
          types: [],
        },
      };

      // WHEN: We update coverage
      await service.updateCoverage('my-feature', featureMetrics);

      // THEN: The date is today
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.features['my-feature'].history[0].date).toBe('2025-06-15');

      vi.useRealTimers();
    });

    /**
     * @behavior Replaces existing entry for same day
     * @acceptance-criteria AC-METRICS.2.4 - Deduplicate daily entries
     */
    it('replaces existing entry for same day', async () => {
      // GIVEN: A feature with a history entry for today
      const mockDate = new Date('2025-06-15T12:00:00.000Z');
      vi.setSystemTime(mockDate);

      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-06-15T08:00:00.000Z',
        features: {
          'my-feature': {
            spec_path: '.oss/dev/active/my-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 2, ratio: 0.5 },
              criteria: { total: 8, implemented: 4, ratio: 0.5 },
              behaviors: { total: 2, implemented: 1, ratio: 0.5 },
            },
            drift: {
              current_count: 2,
              types: [],
            },
            history: [
              { date: '2025-06-14', coverage: 0.4, drift_count: 3 },
              { date: '2025-06-15', coverage: 0.5, drift_count: 2 }, // Today's entry
            ],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // GIVEN: Updated metrics for today
      const featureMetrics: FeatureMetrics = {
        feature: 'my-feature',
        specPath: '.oss/dev/active/my-feature/SPEC.md',
        coverage: {
          components: { total: 4, implemented: 4, ratio: 1.0 },
          criteria: { total: 8, implemented: 8, ratio: 1.0 },
          behaviors: { total: 2, implemented: 2, ratio: 1.0 },
        },
        drift: {
          count: 0,
          types: [],
        },
      };

      // WHEN: We update coverage
      await service.updateCoverage('my-feature', featureMetrics);

      // THEN: Only 2 entries exist (today's entry is replaced, not added)
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.features['my-feature'].history.length).toBe(2);
      // Today's entry should be updated
      const todayEntry = saved.features['my-feature'].history.find((e) => e.date === '2025-06-15');
      expect(todayEntry?.coverage).toBe(1.0);
      expect(todayEntry?.drift_count).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('calculateVelocity()', () => {
    /**
     * @behavior Returns weekly drift average from history
     * @acceptance-criteria AC-METRICS.3.1 - Calculate drift average
     */
    it('returns weekly drift average', async () => {
      // GIVEN: A feature with 7 days of history
      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'my-feature': {
            spec_path: '.oss/dev/active/my-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 3, ratio: 0.75 },
              criteria: { total: 8, implemented: 6, ratio: 0.75 },
              behaviors: { total: 2, implemented: 2, ratio: 1.0 },
            },
            drift: {
              current_count: 1,
              types: [],
            },
            history: [
              { date: '2025-01-09', coverage: 0.5, drift_count: 5 },
              { date: '2025-01-10', coverage: 0.55, drift_count: 4 },
              { date: '2025-01-11', coverage: 0.6, drift_count: 4 },
              { date: '2025-01-12', coverage: 0.65, drift_count: 3 },
              { date: '2025-01-13', coverage: 0.7, drift_count: 3 },
              { date: '2025-01-14', coverage: 0.75, drift_count: 2 },
              { date: '2025-01-15', coverage: 0.8, drift_count: 1 },
            ],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // WHEN: We calculate velocity
      const result = await service.calculateVelocity('my-feature');

      // THEN: Weekly drift average is calculated (5+4+4+3+3+2+1)/7 = 3.14...
      expect(result).not.toBeNull();
      expect(result!.weekly_drift_avg).toBeCloseTo(3.14, 1);
    });

    /**
     * @behavior Determines trend direction based on drift changes
     * @acceptance-criteria AC-METRICS.3.2 - Track improvement trends
     */
    it('determines trend direction', async () => {
      // GIVEN: A feature with declining drift counts (improving)
      const improvingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'improving-feature': {
            spec_path: '.oss/dev/active/improving-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 4, ratio: 1.0 },
              criteria: { total: 8, implemented: 8, ratio: 1.0 },
              behaviors: { total: 2, implemented: 2, ratio: 1.0 },
            },
            drift: {
              current_count: 0,
              types: [],
            },
            history: [
              { date: '2025-01-09', coverage: 0.5, drift_count: 10 },
              { date: '2025-01-10', coverage: 0.55, drift_count: 8 },
              { date: '2025-01-11', coverage: 0.6, drift_count: 6 },
              { date: '2025-01-12', coverage: 0.65, drift_count: 5 },
              { date: '2025-01-13', coverage: 0.7, drift_count: 3 },
              { date: '2025-01-14', coverage: 0.8, drift_count: 2 },
              { date: '2025-01-15', coverage: 0.9, drift_count: 0 },
            ],
          },
          'degrading-feature': {
            spec_path: '.oss/dev/active/degrading-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 2, ratio: 0.5 },
              criteria: { total: 8, implemented: 4, ratio: 0.5 },
              behaviors: { total: 2, implemented: 1, ratio: 0.5 },
            },
            drift: {
              current_count: 8,
              types: ['structural_missing'],
            },
            history: [
              { date: '2025-01-09', coverage: 0.9, drift_count: 0 },
              { date: '2025-01-10', coverage: 0.85, drift_count: 2 },
              { date: '2025-01-11', coverage: 0.8, drift_count: 3 },
              { date: '2025-01-12', coverage: 0.7, drift_count: 4 },
              { date: '2025-01-13', coverage: 0.6, drift_count: 5 },
              { date: '2025-01-14', coverage: 0.55, drift_count: 6 },
              { date: '2025-01-15', coverage: 0.5, drift_count: 8 },
            ],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(improvingMetrics, null, 2));

      // WHEN/THEN: Improving feature shows 'improving' trend
      const improvingResult = await service.calculateVelocity('improving-feature');
      expect(improvingResult!.trend).toBe('improving');

      // WHEN/THEN: Degrading feature shows 'degrading' trend
      const degradingResult = await service.calculateVelocity('degrading-feature');
      expect(degradingResult!.trend).toBe('degrading');
    });

    /**
     * @behavior Returns null when insufficient data (< 7 days)
     * @acceptance-criteria AC-METRICS.3.3 - Handle sparse data
     */
    it('handles insufficient data (returns null when < 7 days)', async () => {
      // GIVEN: A feature with only 3 days of history
      const sparseMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'sparse-feature': {
            spec_path: '.oss/dev/active/sparse-feature/SPEC.md',
            coverage: {
              components: { total: 4, implemented: 2, ratio: 0.5 },
              criteria: { total: 8, implemented: 4, ratio: 0.5 },
              behaviors: { total: 2, implemented: 1, ratio: 0.5 },
            },
            drift: {
              current_count: 3,
              types: [],
            },
            history: [
              { date: '2025-01-13', coverage: 0.4, drift_count: 5 },
              { date: '2025-01-14', coverage: 0.45, drift_count: 4 },
              { date: '2025-01-15', coverage: 0.5, drift_count: 3 },
            ],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(sparseMetrics, null, 2));

      // WHEN: We calculate velocity
      const result = await service.calculateVelocity('sparse-feature');

      // THEN: Returns null due to insufficient data
      expect(result).toBeNull();
    });
  });

  describe('recordReconciliation()', () => {
    /**
     * @behavior Adds entry to reconciliations array
     * @acceptance-criteria AC-METRICS.4.1 - Audit trail
     */
    it('adds entry to reconciliations array', async () => {
      // GIVEN: An empty metrics file
      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {},
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // GIVEN: A reconciliation entry to record
      const entry: ReconciliationEntry = {
        timestamp: '2025-01-15T12:00:00.000Z',
        feature: 'auth-feature',
        drift_type: 'structural_missing',
        action: 'auto_fixed',
        details: 'Checked off AuthService component',
      };

      // WHEN: We record the reconciliation
      await service.recordReconciliation(entry);

      // THEN: The entry is in the reconciliations array
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.reconciliations.length).toBe(1);
      expect(saved.reconciliations[0].feature).toBe('auth-feature');
      expect(saved.reconciliations[0].action).toBe('auto_fixed');
    });

    /**
     * @behavior Includes timestamp, feature, and action
     * @acceptance-criteria AC-METRICS.4.2 - Complete audit data
     */
    it('includes timestamp, feature, action', async () => {
      // GIVEN: An empty metrics file
      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {},
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // GIVEN: A full reconciliation entry
      const entry: ReconciliationEntry = {
        timestamp: '2025-01-15T14:30:00.000Z',
        feature: 'payment-feature',
        drift_type: 'criteria_incomplete',
        action: 'queued',
        details: 'Queued SC-003 for manual review',
      };

      // WHEN: We record the reconciliation
      await service.recordReconciliation(entry);

      // THEN: All fields are preserved
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.reconciliations[0]).toEqual(entry);
    });

    /**
     * @behavior Limits entries to 500
     * @acceptance-criteria AC-METRICS.4.3 - Prevent unbounded growth
     */
    it('limits entries to 500', async () => {
      // GIVEN: A metrics file with 500 existing reconciliation entries
      const existingReconciliations: ReconciliationEntry[] = Array.from(
        { length: 500 },
        (_, i) => ({
          timestamp: `2025-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
          feature: `feature-${i}`,
          drift_type: 'structural_missing' as const,
          action: 'auto_fixed' as const,
          details: `Fixed item ${i}`,
        })
      );

      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {},
        reconciliations: existingReconciliations,
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // GIVEN: A new entry to add
      const newEntry: ReconciliationEntry = {
        timestamp: '2025-01-16T12:00:00.000Z',
        feature: 'new-feature',
        drift_type: 'behavioral_mismatch',
        action: 'auto_fixed',
        details: 'Fixed new drift',
      };

      // WHEN: We record the reconciliation
      await service.recordReconciliation(newEntry);

      // THEN: Still only 500 entries (oldest removed)
      const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as SpecMetricsFile;
      expect(saved.reconciliations.length).toBe(500);

      // Newest entry should be at the end
      const newest = saved.reconciliations[499];
      expect(newest.feature).toBe('new-feature');

      // Oldest entry should be removed
      expect(saved.reconciliations.find((e) => e.feature === 'feature-0')).toBeUndefined();
    });
  });

  // ============================================================================
  // Performance: Metrics Caching
  // ============================================================================

  describe('metrics caching', () => {
    /**
     * @behavior loadMetrics returns cached value if available
     * @acceptance-criteria AC-METRICS-PERF.1 - Cache on read
     */
    it('returns cached metrics on second load', async () => {
      // GIVEN: A metrics file exists
      const existingMetrics: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {
          'cached-feature': {
            spec_path: '.oss/dev/active/cached-feature/SPEC.md',
            coverage: {
              components: { total: 5, implemented: 3, ratio: 0.6 },
              criteria: { total: 10, implemented: 8, ratio: 0.8 },
              behaviors: { total: 4, implemented: 4, ratio: 1.0 },
            },
            drift: {
              current_count: 2,
              types: [],
            },
            history: [],
          },
        },
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      // WHEN: We load metrics twice
      const result1 = await service.loadMetrics();

      // Modify file after first load
      existingMetrics.features['cached-feature'].drift.current_count = 999;
      fs.writeFileSync(metricsPath, JSON.stringify(existingMetrics, null, 2));

      const result2 = await service.loadMetrics();

      // THEN: Second call returns cached value (doesn't see file change)
      expect(result1.features['cached-feature'].drift.current_count).toBe(2);
      expect(result2.features['cached-feature'].drift.current_count).toBe(2);
    });

    /**
     * @behavior saveMetrics updates the cache
     * @acceptance-criteria AC-METRICS-PERF.2 - Cache on write
     */
    it('updates cache when saving metrics', async () => {
      // GIVEN: Initial metrics
      const initial: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {},
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      // WHEN: We save and then load
      await service.saveMetrics(initial);

      // Externally modify the file
      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      const modified: SpecMetricsFile = {
        ...initial,
        version: '2.0', // Changed version
      };
      fs.writeFileSync(metricsPath, JSON.stringify(modified, null, 2));

      // Load should return cached version (1.0), not the file version (2.0)
      const loaded = await service.loadMetrics();

      // THEN: Cached value is returned
      expect(loaded.version).toBe('1.0');
    });

    /**
     * @behavior invalidateCache forces reload from disk
     * @acceptance-criteria AC-METRICS-PERF.3 - Cache invalidation
     */
    it('invalidateCache forces reload from disk', async () => {
      // GIVEN: Cached metrics
      const initial: SpecMetricsFile = {
        version: '1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
        features: {},
        reconciliations: [],
        velocity: {
          weekly_drift_avg: 0,
          weekly_reconciliations: 0,
          trend: 'stable',
        },
      };

      const metricsPath = path.join(testDir, '.oss', 'spec-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(initial, null, 2));

      // Load to populate cache
      await service.loadMetrics();

      // Externally modify the file
      const modified: SpecMetricsFile = {
        ...initial,
        version: '2.0',
      };
      fs.writeFileSync(metricsPath, JSON.stringify(modified, null, 2));

      // WHEN: We invalidate cache and reload
      service.invalidateCache();
      const loaded = await service.loadMetrics();

      // THEN: Fresh data from disk is returned
      expect(loaded.version).toBe('2.0');
    });
  });
});
