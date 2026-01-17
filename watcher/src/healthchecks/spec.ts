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

/** Coverage thresholds */
const COVERAGE_PASS_THRESHOLD = 0.80; // >= 80% for pass
const COVERAGE_WARN_THRESHOLD = 0.50; // >= 50% for warn, < 50% for fail

/** Drift thresholds */
const DRIFT_PASS_THRESHOLD = 2; // <= 2 for pass
const DRIFT_WARN_THRESHOLD = 5; // <= 5 for warn, > 5 for fail

/**
 * Calculate average coverage ratio across all sections.
 */
function calculateAverageCoverage(metrics: FeatureMetrics): number {
  const { components, criteria, behaviors } = metrics.coverage;

  // If all sections are empty, return 1.0 (100% coverage of nothing)
  const totalItems = components.total + criteria.total + behaviors.total;
  if (totalItems === 0) {
    return 1.0;
  }

  // Weight by section size
  const totalImplemented = components.implemented + criteria.implemented + behaviors.implemented;
  return totalImplemented / totalItems;
}

/**
 * Determine status for a single feature's metrics.
 */
function evaluateFeatureStatus(metrics: FeatureMetrics): 'pass' | 'warn' | 'fail' {
  const avgCoverage = calculateAverageCoverage(metrics);
  const driftCount = metrics.drift.count;

  // Fail conditions
  if (avgCoverage < COVERAGE_WARN_THRESHOLD || driftCount > DRIFT_WARN_THRESHOLD) {
    return 'fail';
  }

  // Warn conditions
  if (avgCoverage < COVERAGE_PASS_THRESHOLD || driftCount > DRIFT_PASS_THRESHOLD) {
    return 'warn';
  }

  // Pass
  return 'pass';
}

/**
 * Run the spec healthcheck.
 *
 * @param options - Healthcheck options including SpecMonitor and active features
 * @returns CheckResult with status, message, and details
 */
export async function checkSpec(options: SpecHealthcheckOptions): Promise<CheckResult> {
  const { specMonitor, activeFeatures } = options;

  // No active features - pass
  if (activeFeatures.length === 0) {
    return {
      status: 'pass',
      message: 'No active features to check',
      details: {
        features: [],
        averageCoverage: 1.0,
        totalDrift: 0,
      },
    };
  }

  // Collect metrics for all features in parallel
  const results = await Promise.all(
    activeFeatures.map(async (feature) => {
      try {
        const metrics = await specMonitor.getFeatureMetrics(feature);
        const status = evaluateFeatureStatus(metrics);
        return { feature, status, metrics, error: null as string | null };
      } catch (error) {
        return { feature, status: 'fail' as const, metrics: null as FeatureMetrics | null, error: (error as Error).message };
      }
    })
  );

  // Separate successful and failed results
  const featureStatuses: Array<{ feature: string; status: 'pass' | 'warn' | 'fail'; metrics: FeatureMetrics }> = [];
  const errors: string[] = [];
  const errorFeatures: string[] = [];

  for (const result of results) {
    if (result.error) {
      errors.push(`${result.feature}: ${result.error}`);
      errorFeatures.push(result.feature);
    } else if (result.metrics) {
      featureStatuses.push({ feature: result.feature, status: result.status, metrics: result.metrics });
    }
  }

  // If we had errors, fail (but still include all feature info)
  if (errors.length > 0) {
    return {
      status: 'fail',
      message: `Spec healthcheck error: ${errors.join(', ')}`,
      details: {
        errors,
        failingFeatures: errorFeatures,
      },
    };
  }

  // Aggregate metrics
  const allMetrics = featureStatuses.map((fs) => fs.metrics);
  const totalCoverage = allMetrics.reduce((sum, m) => sum + calculateAverageCoverage(m), 0);
  const averageCoverage = allMetrics.length > 0 ? totalCoverage / allMetrics.length : 1.0;
  const totalDrift = allMetrics.reduce((sum, m) => sum + m.drift.count, 0);

  // Determine overall status (worst case wins)
  const failingFeatures = featureStatuses.filter((fs) => fs.status === 'fail').map((fs) => fs.feature);
  const warningFeatures = featureStatuses.filter((fs) => fs.status === 'warn').map((fs) => fs.feature);

  let overallStatus: 'pass' | 'warn' | 'fail' = 'pass';
  let message = 'Spec compliance healthy';

  if (failingFeatures.length > 0) {
    overallStatus = 'fail';
    const worstFeature = failingFeatures[0];
    const worstMetrics = featureStatuses.find((fs) => fs.feature === worstFeature)?.metrics;

    if (worstMetrics) {
      const coverage = calculateAverageCoverage(worstMetrics);
      if (coverage < COVERAGE_WARN_THRESHOLD) {
        message = `Spec coverage below 50% in ${worstFeature}`;
      } else if (worstMetrics.drift.count > DRIFT_WARN_THRESHOLD) {
        message = `Spec drift count exceeds 5 in ${worstFeature}`;
      } else {
        message = `Spec compliance failing in ${worstFeature}`;
      }
    }
  } else if (warningFeatures.length > 0) {
    overallStatus = 'warn';
    const warnFeature = warningFeatures[0];
    const warnMetrics = featureStatuses.find((fs) => fs.feature === warnFeature)?.metrics;

    if (warnMetrics) {
      const coverage = calculateAverageCoverage(warnMetrics);
      if (coverage < COVERAGE_PASS_THRESHOLD) {
        message = `Spec coverage below 80% in ${warnFeature}`;
      } else if (warnMetrics.drift.count > DRIFT_PASS_THRESHOLD) {
        message = `Elevated spec drift in ${warnFeature}`;
      } else {
        message = `Spec compliance warning in ${warnFeature}`;
      }
    }
  }

  return {
    status: overallStatus,
    message,
    details: {
      features: activeFeatures,
      failingFeatures: failingFeatures.length > 0 ? failingFeatures : undefined,
      warningFeatures: warningFeatures.length > 0 ? warningFeatures : undefined,
      averageCoverage,
      totalDrift,
    },
  };
}
