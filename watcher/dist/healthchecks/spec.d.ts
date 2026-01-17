/**
 * Spec Healthcheck
 *
 * Evaluates spec compliance across active features by checking
 * coverage ratios and drift counts.
 *
 * Thresholds:
 * - Pass: coverage > 80% AND drift count <= 2
 * - Warn: coverage 50-80% OR drift count 3-5
 * - Fail: coverage < 50% OR drift count > 5
 *
 * @behavior Spec healthcheck evaluates feature coverage and drift counts
 * @acceptance-criteria AC-SPEC-HEALTH.1 through AC-SPEC-HEALTH.5
 */
import type { CheckResult } from '../types.js';
import type { FeatureMetrics } from '../services/spec-reconciler/types.js';
/**
 * Mock SpecMonitor interface for dependency injection.
 * This allows testing without the real SpecMonitor.
 */
export interface SpecMonitorInterface {
    getFeatureMetrics: (feature: string) => Promise<FeatureMetrics>;
}
/**
 * Options for the spec healthcheck.
 */
export interface SpecHealthcheckOptions {
    /** SpecMonitor instance for getting metrics */
    specMonitor: SpecMonitorInterface;
    /** List of active feature names to check */
    activeFeatures: string[];
}
/**
 * Run the spec healthcheck.
 *
 * @param options - Healthcheck options including SpecMonitor and active features
 * @returns CheckResult with status, message, and details
 */
export declare function checkSpec(options: SpecHealthcheckOptions): Promise<CheckResult>;
//# sourceMappingURL=spec.d.ts.map