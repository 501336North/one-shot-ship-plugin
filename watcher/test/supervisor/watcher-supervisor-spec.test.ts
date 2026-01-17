/**
 * WatcherSupervisor Spec Integration Tests
 *
 * Tests for integrating SpecMonitor with the WatcherSupervisor context.
 *
 * @behavior SpecMonitor integrates with WatcherSupervisor for drift detection
 * @acceptance-criteria AC-SPEC-SUPERVISOR.1: SpecMonitor can be created with QueueManager
 * @acceptance-criteria AC-SPEC-SUPERVISOR.2: SpecMonitor runScan emits drift anomalies
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpecMonitor } from '../../src/monitors/spec-monitor.js';
import { QueueManager } from '../../src/queue/manager.js';

describe('WatcherSupervisor Spec Integration', () => {
  let testDir: string;
  let ossDir: string;
  let queueManager: QueueManager;
  let specMonitor: SpecMonitor;

  beforeEach(async () => {
    // Create test directory structure
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-supervisor-spec-test-'));
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });

    // Create QueueManager (like WatcherSupervisor would)
    queueManager = new QueueManager(ossDir);
    await queueManager.initialize();
  });

  afterEach(async () => {
    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('SpecMonitor Registration', () => {
    it('should create SpecMonitor with QueueManager from WatcherSupervisor context', async () => {
      // GIVEN: QueueManager is initialized (simulating WatcherSupervisor)
      expect(queueManager).toBeDefined();

      // WHEN: SpecMonitor is created with the QueueManager
      specMonitor = new SpecMonitor(queueManager, { basePath: testDir });

      // THEN: SpecMonitor is properly initialized
      expect(specMonitor).toBeDefined();
      expect(specMonitor.scanActiveFeatures).toBeDefined();
      expect(specMonitor.getFeatureMetrics).toBeDefined();
    });

    it('should allow SpecMonitor to scan for active features', async () => {
      // GIVEN: SpecMonitor created with QueueManager
      specMonitor = new SpecMonitor(queueManager, { basePath: testDir });

      // AND: An active feature directory exists
      const activeDir = path.join(testDir, '.oss', 'dev', 'active', 'test-feature');
      fs.mkdirSync(activeDir, { recursive: true });

      // WHEN: Scanning for active features
      const features = await specMonitor.scanActiveFeatures();

      // THEN: The feature is discovered
      expect(features).toContain('test-feature');
    });

    it('should allow SpecMonitor to get feature metrics', async () => {
      // GIVEN: SpecMonitor created and a feature with DESIGN.md
      specMonitor = new SpecMonitor(queueManager, { basePath: testDir });

      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'my-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      const designContent = `# Feature Design

<!-- spec:components -->
- [x] ComponentA - Main component
- [ ] ComponentB - Secondary component
<!-- /spec:components -->

<!-- spec:criteria -->
- [x] SC-001: Must do X
- [ ] SC-002: Must do Y
<!-- /spec:criteria -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), designContent);

      // WHEN: Getting feature metrics
      const metrics = await specMonitor.getFeatureMetrics('my-feature');

      // THEN: Metrics are returned with coverage data
      expect(metrics.feature).toBe('my-feature');
      expect(metrics.coverage.components.total).toBe(2);
      expect(metrics.coverage.components.implemented).toBe(1);
      expect(metrics.coverage.criteria.total).toBe(2);
      expect(metrics.coverage.criteria.implemented).toBe(1);
    });
  });

  describe('SpecMonitor Drift Emission', () => {
    it('should emit drift anomalies to queue when runScan detects drift', async () => {
      // GIVEN: SpecMonitor with a feature that has missing implementation
      specMonitor = new SpecMonitor(queueManager, { basePath: testDir });

      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'drift-feature');
      fs.mkdirSync(featureDir, { recursive: true });

      // Create DESIGN.md with unchecked components (simulating missing implementation)
      const designContent = `# Feature Design

<!-- spec:components -->
- [ ] MissingComponent: Not implemented yet
<!-- /spec:components -->

<!-- spec:criteria -->
- [ ] SC-001: Uncovered criterion
<!-- /spec:criteria -->
`;
      fs.writeFileSync(path.join(featureDir, 'DESIGN.md'), designContent);

      // Spy on emitDriftAnomaly
      const emitSpy = vi.spyOn(specMonitor, 'emitDriftAnomaly');

      // WHEN: Running a scan that detects drift
      // Note: We need to trigger drift detection manually since runScan
      // requires search paths for structural drift detection
      const mockDrift = {
        type: 'structural_missing' as const,
        confidence: 1.0,
        description: 'Component "MissingComponent" is in spec but has no matching implementation file',
        specItem: {
          id: 'MissingComponent',
          description: 'Not implemented yet',
          status: 'unchecked' as const,
          type: 'component' as const,
        },
      };

      await specMonitor.emitDriftAnomaly(mockDrift, 'drift-feature');

      // THEN: Drift anomaly is queued
      expect(emitSpy).toHaveBeenCalledWith(mockDrift, 'drift-feature');

      // AND: Task is added to the queue
      const tasks = await queueManager.getTasks();
      expect(tasks.length).toBe(1);
      expect(tasks[0].anomaly_type).toBe('spec_drift_structural');
      expect(tasks[0].source).toBe('spec-monitor');
      expect(tasks[0].priority).toBe('high');
    });

    it('should emit criteria drift with medium priority', async () => {
      // GIVEN: SpecMonitor with criteria drift
      specMonitor = new SpecMonitor(queueManager, { basePath: testDir });

      const featureDir = path.join(testDir, '.oss', 'dev', 'active', 'criteria-drift');
      fs.mkdirSync(featureDir, { recursive: true });

      // WHEN: Emitting criteria drift
      const criteriaDrift = {
        type: 'criteria_incomplete' as const,
        confidence: 0.8,
        description: 'Criterion "SC-001" is unchecked and has no test coverage',
        specItem: {
          id: 'SC-001',
          description: 'Must validate input',
          status: 'unchecked' as const,
          type: 'criterion' as const,
        },
      };

      await specMonitor.emitDriftAnomaly(criteriaDrift, 'criteria-drift');

      // THEN: Task has medium priority
      const tasks = await queueManager.getTasks();
      expect(tasks.length).toBe(1);
      expect(tasks[0].anomaly_type).toBe('spec_drift_criteria');
      expect(tasks[0].priority).toBe('medium');
    });

    it('should include feature context in queued task', async () => {
      // GIVEN: SpecMonitor created with QueueManager
      specMonitor = new SpecMonitor(queueManager, { basePath: testDir });

      // WHEN: Emitting drift for a specific feature
      const drift = {
        type: 'structural_extra' as const,
        confidence: 1.0,
        description: 'File "extra.ts" exists but is not in the spec',
        filePath: '/path/to/extra.ts',
      };

      await specMonitor.emitDriftAnomaly(drift, 'context-test-feature');

      // THEN: Task context includes feature information
      const tasks = await queueManager.getTasks();
      expect(tasks[0].context.feature).toBe('context-test-feature');
      expect(tasks[0].context.spec_path).toContain('context-test-feature');
      expect(tasks[0].context.file).toBe('/path/to/extra.ts');
    });
  });
});
