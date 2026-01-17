/**
 * Spec Reconciler Types Tests
 *
 * @behavior Spec reconciler types define the data structures for spec parsing and drift detection
 * @acceptance-criteria AC-SPEC-TYPES.1 through AC-SPEC-TYPES.4
 */

import { describe, it, expect } from 'vitest';
import {
  SpecItem,
  SpecSection,
  ParsedSpec,
  DriftType,
  DriftResult,
  SpecCoverage,
  FeatureMetrics,
} from '../../../src/services/spec-reconciler/types.js';

describe('Spec Reconciler Types', () => {
  describe('SpecItem', () => {
    it('should have required properties for component type', () => {
      const item: SpecItem = {
        id: 'AuthService',
        description: 'Handles authentication',
        status: 'checked',
        type: 'component',
      };

      expect(item.id).toBe('AuthService');
      expect(item.description).toBe('Handles authentication');
      expect(item.status).toBe('checked');
      expect(item.type).toBe('component');
    });

    it('should support unchecked status', () => {
      const item: SpecItem = {
        id: 'UserRepo',
        description: 'Database access',
        status: 'unchecked',
        type: 'component',
      };

      expect(item.status).toBe('unchecked');
    });

    it('should support criterion type', () => {
      const item: SpecItem = {
        id: 'SC-001',
        description: 'User can login with valid credentials',
        status: 'unchecked',
        type: 'criterion',
      };

      expect(item.type).toBe('criterion');
    });

    it('should support behavior type', () => {
      const item: SpecItem = {
        id: 'BEH-001',
        description: 'System validates email format before submission',
        status: 'checked',
        type: 'behavior',
      };

      expect(item.type).toBe('behavior');
    });
  });

  describe('SpecSection', () => {
    it('should have marker, items array, and raw content', () => {
      const section: SpecSection = {
        marker: 'components',
        items: [
          {
            id: 'Service',
            description: 'Does something',
            status: 'checked',
            type: 'component',
          },
        ],
        raw: '<!-- spec:components -->\n- [x] Service - Does something\n<!-- /spec:components -->',
      };

      expect(section.marker).toBe('components');
      expect(section.items).toHaveLength(1);
      expect(section.raw).toContain('spec:components');
    });
  });

  describe('ParsedSpec', () => {
    it('should contain feature name and all three sections', () => {
      const spec: ParsedSpec = {
        feature: 'user-auth',
        components: {
          marker: 'components',
          items: [],
          raw: '',
        },
        criteria: {
          marker: 'criteria',
          items: [],
          raw: '',
        },
        behaviors: {
          marker: 'behaviors',
          items: [],
          raw: '',
        },
      };

      expect(spec.feature).toBe('user-auth');
      expect(spec.components).toBeDefined();
      expect(spec.criteria).toBeDefined();
      expect(spec.behaviors).toBeDefined();
    });
  });

  describe('DriftType', () => {
    it('should include structural_missing type', () => {
      const driftType: DriftType = 'structural_missing';
      expect(driftType).toBe('structural_missing');
    });

    it('should include structural_extra type', () => {
      const driftType: DriftType = 'structural_extra';
      expect(driftType).toBe('structural_extra');
    });

    it('should include behavioral_mismatch type', () => {
      const driftType: DriftType = 'behavioral_mismatch';
      expect(driftType).toBe('behavioral_mismatch');
    });

    it('should include criteria_incomplete type', () => {
      const driftType: DriftType = 'criteria_incomplete';
      expect(driftType).toBe('criteria_incomplete');
    });
  });

  describe('DriftResult', () => {
    it('should contain drift detection result with required fields', () => {
      const result: DriftResult = {
        type: 'structural_missing',
        confidence: 0.95,
        description: 'Component AuthService declared in spec but not found in codebase',
      };

      expect(result.type).toBe('structural_missing');
      expect(result.confidence).toBe(0.95);
      expect(result.description).toContain('AuthService');
    });

    it('should support optional specItem reference', () => {
      const result: DriftResult = {
        type: 'structural_missing',
        confidence: 0.9,
        description: 'Missing component',
        specItem: {
          id: 'AuthService',
          description: 'Handles auth',
          status: 'unchecked',
          type: 'component',
        },
      };

      expect(result.specItem).toBeDefined();
      expect(result.specItem?.id).toBe('AuthService');
    });

    it('should support optional filePath reference', () => {
      const result: DriftResult = {
        type: 'structural_extra',
        confidence: 0.85,
        description: 'File exists but not in spec',
        filePath: '/src/services/orphan-service.ts',
      };

      expect(result.filePath).toBe('/src/services/orphan-service.ts');
    });
  });

  describe('SpecCoverage', () => {
    it('should track total, implemented, and ratio', () => {
      const coverage: SpecCoverage = {
        total: 10,
        implemented: 7,
        ratio: 0.7,
      };

      expect(coverage.total).toBe(10);
      expect(coverage.implemented).toBe(7);
      expect(coverage.ratio).toBe(0.7);
    });
  });

  describe('FeatureMetrics', () => {
    it('should aggregate coverage and drift metrics for a feature', () => {
      const metrics: FeatureMetrics = {
        feature: 'user-auth',
        specPath: '/specs/user-auth/SPEC.md',
        coverage: {
          components: { total: 5, implemented: 4, ratio: 0.8 },
          criteria: { total: 10, implemented: 8, ratio: 0.8 },
          behaviors: { total: 3, implemented: 3, ratio: 1.0 },
        },
        drift: {
          count: 2,
          types: ['structural_missing', 'criteria_incomplete'],
        },
      };

      expect(metrics.feature).toBe('user-auth');
      expect(metrics.specPath).toContain('SPEC.md');
      expect(metrics.coverage.components.ratio).toBe(0.8);
      expect(metrics.drift.count).toBe(2);
      expect(metrics.drift.types).toContain('structural_missing');
    });
  });
});
