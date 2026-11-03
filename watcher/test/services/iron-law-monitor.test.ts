/**
 * IronLawMonitor Tests
 *
 * @behavior Continuously monitors for IRON LAW violations
 * @acceptance-criteria AC-IRON.1 through AC-IRON.12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';

// Mock child_process for git commands
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Import after mocks
import { IronLawMonitor, IronLawViolation, IronLawState } from '../../src/services/iron-law-monitor.js';

describe('IronLawMonitor', () => {
  let monitor: IronLawMonitor;
  // Real files in a sandbox (T70e): the project, and HOME with the state file in its .oss
  let sandbox: string;
  let projectDir: string;
  let stateFile: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-iron-law-')));
    projectDir = path.join(sandbox, 'project');
    fs.mkdirSync(projectDir);
    originalHome = process.env.HOME;
    process.env.HOME = path.join(sandbox, 'home');
    // Default: no state file yet
    stateFile = path.join(sandbox, 'home', '.oss', 'iron-law-state.json');
    // Default: git branch is feature branch
    vi.mocked(childProcess.execSync).mockReturnValue('feature/test-branch');

    monitor = new IronLawMonitor({ projectDir, stateFile });
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env.HOME = originalHome;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  // ===========================================================================
  // IRON LAW #4: Git Flow Detection
  // ===========================================================================

  describe('IRON LAW #4: Git Branch Monitoring', () => {
    /**
     * @behavior Detects when agent is working on main branch
     * @acceptance-criteria AC-IRON.1
     */
    it('should detect main branch as violation', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('main');

      const violations = await monitor.check();

      expect(violations).toHaveLength(1);
      expect(violations[0].law).toBe(4);
      expect(violations[0].type).toBe('iron_law_branch');
      expect(violations[0].message).toContain('main');
    });

    /**
     * @behavior Detects when agent is working on master branch
     * @acceptance-criteria AC-IRON.2
     */
    it('should detect master branch as violation', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('master');

      const violations = await monitor.check();

      expect(violations).toHaveLength(1);
      expect(violations[0].law).toBe(4);
      expect(violations[0].type).toBe('iron_law_branch');
    });

    /**
     * @behavior Feature branches are not violations
     * @acceptance-criteria AC-IRON.3
     */
    it('should not flag feature branches', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('feat/my-feature');

      const violations = await monitor.check();

      const branchViolations = violations.filter(v => v.type === 'iron_law_branch');
      expect(branchViolations).toHaveLength(0);
    });

    /**
     * @behavior Handles git errors gracefully
     * @acceptance-criteria AC-IRON.4
     */
    it('should handle git errors gracefully', async () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      // Should not throw
      const violations = await monitor.check();
      expect(violations).toBeDefined();
    });
  });

  // ===========================================================================
  // IRON LAW #1: TDD Detection
  // ===========================================================================

  describe('IRON LAW #1: TDD Monitoring', () => {
    /**
     * @behavior Detects new source files without corresponding test files
     * @acceptance-criteria AC-IRON.5
     */
    it('should detect new .ts file without .test.ts', async () => {
      // Track a file change
      monitor.trackFileChange('/test/project/src/service.ts', 'created');

      const violations = await monitor.check();

      const tddViolations = violations.filter(v => v.type === 'iron_law_tdd');
      expect(tddViolations).toHaveLength(1);
      expect(tddViolations[0].message).toContain('service.ts');
    });

    /**
     * @behavior Does not flag test files themselves
     * @acceptance-criteria AC-IRON.6
     */
    it('should not flag test files', async () => {
      monitor.trackFileChange('/test/project/src/service.test.ts', 'created');

      const violations = await monitor.check();

      const tddViolations = violations.filter(v => v.type === 'iron_law_tdd');
      expect(tddViolations).toHaveLength(0);
    });

    /**
     * @behavior Clears TDD violation when test file is created
     * @acceptance-criteria AC-IRON.7
     */
    it('should clear violation when test is created', async () => {
      // First, source file without test
      monitor.trackFileChange('/test/project/src/service.ts', 'created');
      let violations = await monitor.check();
      expect(violations.filter(v => v.type === 'iron_law_tdd')).toHaveLength(1);

      // Then, test file created
      monitor.trackFileChange('/test/project/src/service.test.ts', 'created');
      violations = await monitor.check();
      expect(violations.filter(v => v.type === 'iron_law_tdd')).toHaveLength(0);
    });

    /**
     * @behavior Tracks write order for TDD enforcement
     * @acceptance-criteria AC-IRON.8
     */
    it('should detect code written before test', async () => {
      // Code written first (violation)
      monitor.trackToolCall('Write', '/test/project/src/service.ts');

      const violations = await monitor.check();

      const tddViolations = violations.filter(v => v.type === 'iron_law_tdd');
      expect(tddViolations.length).toBeGreaterThan(0);
    });

    /**
     * @behavior Test written first is not a violation
     * @acceptance-criteria AC-IRON.9
     */
    it('should not flag when test written first', async () => {
      // Test written first (correct TDD)
      monitor.trackToolCall('Write', '/test/project/src/service.test.ts');
      monitor.trackToolCall('Write', '/test/project/src/service.ts');

      const violations = await monitor.check();

      const tddViolations = violations.filter(v => v.type === 'iron_law_tdd');
      expect(tddViolations).toHaveLength(0);
    });
  });

  // ===========================================================================
  // IRON LAW #6: Dev Docs Monitoring
  // ===========================================================================

  describe('IRON LAW #6: Dev Docs Monitoring', () => {
    /**
     * @behavior Detects missing PROGRESS.md when dev/active work is happening
     * @acceptance-criteria AC-IRON.10
     */
    it('should detect missing PROGRESS.md for active feature', async () => {
      // the feature's dev docs folder exists, without PROGRESS.md
      fs.mkdirSync(path.join(projectDir, '.oss', 'dev', 'active', 'my-feature'), { recursive: true });

      monitor.setActiveFeature('my-feature');
      const violations = await monitor.check();

      const docViolations = violations.filter(v => v.type === 'iron_law_docs');
      expect(docViolations).toHaveLength(1);
    });

    /**
     * @behavior Does not flag when PROGRESS.md exists
     * @acceptance-criteria AC-IRON.11
     */
    it('should not flag when PROGRESS.md exists', async () => {
      const feature = path.join(projectDir, '.oss', 'dev', 'active', 'my-feature');
      fs.mkdirSync(feature, { recursive: true });
      fs.writeFileSync(path.join(feature, 'PROGRESS.md'), '# Progress\n');

      monitor.setActiveFeature('my-feature');
      const violations = await monitor.check();

      const docViolations = violations.filter(v => v.type === 'iron_law_docs');
      expect(docViolations).toHaveLength(0);
    });
  });

  // ===========================================================================
  // State Management
  // ===========================================================================

  describe('State Management', () => {
    /**
     * @behavior Persists violations to state file
     * @acceptance-criteria AC-IRON.12
     */
    it('should save state to file', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('main');

      await monitor.check();

      expect(fs.readFileSync(stateFile, 'utf-8')).toContain('iron_law_branch');
    });

    /**
     * @behavior Loads previous state on initialization
     */
    it('should load previous state', () => {
      const previousState: IronLawState = {
        lastCheck: new Date().toISOString(),
        violations: [
          {
            law: 4,
            type: 'iron_law_branch',
            message: 'On main branch',
            detected: new Date().toISOString(),
            resolved: null,
          },
        ],
        recentFileChanges: [],
        recentToolCalls: [],
      };

      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(previousState));

      const newMonitor = new IronLawMonitor({ projectDir, stateFile });
      const state = newMonitor.getState();

      expect(state.violations).toHaveLength(1);
      expect(state.violations[0].type).toBe('iron_law_branch');
    });

    /**
     * @behavior Marks violations as resolved when fixed
     */
    it('should mark violations as resolved when fixed', async () => {
      // First: violation detected
      vi.mocked(childProcess.execSync).mockReturnValue('main');
      await monitor.check();

      let state = monitor.getState();
      expect(state.violations[0].resolved).toBeNull();

      // Then: fixed (on feature branch)
      vi.mocked(childProcess.execSync).mockReturnValue('feat/fix');
      await monitor.check();

      state = monitor.getState();
      const branchViolation = state.violations.find(v => v.type === 'iron_law_branch');
      expect(branchViolation?.resolved).not.toBeNull();
    });
  });

  // ===========================================================================
  // Corrective Actions
  // ===========================================================================

  describe('Corrective Actions', () => {
    /**
     * @behavior Returns corrective action for branch violation
     */
    it('should return corrective action for branch violation', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('main');

      const violations = await monitor.check();

      expect(violations[0].correctiveAction).toBeDefined();
      expect(violations[0].correctiveAction).toContain('git checkout -b');
    });

    /**
     * @behavior Returns corrective action for TDD violation
     */
    it('should return corrective action for TDD violation', async () => {
      monitor.trackFileChange('/test/project/src/service.ts', 'created');

      const violations = await monitor.check();
      const tddViolation = violations.find(v => v.type === 'iron_law_tdd');

      expect(tddViolation?.correctiveAction).toBeDefined();
      expect(tddViolation?.correctiveAction).toContain('test');
    });
  });
});
