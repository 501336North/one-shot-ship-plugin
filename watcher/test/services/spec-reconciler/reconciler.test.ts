/**
 * Spec Reconciler Tests
 *
 * @behavior SpecReconciler classifies drift and orchestrates reconciliation
 * @acceptance-criteria AC-RECONCILER.1 through AC-RECONCILER.12
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { classifyDrift, SpecReconciler } from '../../../src/services/spec-reconciler/reconciler.js';
import { DriftResult, SpecItem } from '../../../src/services/spec-reconciler/types.js';
import { QueueManager } from '../../../src/queue/manager.js';

describe('SpecReconciler', () => {
  describe('classifyDrift', () => {
    /**
     * @behavior classifyDrift returns 'simple' for checkbox updates when file exists
     * @acceptance-criteria AC-RECONCILER.1
     */
    it('returns "simple" for unchecked component when file exists', async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconciler-test-'));
      try {
        // Create a component file that exists
        const componentPath = path.join(testDir, 'AuthService.ts');
        fs.writeFileSync(componentPath, 'export class AuthService {}');

        const specItem: SpecItem = {
          id: 'AuthService',
          description: 'Handles authentication',
          status: 'unchecked',
          type: 'component',
        };

        const drift: DriftResult = {
          type: 'structural_missing',
          confidence: 0.95,
          description: 'Component "AuthService" is in spec but marked unchecked',
          specItem,
        };

        const result = await classifyDrift(drift, [testDir]);

        expect(result).toBe('simple');
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    /**
     * @behavior classifyDrift returns 'complex' for behavioral_mismatch
     * @acceptance-criteria AC-RECONCILER.2
     */
    it('returns "complex" for behavioral_mismatch', async () => {
      const drift: DriftResult = {
        type: 'behavioral_mismatch',
        confidence: 0.8,
        description: 'Behavior does not match implementation',
      };

      const result = await classifyDrift(drift, []);

      expect(result).toBe('complex');
    });

    /**
     * @behavior classifyDrift returns 'complex' for structural_missing when file does not exist
     * @acceptance-criteria AC-RECONCILER.3
     */
    it('returns "complex" for structural_missing when file does not exist', async () => {
      const specItem: SpecItem = {
        id: 'MissingComponent',
        description: 'Component that does not exist',
        status: 'unchecked',
        type: 'component',
      };

      const drift: DriftResult = {
        type: 'structural_missing',
        confidence: 1.0,
        description: 'Component "MissingComponent" is in spec but has no matching file',
        specItem,
      };

      // Empty search paths - file definitely won't be found
      const result = await classifyDrift(drift, []);

      expect(result).toBe('complex');
    });

    /**
     * @behavior classifyDrift returns 'simple' when confidence > 0.9
     * @acceptance-criteria AC-RECONCILER.4
     */
    it('returns "simple" when confidence > 0.9 for structural_extra', async () => {
      const drift: DriftResult = {
        type: 'structural_extra',
        confidence: 0.95,
        description: 'Extra file found not in spec',
        filePath: '/some/path/Extra.ts',
      };

      const result = await classifyDrift(drift, []);

      expect(result).toBe('simple');
    });

    /**
     * @behavior classifyDrift returns 'complex' for low confidence drift
     * @acceptance-criteria AC-RECONCILER.5
     */
    it('returns "complex" when confidence <= 0.9 for non-checkbox scenarios', async () => {
      const drift: DriftResult = {
        type: 'criteria_incomplete',
        confidence: 0.7,
        description: 'Low confidence drift',
      };

      const result = await classifyDrift(drift, []);

      expect(result).toBe('complex');
    });
  });

  describe('SpecReconciler.queueDriftTask', () => {
    let testDir: string;
    let mockQueueManager: QueueManager;

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconciler-queue-test-'));
      mockQueueManager = new QueueManager(testDir);
      await mockQueueManager.initialize();
      vi.clearAllMocks();
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    /**
     * @behavior queueDriftTask creates task with anomaly_type 'spec_drift_structural'
     * @acceptance-criteria AC-RECONCILER.6
     */
    it('creates task with anomaly_type "spec_drift_structural" for structural drift', async () => {
      const reconciler = new SpecReconciler(mockQueueManager);
      const drift: DriftResult = {
        type: 'structural_missing',
        confidence: 1.0,
        description: 'Component missing',
        specItem: {
          id: 'TestComponent',
          description: 'Test',
          status: 'unchecked',
          type: 'component',
        },
      };

      await reconciler.queueDriftTask(drift, 'test-feature', '/path/to/DESIGN.md');

      const tasks = await mockQueueManager.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].anomaly_type).toBe('spec_drift_structural');
    });

    /**
     * @behavior queueDriftTask assigns 'debugger' agent for structural drift
     * @acceptance-criteria AC-RECONCILER.7
     */
    it('assigns "debugger" agent for structural drift', async () => {
      const reconciler = new SpecReconciler(mockQueueManager);
      const drift: DriftResult = {
        type: 'structural_missing',
        confidence: 1.0,
        description: 'Component missing',
      };

      await reconciler.queueDriftTask(drift, 'test-feature', '/path/to/DESIGN.md');

      const tasks = await mockQueueManager.getTasks();
      expect(tasks[0].suggested_agent).toBe('debugger');
    });

    /**
     * @behavior queueDriftTask assigns 'code-reviewer' agent for behavioral drift
     * @acceptance-criteria AC-RECONCILER.8
     */
    it('assigns "code-reviewer" agent for behavioral drift', async () => {
      const reconciler = new SpecReconciler(mockQueueManager);
      const drift: DriftResult = {
        type: 'behavioral_mismatch',
        confidence: 0.8,
        description: 'Behavior mismatch',
      };

      await reconciler.queueDriftTask(drift, 'test-feature', '/path/to/DESIGN.md');

      const tasks = await mockQueueManager.getTasks();
      expect(tasks[0].suggested_agent).toBe('code-reviewer');
    });

    /**
     * @behavior queueDriftTask includes feature context
     * @acceptance-criteria AC-RECONCILER.9
     */
    it('includes feature context in task', async () => {
      const reconciler = new SpecReconciler(mockQueueManager);
      const drift: DriftResult = {
        type: 'structural_missing',
        confidence: 1.0,
        description: 'Component missing',
        specItem: {
          id: 'TestComponent',
          description: 'Test description',
          status: 'unchecked',
          type: 'component',
        },
      };

      await reconciler.queueDriftTask(drift, 'auth-feature', '/path/to/DESIGN.md');

      const tasks = await mockQueueManager.getTasks();
      expect(tasks[0].context.feature).toBe('auth-feature');
      expect(tasks[0].context.spec_path).toBe('/path/to/DESIGN.md');
      expect(tasks[0].context.drift_type).toBe('structural_missing');
      expect(tasks[0].context.spec_item_id).toBe('TestComponent');
    });
  });

  describe('SpecReconciler.reconcile', () => {
    let testDir: string;
    let mockQueueManager: QueueManager;

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconciler-reconcile-test-'));
      mockQueueManager = new QueueManager(testDir);
      await mockQueueManager.initialize();
      vi.clearAllMocks();
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    /**
     * @behavior reconcile auto-fixes simple drifts
     * @acceptance-criteria AC-RECONCILER.10
     */
    it('auto-fixes simple drifts (checkbox updates)', async () => {
      // Create a spec file with an unchecked component
      const specPath = path.join(testDir, 'DESIGN.md');
      fs.writeFileSync(
        specPath,
        `# Feature

<!-- spec:components -->
- [ ] AuthService - Handles authentication
<!-- /spec:components -->
`,
      );

      // Create the matching component file
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'AuthService.ts'), 'export class AuthService {}');

      const reconciler = new SpecReconciler(mockQueueManager);
      const drift: DriftResult = {
        type: 'structural_missing',
        confidence: 0.95,
        description: 'Component marked unchecked but file exists',
        specItem: {
          id: 'AuthService',
          description: 'Handles authentication',
          status: 'unchecked',
          type: 'component',
        },
      };

      const report = await reconciler.reconcile([drift], 'test-feature', specPath, [srcDir]);

      expect(report.fixed).toBe(1);
      expect(report.queued).toBe(0);
      expect(report.entries[0].action).toBe('auto_fixed');

      // Verify the spec file was updated
      const updatedContent = fs.readFileSync(specPath, 'utf-8');
      expect(updatedContent).toContain('- [x] AuthService');
    });

    /**
     * @behavior reconcile queues complex drifts
     * @acceptance-criteria AC-RECONCILER.11
     */
    it('queues complex drifts', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      fs.writeFileSync(specPath, '# Feature');

      const reconciler = new SpecReconciler(mockQueueManager);
      const drift: DriftResult = {
        type: 'behavioral_mismatch',
        confidence: 0.8,
        description: 'Behavior mismatch detected',
      };

      const report = await reconciler.reconcile([drift], 'test-feature', specPath, []);

      expect(report.fixed).toBe(0);
      expect(report.queued).toBe(1);
      expect(report.entries[0].action).toBe('queued');

      // Verify task was added to queue
      const tasks = await mockQueueManager.getTasks();
      expect(tasks).toHaveLength(1);
    });

    /**
     * @behavior reconcile returns reconciliation report
     * @acceptance-criteria AC-RECONCILER.12
     */
    it('returns reconciliation report with all entries', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      fs.writeFileSync(
        specPath,
        `# Feature

<!-- spec:components -->
- [ ] AuthService - Handles authentication
- [ ] MissingService - Does not exist
<!-- /spec:components -->
`,
      );

      // Create only one of the component files
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'AuthService.ts'), 'export class AuthService {}');

      const reconciler = new SpecReconciler(mockQueueManager);
      const drifts: DriftResult[] = [
        {
          type: 'structural_missing',
          confidence: 0.95,
          description: 'AuthService unchecked but exists',
          specItem: {
            id: 'AuthService',
            description: 'Handles authentication',
            status: 'unchecked',
            type: 'component',
          },
        },
        {
          type: 'structural_missing',
          confidence: 1.0,
          description: 'MissingService does not exist',
          specItem: {
            id: 'MissingService',
            description: 'Does not exist',
            status: 'unchecked',
            type: 'component',
          },
        },
      ];

      const report = await reconciler.reconcile(drifts, 'test-feature', specPath, [srcDir]);

      expect(report.feature).toBe('test-feature');
      expect(report.fixed).toBe(1);
      expect(report.queued).toBe(1);
      expect(report.failed).toBe(0);
      expect(report.entries).toHaveLength(2);

      // First drift should be auto-fixed (file exists)
      const fixedEntry = report.entries.find((e) => e.action === 'auto_fixed');
      expect(fixedEntry).toBeDefined();
      expect(fixedEntry?.drift_type).toBe('structural_missing');

      // Second drift should be queued (file doesn't exist)
      const queuedEntry = report.entries.find((e) => e.action === 'queued');
      expect(queuedEntry).toBeDefined();
    });
  });
});
