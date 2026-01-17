/**
 * Diff Generator Tests
 *
 * @behavior Diff generator detects file changes and generates coverage diffs
 * @acceptance-criteria AC-DIFF-GEN.1 through AC-DIFF-GEN.9
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isFileInFeatureScope,
  getRelatedFeature,
  generateCoverageDiff,
  logDiff,
} from '../../../src/services/spec-reconciler/diff-generator.js';
import type {
  FeatureMetrics,
  CoverageDiff,
  DriftResult,
} from '../../../src/services/spec-reconciler/types.js';

describe('Diff Generator', () => {
  // Test directories
  let testDir: string;
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-generator-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
  });

  describe('isFileInFeatureScope', () => {
    it('returns true for src/ files', () => {
      const result = isFileInFeatureScope('src/services/auth-service.ts', 'auth');
      expect(result).toBe(true);
    });

    it('returns false for node_modules/', () => {
      const result = isFileInFeatureScope('node_modules/lodash/index.js', 'auth');
      expect(result).toBe(false);
    });

    it('returns false for dist/ files', () => {
      const result = isFileInFeatureScope('dist/services/auth-service.js', 'auth');
      expect(result).toBe(false);
    });

    it('returns false for test files', () => {
      const result = isFileInFeatureScope('src/services/auth-service.test.ts', 'auth');
      expect(result).toBe(false);
    });

    it('returns false for spec files', () => {
      const result = isFileInFeatureScope('src/services/auth-service.spec.ts', 'auth');
      expect(result).toBe(false);
    });

    it('returns true for tsx files in src/', () => {
      const result = isFileInFeatureScope('src/components/LoginForm.tsx', 'login');
      expect(result).toBe(true);
    });
  });

  describe('getRelatedFeature', () => {
    it('finds feature for file path matching component name', async () => {
      const activeFeatures = ['auth', 'payment', 'notification'];
      const result = await getRelatedFeature('src/services/auth-service.ts', activeFeatures);
      expect(result).toBe('auth');
    });

    it('finds feature for nested file paths', async () => {
      const activeFeatures = ['payment-processing', 'user-management'];
      const result = await getRelatedFeature(
        'src/services/payment/payment-processor.ts',
        activeFeatures
      );
      expect(result).toBe('payment-processing');
    });

    it('returns null when no matching feature found', async () => {
      const activeFeatures = ['auth', 'payment'];
      const result = await getRelatedFeature('src/utils/string-utils.ts', activeFeatures);
      expect(result).toBeNull();
    });

    it('handles case-insensitive matching', async () => {
      const activeFeatures = ['UserAuth', 'PaymentGateway'];
      const result = await getRelatedFeature('src/services/user-auth.ts', activeFeatures);
      expect(result).toBe('UserAuth');
    });

    it('returns first match when multiple features could match', async () => {
      const activeFeatures = ['auth', 'auth-token'];
      const result = await getRelatedFeature('src/auth/token-service.ts', activeFeatures);
      expect(result).not.toBeNull();
    });
  });

  describe('generateCoverageDiff', () => {
    const createMetrics = (
      componentRatio: number,
      criteriaRatio: number,
      behaviorsRatio: number,
      driftCount: number,
      driftTypes: DriftResult[] = []
    ): FeatureMetrics & { drifts: DriftResult[] } => ({
      feature: 'test-feature',
      specPath: '.oss/dev/active/test-feature/SPEC.md',
      coverage: {
        components: { total: 10, implemented: Math.round(componentRatio * 10), ratio: componentRatio },
        criteria: { total: 5, implemented: Math.round(criteriaRatio * 5), ratio: criteriaRatio },
        behaviors: { total: 8, implemented: Math.round(behaviorsRatio * 8), ratio: behaviorsRatio },
      },
      drift: {
        count: driftCount,
        types: driftTypes.map((d) => d.type),
      },
      drifts: driftTypes,
    });

    it('shows coverage increase', () => {
      const before = createMetrics(0.5, 0.6, 0.5, 2);
      const after = createMetrics(0.7, 0.8, 0.7, 1);

      const diff = generateCoverageDiff(before, after, 'src/new-component.ts');

      expect(diff.net.coverageChange).toBeGreaterThan(0);
      expect(diff.trigger).toBe('src/new-component.ts');
      expect(diff.feature).toBe('test-feature');
    });

    it('shows coverage decrease', () => {
      const before = createMetrics(0.8, 0.8, 0.8, 1);
      const after = createMetrics(0.6, 0.6, 0.6, 3);

      const diff = generateCoverageDiff(before, after, 'commit');

      expect(diff.net.coverageChange).toBeLessThan(0);
      expect(diff.net.driftChange).toBeGreaterThan(0); // More drifts
    });

    it('identifies resolved drifts', () => {
      const resolvedDrift: DriftResult = {
        type: 'structural_missing',
        confidence: 0.95,
        description: 'Missing AuthService implementation',
        specItem: { id: 'AuthService', description: 'Auth handler', status: 'unchecked', type: 'component' },
      };
      const before = createMetrics(0.5, 0.6, 0.5, 1, [resolvedDrift]);
      const after = createMetrics(0.6, 0.6, 0.5, 0, []);

      const diff = generateCoverageDiff(before, after, 'src/auth-service.ts');

      expect(diff.resolved).toHaveLength(1);
      expect(diff.resolved[0].type).toBe('structural_missing');
      expect(diff.new).toHaveLength(0);
    });

    it('identifies new drifts', () => {
      const newDrift: DriftResult = {
        type: 'structural_extra',
        confidence: 0.9,
        description: 'Extra file not in spec',
        filePath: 'src/orphan-service.ts',
      };
      const before = createMetrics(0.6, 0.6, 0.6, 0, []);
      const after = createMetrics(0.6, 0.6, 0.6, 1, [newDrift]);

      const diff = generateCoverageDiff(before, after, 'src/orphan-service.ts');

      expect(diff.new).toHaveLength(1);
      expect(diff.new[0].type).toBe('structural_extra');
      expect(diff.resolved).toHaveLength(0);
    });

    it('includes timestamp', () => {
      const before = createMetrics(0.5, 0.5, 0.5, 0);
      const after = createMetrics(0.6, 0.6, 0.6, 0);

      const diff = generateCoverageDiff(before, after, 'manual');

      expect(diff.timestamp).toBeDefined();
      expect(new Date(diff.timestamp).toISOString()).toBe(diff.timestamp);
    });

    it('calculates correct net coverage change', () => {
      // Before: components 50%, criteria 60%, behaviors 50% = avg 53.3%
      // After: components 70%, criteria 80%, behaviors 70% = avg 73.3%
      // Net change: +20%
      const before = createMetrics(0.5, 0.6, 0.5, 2);
      const after = createMetrics(0.7, 0.8, 0.7, 1);

      const diff = generateCoverageDiff(before, after, 'src/file.ts');

      const beforeAvg = (0.5 + 0.6 + 0.5) / 3;
      const afterAvg = (0.7 + 0.8 + 0.7) / 3;
      const expectedChange = afterAvg - beforeAvg;

      expect(diff.net.coverageChange).toBeCloseTo(expectedChange, 4);
    });
  });

  describe('logDiff', () => {
    it('appends to spec-diffs.log', async () => {
      const ossDir = path.join(testDir, '.oss');
      fs.mkdirSync(ossDir, { recursive: true });

      const diff: CoverageDiff = {
        feature: 'test-feature',
        trigger: 'src/component.ts',
        timestamp: new Date().toISOString(),
        before: {
          components: { total: 10, implemented: 5, ratio: 0.5 },
          criteria: { total: 5, implemented: 3, ratio: 0.6 },
          behaviors: { total: 8, implemented: 4, ratio: 0.5 },
          driftCount: 2,
        },
        after: {
          components: { total: 10, implemented: 6, ratio: 0.6 },
          criteria: { total: 5, implemented: 3, ratio: 0.6 },
          behaviors: { total: 8, implemented: 5, ratio: 0.625 },
          driftCount: 1,
        },
        resolved: [],
        new: [],
        net: {
          coverageChange: 0.075,
          driftChange: -1,
        },
      };

      await logDiff(diff, testDir);

      const logPath = path.join(ossDir, 'spec-diffs.log');
      expect(fs.existsSync(logPath)).toBe(true);

      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toContain('test-feature');
      expect(content).toContain('src/component.ts');
    });

    it('includes timestamp and feature', async () => {
      const ossDir = path.join(testDir, '.oss');
      fs.mkdirSync(ossDir, { recursive: true });

      const timestamp = new Date().toISOString();
      const diff: CoverageDiff = {
        feature: 'payment-feature',
        trigger: 'commit',
        timestamp,
        before: {
          components: { total: 5, implemented: 2, ratio: 0.4 },
          criteria: { total: 3, implemented: 1, ratio: 0.33 },
          behaviors: { total: 4, implemented: 2, ratio: 0.5 },
          driftCount: 3,
        },
        after: {
          components: { total: 5, implemented: 3, ratio: 0.6 },
          criteria: { total: 3, implemented: 2, ratio: 0.67 },
          behaviors: { total: 4, implemented: 3, ratio: 0.75 },
          driftCount: 1,
        },
        resolved: [
          {
            type: 'structural_missing',
            confidence: 0.95,
            description: 'Missing component',
          },
        ],
        new: [],
        net: {
          coverageChange: 0.25,
          driftChange: -2,
        },
      };

      await logDiff(diff, testDir);

      const logPath = path.join(ossDir, 'spec-diffs.log');
      const content = fs.readFileSync(logPath, 'utf-8');

      expect(content).toContain(timestamp);
      expect(content).toContain('payment-feature');
      expect(content).toContain('commit');
    });

    it('creates .oss directory if it does not exist', async () => {
      const ossDir = path.join(testDir, '.oss');
      expect(fs.existsSync(ossDir)).toBe(false);

      const diff: CoverageDiff = {
        feature: 'new-feature',
        trigger: 'manual',
        timestamp: new Date().toISOString(),
        before: {
          components: { total: 5, implemented: 0, ratio: 0 },
          criteria: { total: 3, implemented: 0, ratio: 0 },
          behaviors: { total: 4, implemented: 0, ratio: 0 },
          driftCount: 5,
        },
        after: {
          components: { total: 5, implemented: 1, ratio: 0.2 },
          criteria: { total: 3, implemented: 0, ratio: 0 },
          behaviors: { total: 4, implemented: 0, ratio: 0 },
          driftCount: 4,
        },
        resolved: [],
        new: [],
        net: {
          coverageChange: 0.067,
          driftChange: -1,
        },
      };

      await logDiff(diff, testDir);

      expect(fs.existsSync(ossDir)).toBe(true);
      expect(fs.existsSync(path.join(ossDir, 'spec-diffs.log'))).toBe(true);
    });

    it('appends multiple entries to the log', async () => {
      const ossDir = path.join(testDir, '.oss');
      fs.mkdirSync(ossDir, { recursive: true });

      const baseDiff: CoverageDiff = {
        feature: 'multi-entry-feature',
        trigger: 'file1.ts',
        timestamp: new Date().toISOString(),
        before: {
          components: { total: 5, implemented: 2, ratio: 0.4 },
          criteria: { total: 3, implemented: 1, ratio: 0.33 },
          behaviors: { total: 4, implemented: 2, ratio: 0.5 },
          driftCount: 3,
        },
        after: {
          components: { total: 5, implemented: 3, ratio: 0.6 },
          criteria: { total: 3, implemented: 1, ratio: 0.33 },
          behaviors: { total: 4, implemented: 2, ratio: 0.5 },
          driftCount: 2,
        },
        resolved: [],
        new: [],
        net: {
          coverageChange: 0.067,
          driftChange: -1,
        },
      };

      await logDiff({ ...baseDiff, trigger: 'file1.ts' }, testDir);
      await logDiff({ ...baseDiff, trigger: 'file2.ts' }, testDir);
      await logDiff({ ...baseDiff, trigger: 'file3.ts' }, testDir);

      const logPath = path.join(ossDir, 'spec-diffs.log');
      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(3);
      expect(content).toContain('file1.ts');
      expect(content).toContain('file2.ts');
      expect(content).toContain('file3.ts');
    });
  });
});
