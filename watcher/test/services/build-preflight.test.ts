/**
 * Build Pre-flight Service Tests
 *
 * @behavior BuildPreflightService runs pre-flight checks before builds
 * @acceptance-criteria AC-PREFLIGHT.1 through AC-PREFLIGHT.8
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BuildPreflightService } from '../../src/services/build-preflight.js';
import { SpecMonitor } from '../../src/monitors/spec-monitor.js';
import { SpecReconciler } from '../../src/services/spec-reconciler/reconciler.js';
import { QueueManager } from '../../src/queue/manager.js';
import {
  PreflightReport,
  UserChoice,
  ChoiceResult,
  DriftResult,
  ParsedSpec,
  SpecSection,
  SpecItem,
} from '../../src/services/spec-reconciler/types.js';

// ============================================================================
// Task 6.1: Pre-flight Check
// ============================================================================

describe('BuildPreflightService', () => {
  let testDir: string;
  let mockQueueManager: Partial<QueueManager>;
  let mockSpecMonitor: SpecMonitor;
  let mockReconciler: SpecReconciler;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));

    mockQueueManager = {
      addTask: vi.fn().mockResolvedValue({ id: 'task-123' }),
      initialize: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn().mockResolvedValue([]),
    };

    mockSpecMonitor = new SpecMonitor(mockQueueManager as QueueManager, {
      basePath: testDir,
    });

    mockReconciler = new SpecReconciler(mockQueueManager as QueueManager);

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    /**
     * @behavior BuildPreflightService initializes with dependencies
     * @acceptance-criteria AC-PREFLIGHT.1
     */
    it('initializes with specMonitor and reconciler dependencies', () => {
      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      expect(service).toBeInstanceOf(BuildPreflightService);
    });

    /**
     * @behavior BuildPreflightService uses default base path when not provided
     * @acceptance-criteria AC-PREFLIGHT.1
     */
    it('uses default base path when not provided', () => {
      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler
      );

      expect(service).toBeInstanceOf(BuildPreflightService);
    });
  });

  describe('runPreflightCheck', () => {
    /**
     * @behavior runPreflightCheck returns PreflightReport with drift information
     * @acceptance-criteria AC-PREFLIGHT.2
     */
    it('returns drift report with detected drifts', async () => {
      // Create feature directory with DESIGN.md
      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'auth-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      const specContent = `
# Feature: Auth Feature

<!-- spec:components -->
- [ ] AuthService - Handles authentication
<!-- /spec:components -->

<!-- spec:criteria -->
- [ ] SC-001: User can login with valid credentials
<!-- /spec:criteria -->

<!-- spec:behaviors -->
- [ ] Validates email format
<!-- /spec:behaviors -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), specContent);

      // Create src directory but NO matching file (causes structural_missing)
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report = await service.runPreflightCheck('auth-feature');

      expect(report).toBeDefined();
      expect(report.feature).toBe('auth-feature');
      expect(report.drifts.length).toBeGreaterThan(0);
      expect(report.drifts[0].type).toBe('structural_missing');
    });

    /**
     * @behavior runPreflightCheck returns coverage summary
     * @acceptance-criteria AC-PREFLIGHT.3
     */
    it('returns coverage summary for all sections', async () => {
      // Create feature directory with DESIGN.md
      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'my-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      const specContent = `
# Feature: My Feature

<!-- spec:components -->
- [x] ServiceA - First service
- [ ] ServiceB - Second service
<!-- /spec:components -->

<!-- spec:criteria -->
- [x] SC-001: First criterion
- [x] SC-002: Second criterion
- [ ] SC-003: Third criterion
<!-- /spec:criteria -->

<!-- spec:behaviors -->
- [x] Behavior one
- [ ] Behavior two
<!-- /spec:behaviors -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), specContent);

      // Create src directory with matching files
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'ServiceA.ts'), 'export class ServiceA {}');
      fs.writeFileSync(path.join(srcDir, 'ServiceB.ts'), 'export class ServiceB {}');

      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report = await service.runPreflightCheck('my-feature');

      expect(report.coverage).toBeDefined();

      // Components: 1/2 = 0.5
      expect(report.coverage.components.total).toBe(2);
      expect(report.coverage.components.implemented).toBe(1);
      expect(report.coverage.components.ratio).toBe(0.5);

      // Criteria: 2/3 = 0.6666...
      expect(report.coverage.criteria.total).toBe(3);
      expect(report.coverage.criteria.implemented).toBe(2);
      expect(report.coverage.criteria.ratio).toBeCloseTo(0.6667, 3);

      // Behaviors: 1/2 = 0.5
      expect(report.coverage.behaviors.total).toBe(2);
      expect(report.coverage.behaviors.implemented).toBe(1);
      expect(report.coverage.behaviors.ratio).toBe(0.5);
    });

    /**
     * @behavior runPreflightCheck returns 'pass' when no drift
     * @acceptance-criteria AC-PREFLIGHT.4
     */
    it('returns status "pass" when no drift detected', async () => {
      // Create feature directory with DESIGN.md - all items checked
      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'clean-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      const specContent = `
# Feature: Clean Feature

<!-- spec:components -->
- [x] CleanService - All implemented
<!-- /spec:components -->

<!-- spec:criteria -->
- [x] SC-001: All criteria met
<!-- /spec:criteria -->

<!-- spec:behaviors -->
- [x] All behaviors implemented
<!-- /spec:behaviors -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), specContent);

      // Create src directory with matching file
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'CleanService.ts'), 'export class CleanService {}');

      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report = await service.runPreflightCheck('clean-feature');

      expect(report.status).toBe('pass');
      expect(report.drifts).toHaveLength(0);
    });

    /**
     * @behavior runPreflightCheck returns 'drift_detected' when drift found
     * @acceptance-criteria AC-PREFLIGHT.5
     */
    it('returns status "drift_detected" when drift is found', async () => {
      // Create feature directory with DESIGN.md - unchecked items, no matching files
      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'drifty-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      const specContent = `
# Feature: Drifty Feature

<!-- spec:components -->
- [ ] MissingService - Not implemented
<!-- /spec:components -->

<!-- spec:criteria -->
<!-- /spec:criteria -->

<!-- spec:behaviors -->
<!-- /spec:behaviors -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), specContent);

      // Create empty src directory - no files
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report = await service.runPreflightCheck('drifty-feature');

      expect(report.status).toBe('drift_detected');
      expect(report.drifts.length).toBeGreaterThan(0);
    });

    /**
     * @behavior runPreflightCheck includes timestamp
     * @acceptance-criteria AC-PREFLIGHT.2
     */
    it('includes ISO 8601 timestamp in report', async () => {
      // Create feature directory
      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'timestamped');
      fs.mkdirSync(featureDir, { recursive: true });

      const specContent = `
# Feature: Timestamped

<!-- spec:components -->
<!-- /spec:components -->

<!-- spec:criteria -->
<!-- /spec:criteria -->

<!-- spec:behaviors -->
<!-- /spec:behaviors -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), specContent);

      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const before = new Date().toISOString();
      const report = await service.runPreflightCheck('timestamped');
      const after = new Date().toISOString();

      expect(report.timestamp).toBeDefined();
      // Validate ISO 8601 format
      expect(() => new Date(report.timestamp)).not.toThrow();
      expect(report.timestamp >= before).toBe(true);
      expect(report.timestamp <= after).toBe(true);
    });

    /**
     * @behavior runPreflightCheck returns error status when spec file missing
     * @acceptance-criteria AC-PREFLIGHT.5
     */
    it('returns status "error" when spec file does not exist', async () => {
      // No feature directory - spec file does not exist
      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report = await service.runPreflightCheck('nonexistent-feature');

      expect(report.status).toBe('error');
      expect(report.drifts).toHaveLength(0);
    });
  });

  // ============================================================================
  // Task 6.2: User Choice Handler
  // ============================================================================

  describe('handleUserChoice', () => {
    /**
     * @behavior handleUserChoice('fix') queues reconciliation tasks
     * @acceptance-criteria AC-PREFLIGHT.6
     */
    it('queues reconciliation tasks when choice is "fix"', async () => {
      // Create feature directory with DESIGN.md
      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'fix-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      const specContent = `
# Feature: Fix Feature

<!-- spec:components -->
- [ ] FixService - Needs fixing
<!-- /spec:components -->

<!-- spec:criteria -->
<!-- /spec:criteria -->

<!-- spec:behaviors -->
<!-- /spec:behaviors -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), specContent);

      // Create src with matching file
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'FixService.ts'), 'export class FixService {}');

      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report: PreflightReport = {
        status: 'drift_detected',
        feature: 'fix-feature',
        specPath: path.join(featureDir, 'DESIGN.md'),
        coverage: {
          components: { total: 1, implemented: 0, ratio: 0 },
          criteria: { total: 0, implemented: 0, ratio: 0 },
          behaviors: { total: 0, implemented: 0, ratio: 0 },
        },
        drifts: [
          {
            type: 'structural_missing',
            confidence: 1.0,
            description: 'Component unchecked but file exists',
            specItem: {
              id: 'FixService',
              description: 'Needs fixing',
              status: 'unchecked',
              type: 'component',
            },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const result = await service.handleUserChoice('fix', report);

      expect(result.action).toBe('fix');
      expect(result.success).toBe(true);
      expect(result.details.toLowerCase()).toContain('reconcil');
    });

    /**
     * @behavior handleUserChoice('proceed') logs accepted drift and continues
     * @acceptance-criteria AC-PREFLIGHT.7
     */
    it('logs accepted drift when choice is "proceed"', async () => {
      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report: PreflightReport = {
        status: 'drift_detected',
        feature: 'proceed-feature',
        specPath: '/path/to/DESIGN.md',
        coverage: {
          components: { total: 1, implemented: 0, ratio: 0 },
          criteria: { total: 0, implemented: 0, ratio: 0 },
          behaviors: { total: 0, implemented: 0, ratio: 0 },
        },
        drifts: [
          {
            type: 'structural_missing',
            confidence: 1.0,
            description: 'Component missing',
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const result = await service.handleUserChoice('proceed', report);

      expect(result.action).toBe('proceed');
      expect(result.success).toBe(true);
      expect(result.details).toContain('accept');
    });

    /**
     * @behavior handleUserChoice('update') modifies spec file
     * @acceptance-criteria AC-PREFLIGHT.8
     */
    it('modifies spec file when choice is "update"', async () => {
      // Create feature directory with DESIGN.md
      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'update-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      const specContent = `
# Feature: Update Feature

<!-- spec:components -->
- [ ] UpdateService - Needs updating
<!-- /spec:components -->

<!-- spec:criteria -->
<!-- /spec:criteria -->

<!-- spec:behaviors -->
<!-- /spec:behaviors -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), specContent);

      // Create src with matching file
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'UpdateService.ts'), 'export class UpdateService {}');

      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const specPath = path.join(featureDir, 'DESIGN.md');
      const report: PreflightReport = {
        status: 'drift_detected',
        feature: 'update-feature',
        specPath,
        coverage: {
          components: { total: 1, implemented: 0, ratio: 0 },
          criteria: { total: 0, implemented: 0, ratio: 0 },
          behaviors: { total: 0, implemented: 0, ratio: 0 },
        },
        drifts: [
          {
            type: 'structural_missing',
            confidence: 1.0,
            description: 'Component unchecked but file exists',
            specItem: {
              id: 'UpdateService',
              description: 'Needs updating',
              status: 'unchecked',
              type: 'component',
            },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const result = await service.handleUserChoice('update', report);

      expect(result.action).toBe('update');
      expect(result.success).toBe(true);
      expect(result.details).toContain('spec');

      // Verify the spec file was updated (checkbox checked)
      const updatedContent = fs.readFileSync(specPath, 'utf-8');
      expect(updatedContent).toContain('- [x] UpdateService');
    });

    /**
     * @behavior handleUserChoice returns action result
     * @acceptance-criteria AC-PREFLIGHT.6
     */
    it('returns ChoiceResult with action, success, and details', async () => {
      const service = new BuildPreflightService(
        mockSpecMonitor,
        mockReconciler,
        testDir
      );

      const report: PreflightReport = {
        status: 'pass',
        feature: 'result-feature',
        specPath: '/path/to/DESIGN.md',
        coverage: {
          components: { total: 0, implemented: 0, ratio: 0 },
          criteria: { total: 0, implemented: 0, ratio: 0 },
          behaviors: { total: 0, implemented: 0, ratio: 0 },
        },
        drifts: [],
        timestamp: new Date().toISOString(),
      };

      const result = await service.handleUserChoice('proceed', report);

      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('details');
      expect(typeof result.action).toBe('string');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.details).toBe('string');
    });
  });
});
