/**
 * SpecMetricsService
 *
 * Provides persistent storage for spec compliance metrics,
 * coverage history, and reconciliation audit trails.
 *
 * @behavior Tracks long-term spec compliance and trends
 * @acceptance-criteria AC-METRICS.1 through AC-METRICS.4
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  SpecMetricsFile,
  FeatureMetrics,
  HistoryEntry,
  VelocityMetrics,
  ReconciliationEntry,
} from './spec-reconciler/index.js';

/** Maximum number of history entries to retain per feature */
const MAX_HISTORY_ENTRIES = 90;

/** Minimum number of history entries required for velocity calculation */
const MIN_VELOCITY_ENTRIES = 7;

/** Maximum number of reconciliation entries to retain */
const MAX_RECONCILIATION_ENTRIES = 500;

/**
 * Default empty metrics file structure.
 */
function createDefaultMetrics(): SpecMetricsFile {
  return {
    version: '1.0',
    updated_at: new Date().toISOString(),
    features: {},
    reconciliations: [],
    velocity: {
      weekly_drift_avg: 0,
      weekly_reconciliations: 0,
      trend: 'stable',
    },
  };
}

/**
 * Service for loading and saving spec metrics to persistent storage.
 */
export class SpecMetricsService {
  private readonly metricsPath: string;

  /**
   * Creates a new SpecMetricsService.
   * @param basePath - Base directory (defaults to cwd). Metrics stored at .oss/spec-metrics.json
   */
  constructor(basePath?: string) {
    const base = basePath ?? process.cwd();
    this.metricsPath = path.join(base, '.oss', 'spec-metrics.json');
  }

  /**
   * Loads metrics from disk.
   * Returns default metrics if file does not exist.
   */
  async loadMetrics(): Promise<SpecMetricsFile> {
    try {
      const content = fs.readFileSync(this.metricsPath, 'utf-8');
      return JSON.parse(content) as SpecMetricsFile;
    } catch {
      return createDefaultMetrics();
    }
  }

  /**
   * Saves metrics to disk.
   * Updates the updated_at timestamp before saving.
   */
  async saveMetrics(metrics: SpecMetricsFile): Promise<void> {
    const updated = {
      ...metrics,
      updated_at: new Date().toISOString(),
    };

    // Ensure directory exists
    const dir = path.dirname(this.metricsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.metricsPath, JSON.stringify(updated, null, 2));
  }

  /**
   * Updates coverage for a feature and adds a history snapshot.
   * If an entry exists for today, it is replaced. History is limited to 90 entries.
   */
  async updateCoverage(feature: string, metrics: FeatureMetrics): Promise<void> {
    const current = await this.loadMetrics();

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().slice(0, 10);

    // Calculate overall coverage as average of all three sections
    const overallCoverage =
      (metrics.coverage.components.ratio +
        metrics.coverage.criteria.ratio +
        metrics.coverage.behaviors.ratio) /
      3;

    // Create new history entry
    const newEntry: HistoryEntry = {
      date: today,
      coverage: overallCoverage,
      drift_count: metrics.drift.count,
    };

    // Initialize feature if it doesn't exist
    if (!current.features[feature]) {
      current.features[feature] = {
        spec_path: metrics.specPath,
        coverage: metrics.coverage,
        drift: {
          current_count: metrics.drift.count,
          types: metrics.drift.types,
        },
        history: [],
      };
    }

    const featureData = current.features[feature];

    // Update current coverage and drift
    featureData.coverage = metrics.coverage;
    featureData.drift = {
      current_count: metrics.drift.count,
      types: metrics.drift.types,
    };

    // Remove existing entry for today if present
    featureData.history = featureData.history.filter((entry) => entry.date !== today);

    // Add new entry
    featureData.history.push(newEntry);

    // Limit history to MAX_HISTORY_ENTRIES (remove oldest entries)
    if (featureData.history.length > MAX_HISTORY_ENTRIES) {
      featureData.history = featureData.history.slice(
        featureData.history.length - MAX_HISTORY_ENTRIES
      );
    }

    await this.saveMetrics(current);
  }

  /**
   * Calculates velocity metrics for a feature.
   * Returns null if insufficient data (< 7 days of history).
   */
  async calculateVelocity(feature: string): Promise<VelocityMetrics | null> {
    const metrics = await this.loadMetrics();
    const featureData = metrics.features[feature];

    if (!featureData || featureData.history.length < MIN_VELOCITY_ENTRIES) {
      return null;
    }

    const history = featureData.history;

    // Calculate weekly drift average from all history entries
    const totalDrift = history.reduce((sum, entry) => sum + entry.drift_count, 0);
    const weekly_drift_avg = totalDrift / history.length;

    // Determine trend by comparing first half vs second half of drift counts
    const midpoint = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, midpoint);
    const secondHalf = history.slice(midpoint);

    const firstHalfAvg =
      firstHalf.reduce((sum, entry) => sum + entry.drift_count, 0) / firstHalf.length;
    const secondHalfAvg =
      secondHalf.reduce((sum, entry) => sum + entry.drift_count, 0) / secondHalf.length;

    // Determine trend based on change between halves
    let trend: 'improving' | 'stable' | 'degrading';
    const changeThreshold = 0.5; // Minimum change to not be considered stable

    if (firstHalfAvg - secondHalfAvg > changeThreshold) {
      trend = 'improving'; // Drift decreased
    } else if (secondHalfAvg - firstHalfAvg > changeThreshold) {
      trend = 'degrading'; // Drift increased
    } else {
      trend = 'stable';
    }

    // Count reconciliations in the last 7 days from the reconciliations array
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekly_reconciliations = metrics.reconciliations.filter((entry) => {
      return new Date(entry.timestamp) >= sevenDaysAgo;
    }).length;

    return {
      weekly_drift_avg,
      weekly_reconciliations,
      trend,
    };
  }

  /**
   * Records a reconciliation entry to the audit trail.
   * Limits entries to 500 (oldest removed first).
   */
  async recordReconciliation(entry: ReconciliationEntry): Promise<void> {
    const metrics = await this.loadMetrics();

    // Add new entry
    metrics.reconciliations.push(entry);

    // Limit to MAX_RECONCILIATION_ENTRIES (remove oldest entries)
    if (metrics.reconciliations.length > MAX_RECONCILIATION_ENTRIES) {
      metrics.reconciliations = metrics.reconciliations.slice(
        metrics.reconciliations.length - MAX_RECONCILIATION_ENTRIES
      );
    }

    await this.saveMetrics(metrics);
  }
}
