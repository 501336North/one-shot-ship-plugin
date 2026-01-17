/**
 * SpecMetricsService
 *
 * Provides persistent storage for spec compliance metrics,
 * coverage history, and reconciliation audit trails.
 *
 * @behavior Tracks long-term spec compliance and trends
 * @acceptance-criteria AC-METRICS.1 through AC-METRICS.4
 */
import type { SpecMetricsFile, FeatureMetrics, VelocityMetrics, ReconciliationEntry } from './spec-reconciler/index.js';
/**
 * Service for loading and saving spec metrics to persistent storage.
 */
export declare class SpecMetricsService {
    private readonly metricsPath;
    /**
     * Creates a new SpecMetricsService.
     * @param basePath - Base directory (defaults to cwd). Metrics stored at .oss/spec-metrics.json
     */
    constructor(basePath?: string);
    /**
     * Loads metrics from disk.
     * Returns default metrics if file does not exist.
     */
    loadMetrics(): Promise<SpecMetricsFile>;
    /**
     * Saves metrics to disk.
     * Updates the updated_at timestamp before saving.
     */
    saveMetrics(metrics: SpecMetricsFile): Promise<void>;
    /**
     * Updates coverage for a feature and adds a history snapshot.
     * If an entry exists for today, it is replaced. History is limited to 90 entries.
     */
    updateCoverage(feature: string, metrics: FeatureMetrics): Promise<void>;
    /**
     * Calculates velocity metrics for a feature.
     * Returns null if insufficient data (< 7 days of history).
     */
    calculateVelocity(feature: string): Promise<VelocityMetrics | null>;
    /**
     * Records a reconciliation entry to the audit trail.
     * Limits entries to 500 (oldest removed first).
     */
    recordReconciliation(entry: ReconciliationEntry): Promise<void>;
}
//# sourceMappingURL=spec-metrics.d.ts.map