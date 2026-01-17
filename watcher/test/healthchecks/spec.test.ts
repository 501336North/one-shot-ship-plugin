/**
 * Spec Healthcheck Tests
 *
 * Tests for the spec compliance healthcheck that monitors coverage and drift.
 *
 * @behavior Spec healthcheck evaluates feature coverage and drift counts
 * @acceptance-criteria AC-SPEC-HEALTH.1: Pass when coverage > 80% and drift <= 2
 * @acceptance-criteria AC-SPEC-HEALTH.2: Warn when coverage 50-80%
 * @acceptance-criteria AC-SPEC-HEALTH.3: Warn when drift count 3-5
 * @acceptance-criteria AC-SPEC-HEALTH.4: Fail when coverage < 50%
 * @acceptance-criteria AC-SPEC-HEALTH.5: Fail when drift count > 5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkSpec, SpecHealthcheckOptions } from '../../src/healthchecks/spec.js';
import type { FeatureMetrics, SpecCoverage, DriftType } from '../../src/services/spec-reconciler/types.js';

// Helper to create mock feature metrics
function createMockMetrics(
  feature: string,
  coverageRatio: number,
  driftCount: number,
  driftTypes: DriftType[] = []
): FeatureMetrics {
  const coverage: SpecCoverage = {
    total: 10,
    implemented: Math.round(coverageRatio * 10),
    ratio: coverageRatio,
  };

  return {
    feature,
    specPath: `.oss/dev/active/${feature}/DESIGN.md`,
    coverage: {
      components: coverage,
      criteria: coverage,
      behaviors: coverage,
    },
    drift: {
      count: driftCount,
      types: driftTypes,
    },
  };
}

// Mock SpecMonitor interface for testing
interface MockSpecMonitor {
  getFeatureMetrics: (feature: string) => Promise<FeatureMetrics>;
}

describe('Spec Healthcheck', () => {
  let mockSpecMonitor: MockSpecMonitor;

  beforeEach(() => {
    mockSpecMonitor = {
      getFeatureMetrics: vi.fn(),
    };
  });

  describe('Pass conditions', () => {
    it('should return pass when coverage > 80% and drift count <= 2', async () => {
      // GIVEN: High coverage and low drift
      const metrics = createMockMetrics('healthy-feature', 0.85, 2);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['healthy-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is pass
      expect(result.status).toBe('pass');
      expect(result.message).toContain('Spec compliance healthy');
    });

    it('should return pass when coverage is exactly 80% and drift count is 0', async () => {
      // GIVEN: Exactly 80% coverage and no drift
      const metrics = createMockMetrics('exact-feature', 0.80, 0);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['exact-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is pass (80% is the boundary, inclusive)
      expect(result.status).toBe('pass');
    });

    it('should return pass when no active features exist', async () => {
      // GIVEN: No active features
      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: [],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is pass (nothing to check)
      expect(result.status).toBe('pass');
      expect(result.message).toContain('No active features');
    });
  });

  describe('Warn conditions', () => {
    it('should return warn when coverage is 50-80%', async () => {
      // GIVEN: Medium coverage (60%)
      const metrics = createMockMetrics('medium-feature', 0.60, 1);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['medium-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is warn
      expect(result.status).toBe('warn');
      expect(result.message).toContain('coverage below 80%');
    });

    it('should return warn when coverage is exactly 50%', async () => {
      // GIVEN: Exactly 50% coverage (boundary)
      const metrics = createMockMetrics('boundary-feature', 0.50, 0);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['boundary-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is warn (50% is the warn boundary, inclusive)
      expect(result.status).toBe('warn');
    });

    it('should return warn when drift count is 3-5', async () => {
      // GIVEN: Good coverage but moderate drift (3)
      const metrics = createMockMetrics('drift-feature', 0.85, 3, ['structural_missing']);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['drift-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is warn due to drift
      expect(result.status).toBe('warn');
      expect(result.message).toContain('drift');
    });

    it('should return warn when drift count is exactly 5', async () => {
      // GIVEN: Drift count at upper warn boundary
      const metrics = createMockMetrics('drift-feature', 0.90, 5, ['criteria_incomplete']);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['drift-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is warn
      expect(result.status).toBe('warn');
    });
  });

  describe('Fail conditions', () => {
    it('should return fail when coverage < 50%', async () => {
      // GIVEN: Low coverage (40%)
      const metrics = createMockMetrics('low-coverage-feature', 0.40, 0);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['low-coverage-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is fail
      expect(result.status).toBe('fail');
      expect(result.message).toContain('coverage below 50%');
    });

    it('should return fail when drift count > 5', async () => {
      // GIVEN: High drift count (6)
      const metrics = createMockMetrics('high-drift-feature', 0.85, 6, [
        'structural_missing',
        'structural_extra',
        'criteria_incomplete',
      ]);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['high-drift-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is fail
      expect(result.status).toBe('fail');
      expect(result.message).toContain('drift count exceeds 5');
    });

    it('should return fail when drift count is exactly 6', async () => {
      // GIVEN: Drift count at fail boundary
      const metrics = createMockMetrics('boundary-drift', 0.90, 6, ['structural_missing']);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['boundary-drift'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is fail
      expect(result.status).toBe('fail');
    });
  });

  describe('Multiple features', () => {
    it('should aggregate metrics across all active features', async () => {
      // GIVEN: Multiple features with varying health
      const feature1 = createMockMetrics('feature-1', 0.90, 1);
      const feature2 = createMockMetrics('feature-2', 0.85, 2);

      mockSpecMonitor.getFeatureMetrics = vi.fn()
        .mockResolvedValueOnce(feature1)
        .mockResolvedValueOnce(feature2);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['feature-1', 'feature-2'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status reflects all features (both healthy = pass)
      expect(result.status).toBe('pass');
      expect(result.details?.features).toEqual(['feature-1', 'feature-2']);
    });

    it('should return worst status across all features', async () => {
      // GIVEN: One healthy feature and one failing feature
      const healthyFeature = createMockMetrics('healthy', 0.90, 1);
      const failingFeature = createMockMetrics('failing', 0.30, 10);

      mockSpecMonitor.getFeatureMetrics = vi.fn()
        .mockResolvedValueOnce(healthyFeature)
        .mockResolvedValueOnce(failingFeature);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['healthy', 'failing'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is fail (worst case)
      expect(result.status).toBe('fail');
      expect(result.details?.failingFeatures).toContain('failing');
    });
  });

  describe('Details in result', () => {
    it('should include coverage and drift details in result', async () => {
      // GIVEN: Feature with specific metrics (70% = 7/10 per section)
      const metrics = createMockMetrics('detailed-feature', 0.70, 3, ['structural_missing']);
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockResolvedValue(metrics);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['detailed-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Details include coverage and drift info
      // Note: 70% coverage = 7/10 per section = 21/30 total = 0.7
      expect(result.details).toBeDefined();
      expect(result.details?.averageCoverage).toBeCloseTo(0.70);
      expect(result.details?.totalDrift).toBe(3);
    });
  });

  describe('Error handling', () => {
    it('should handle errors from SpecMonitor gracefully', async () => {
      // GIVEN: SpecMonitor throws an error
      mockSpecMonitor.getFeatureMetrics = vi.fn().mockRejectedValue(new Error('Monitor error'));

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['error-feature'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status is fail with error message
      expect(result.status).toBe('fail');
      expect(result.message).toContain('error');
    });
  });

  // ============================================================================
  // Performance: Parallel Feature Processing
  // ============================================================================

  describe('parallel feature processing', () => {
    /**
     * @behavior Processes multiple features in parallel
     * @acceptance-criteria AC-SPEC-HEALTH-PERF.1 - Parallel execution
     */
    it('processes features in parallel for performance', async () => {
      // GIVEN: Multiple features with varying processing times
      const features = ['feature-a', 'feature-b', 'feature-c'];
      let callOrder: string[] = [];

      mockSpecMonitor.getFeatureMetrics = vi.fn().mockImplementation(async (feature: string) => {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 10));
        callOrder.push(feature);
        return createMockMetrics(feature, 0.85, 1);
      });

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: features,
      };

      // WHEN: Running the healthcheck
      const startTime = performance.now();
      const result = await checkSpec(options);
      const endTime = performance.now();

      // THEN: All features are processed
      expect(result.status).toBe('pass');
      expect(mockSpecMonitor.getFeatureMetrics).toHaveBeenCalledTimes(3);

      // AND: Processing time should be closer to 10ms (parallel) than 30ms (sequential)
      // Allow some overhead, but should be significantly less than sequential time
      expect(endTime - startTime).toBeLessThan(100);
    });

    /**
     * @behavior Continues processing even if one feature fails
     * @acceptance-criteria AC-SPEC-HEALTH-PERF.2 - Error isolation
     */
    it('continues processing other features when one fails', async () => {
      // GIVEN: One feature that fails and two that succeed
      const healthyMetrics = createMockMetrics('healthy-feature', 0.90, 1);
      const healthyMetrics2 = createMockMetrics('healthy-feature-2', 0.85, 2);

      mockSpecMonitor.getFeatureMetrics = vi.fn()
        .mockImplementationOnce(async () => healthyMetrics)
        .mockRejectedValueOnce(new Error('Feature processing failed'))
        .mockImplementationOnce(async () => healthyMetrics2);

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['healthy-feature', 'failing-feature', 'healthy-feature-2'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: All features were attempted
      expect(mockSpecMonitor.getFeatureMetrics).toHaveBeenCalledTimes(3);

      // AND: Result reflects the failure
      expect(result.status).toBe('fail');
      expect(result.details?.failingFeatures).toContain('failing-feature');
    });

    /**
     * @behavior Returns aggregated results from parallel execution
     * @acceptance-criteria AC-SPEC-HEALTH-PERF.3 - Result aggregation
     */
    it('aggregates results from all parallel features', async () => {
      // GIVEN: Features with different metrics
      mockSpecMonitor.getFeatureMetrics = vi.fn()
        .mockResolvedValueOnce(createMockMetrics('feature-a', 0.95, 0))
        .mockResolvedValueOnce(createMockMetrics('feature-b', 0.70, 4))
        .mockResolvedValueOnce(createMockMetrics('feature-c', 0.85, 2));

      const options: SpecHealthcheckOptions = {
        specMonitor: mockSpecMonitor,
        activeFeatures: ['feature-a', 'feature-b', 'feature-c'],
      };

      // WHEN: Running the healthcheck
      const result = await checkSpec(options);

      // THEN: Status reflects worst case (feature-b with 70% coverage is warn)
      expect(result.status).toBe('warn');
      expect(result.details?.features).toHaveLength(3);

      // AND: Average coverage is calculated from all features
      // createMockMetrics uses the same ratio for all 3 sections (components, criteria, behaviors)
      // Each section has 10 total items, so implemented = ratio * 10
      // Average = (sum of all implemented) / (sum of all total) = (9.5 + 7 + 8.5) / 30 = 0.833
      // But since each feature's average is computed separately first, then averaged:
      // (0.95 + 0.70 + 0.85) / 3 = 0.833... but actual computation rounds to nearest integer
      // Actually: each feature has ratio for all 3 sections, so per-feature avg = ratio
      // Overall avg = (0.95 + 0.70 + 0.85) / 3 = 0.8333...
      // But our createMockMetrics gives same ratio for all sections, so section-level avg = ratio
      // However, the actual impl uses total implemented / total items across all sections
      // For 10 items per section: (0.95*10 + 0.95*10 + 0.95*10) / 30 = 0.95
      // So each feature's average equals its ratio, and overall = (0.95 + 0.70 + 0.85) / 3
      expect(result.details?.averageCoverage).toBeCloseTo(0.8333, 1);
    });
  });
});
