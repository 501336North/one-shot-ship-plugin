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
});
