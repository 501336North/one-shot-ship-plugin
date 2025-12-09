import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TestMonitor, TestResult } from '../src/monitors/test-monitor';
import { QueueManager } from '../src/queue/manager';
import { Task, CreateTaskInput } from '../src/types';

// Mock dependencies
vi.mock('../src/queue/manager');

/**
 * @behavior Test monitor detects test failures and flakiness
 * @acceptance-criteria AC-003.1, AC-003.2, AC-003.3, AC-003.4, AC-003.5
 */
describe('TestMonitor', () => {
  let monitor: TestMonitor;
  let mockQueueManager: {
    addTask: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockQueueManager = {
      addTask: vi.fn().mockResolvedValue({ id: 'task-123' } as Task),
      initialize: vi.fn().mockResolvedValue(undefined),
    };

    monitor = new TestMonitor(mockQueueManager as unknown as QueueManager);
  });

  // AC-003.1: Detects test failure from output
  describe('test failure detection', () => {
    it('should detect failure from vitest output', async () => {
      const output = `
 FAIL  test/auth.test.ts
   ✕ should authenticate user (15ms)

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
`;
      const result = await monitor.analyzeTestOutput(output);

      expect(result.hasFailures).toBe(true);
      expect(result.failedTests.length).toBeGreaterThan(0);
    });

    it('should detect failure from jest output', async () => {
      const output = `
FAIL src/auth.test.ts
  ● should authenticate user

    Expected: 200
    Received: 401

Test Suites: 1 failed, 1 total
Tests:       1 failed, 5 passed, 6 total
`;
      const result = await monitor.analyzeTestOutput(output);

      expect(result.hasFailures).toBe(true);
    });

    it('should detect success when all tests pass', async () => {
      const output = `
 ✓ test/auth.test.ts (6 tests) 120ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
`;
      const result = await monitor.analyzeTestOutput(output);

      expect(result.hasFailures).toBe(false);
      expect(result.failedTests.length).toBe(0);
    });

    it('should extract failed test name', async () => {
      const output = `
 FAIL  test/queue.test.ts
   ✕ should add task to queue (23ms)
`;
      const result = await monitor.analyzeTestOutput(output);

      expect(result.failedTests).toContain('should add task to queue');
    });

    it('should extract test file path', async () => {
      const output = `FAIL test/queue.test.ts`;
      const result = await monitor.analyzeTestOutput(output);

      expect(result.testFile).toBe('test/queue.test.ts');
    });

    it('should NOT detect false positives from build tool output', async () => {
      // This is the actual turbo output that was causing false positives
      const output = `
> agentic-dev-workflow@1.0.0 test
> turbo run test

• Packages in scope: @agentic/api, @agentic/cli, @agentic/database, @agentic/web
• Running test in 4 packages
• Remote caching disabled
@agentic/database:build: cache hit, replaying logs e8c7000a3fb356c2
@agentic/database:build:
@agentic/database:build: > @agentic/database@1.0.0 build
@agentic/database:build: > prisma generate --schema=./prisma/schema.prisma
@agentic/database:build:
@agentic/database:build: Prisma schema loaded from prisma/schema.prisma
@agentic/database:build:
@agentic/database:build: ✔ Generated Prisma Client (v5.22.0) to ./../../node_modules/@prisma/client in 75ms
@agentic/database:build:
@agentic/cli:build: CJS ⚡️ Build success in 87ms
@agentic/cli:build: ESM ⚡️ Build success in 88ms
@agentic/cli:build: DTS ⚡️ Build success in 1675ms

@agentic/cli:test:
@agentic/cli:test:  RUN  v3.2.4 /Users/ysl/dev/AgenticDevWorkflow/packages/cli
@agentic/cli:test:
@agentic/cli:test:  ✓ test/config.test.ts (12 tests) 6ms
@agentic/cli:test:  ✓ test/api-client.test.ts (9 tests) 364ms
@agentic/cli:test:
@agentic/cli:test:  Test Files  5 passed (5)
@agentic/cli:test:       Tests  40 passed (40)

 Tasks:    7 successful, 7 total
`;
      const result = await monitor.analyzeTestOutput(output);

      // Should NOT detect failures
      expect(result.hasFailures).toBe(false);
      expect(result.failedTests.length).toBe(0);
      // The Prisma checkmark should NOT be counted as a passed test
      expect(result.passedTests).not.toContain('Generated Prisma Client (v5.22.0) to ./../../node_modules/@prisma/client in 75ms');
    });

    it('should correctly identify passed tests from clean vitest output', async () => {
      // Clean vitest output without build noise
      const output = `
 RUN  v3.2.4 /project

 ✓ test/config.test.ts (12 tests) 6ms
   ✓ should load config correctly  2ms
   ✓ should save config correctly  3ms
 ✓ test/api.test.ts (5 tests) 10ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
`;
      const result = await monitor.analyzeTestOutput(output);

      expect(result.hasFailures).toBe(false);
      // Should find the indented individual test names
      expect(result.passedTests).toContain('should load config correctly');
      expect(result.passedTests).toContain('should save config correctly');
    });
  });

  // AC-003.2: Detects flaky tests (intermittent pass/fail)
  describe('flaky test detection', () => {
    it('should track test results over time', async () => {
      // First run - pass
      await monitor.recordTestRun('test/foo.test.ts', 'should work', true);
      // Second run - fail
      await monitor.recordTestRun('test/foo.test.ts', 'should work', false);
      // Third run - pass
      await monitor.recordTestRun('test/foo.test.ts', 'should work', true);

      const isFlaky = monitor.isTestFlaky('test/foo.test.ts', 'should work');
      expect(isFlaky).toBe(true);
    });

    it('should not mark consistent tests as flaky', async () => {
      // All passes
      await monitor.recordTestRun('test/bar.test.ts', 'should pass', true);
      await monitor.recordTestRun('test/bar.test.ts', 'should pass', true);
      await monitor.recordTestRun('test/bar.test.ts', 'should pass', true);

      const isFlaky = monitor.isTestFlaky('test/bar.test.ts', 'should pass');
      expect(isFlaky).toBe(false);
    });

    it('should not mark consistently failing tests as flaky', async () => {
      // All failures (broken, not flaky)
      await monitor.recordTestRun('test/broken.test.ts', 'should fail', false);
      await monitor.recordTestRun('test/broken.test.ts', 'should fail', false);
      await monitor.recordTestRun('test/broken.test.ts', 'should fail', false);

      const isFlaky = monitor.isTestFlaky('test/broken.test.ts', 'should fail');
      expect(isFlaky).toBe(false);
    });

    it('should require minimum runs to detect flakiness', async () => {
      // Only one run
      await monitor.recordTestRun('test/new.test.ts', 'should work', true);

      const isFlaky = monitor.isTestFlaky('test/new.test.ts', 'should work');
      expect(isFlaky).toBe(false); // Not enough data
    });

    it('should create task for flaky test detection', async () => {
      await monitor.recordTestRun('test/flaky.test.ts', 'intermittent test', true);
      await monitor.recordTestRun('test/flaky.test.ts', 'intermittent test', false);
      await monitor.recordTestRun('test/flaky.test.ts', 'intermittent test', true);

      await monitor.reportFlakyTests();

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'test_flaky',
          priority: 'medium',
          source: 'test-monitor',
        })
      );
    });
  });

  // AC-003.3: Detects coverage drops (if configured)
  describe('coverage monitoring', () => {
    it('should detect coverage drop below threshold', async () => {
      monitor.setBaselineCoverage(80);

      const result = await monitor.checkCoverage(75);

      expect(result.hasDrop).toBe(true);
      expect(result.drop).toBe(5);
    });

    it('should not alert when coverage maintained', async () => {
      monitor.setBaselineCoverage(80);

      const result = await monitor.checkCoverage(82);

      expect(result.hasDrop).toBe(false);
    });

    it('should create task for coverage drop', async () => {
      monitor.setBaselineCoverage(80);

      await monitor.checkCoverage(70);
      await monitor.reportCoverageDrop(70, 80);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'coverage_drop',
          priority: 'medium',
          source: 'test-monitor',
        })
      );
    });

    it('should include coverage details in context', async () => {
      monitor.setBaselineCoverage(85);

      await monitor.reportCoverageDrop(72, 85);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            analysis: expect.stringContaining('72%'),
          }),
        })
      );
    });
  });

  // AC-003.4: Creates high-priority task for test failures
  describe('failure task creation', () => {
    it('should create high-priority task for test failure', async () => {
      const testResult: TestResult = {
        hasFailures: true,
        testFile: 'test/critical.test.ts',
        failedTests: ['should not crash'],
        passedTests: [],
        totalTests: 1,
        duration: 100,
        output: 'FAIL test/critical.test.ts',
      };

      await monitor.reportFailure(testResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'test_failure',
          priority: 'high',
          source: 'test-monitor',
        })
      );
    });

    it('should suggest debugger agent for failures', async () => {
      const testResult: TestResult = {
        hasFailures: true,
        testFile: 'test/foo.test.ts',
        failedTests: ['test 1'],
        passedTests: [],
        totalTests: 1,
        duration: 50,
        output: '',
      };

      await monitor.reportFailure(testResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          suggested_agent: 'debugger',
        })
      );
    });
  });

  // AC-003.5: Includes failure details in task context
  describe('failure context', () => {
    it('should include test file in context', async () => {
      const testResult: TestResult = {
        hasFailures: true,
        testFile: 'test/auth.test.ts',
        failedTests: ['should login'],
        passedTests: [],
        totalTests: 1,
        duration: 100,
        output: '',
      };

      await monitor.reportFailure(testResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            test_file: 'test/auth.test.ts',
          }),
        })
      );
    });

    it('should include test name in context', async () => {
      const testResult: TestResult = {
        hasFailures: true,
        testFile: 'test/auth.test.ts',
        failedTests: ['should authenticate user with valid credentials'],
        passedTests: [],
        totalTests: 1,
        duration: 100,
        output: '',
      };

      await monitor.reportFailure(testResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            test_name: 'should authenticate user with valid credentials',
          }),
        })
      );
    });

    it('should include failure count in context', async () => {
      const testResult: TestResult = {
        hasFailures: true,
        testFile: 'test/suite.test.ts',
        failedTests: ['test 1', 'test 2', 'test 3'],
        passedTests: ['test 4'],
        totalTests: 4,
        duration: 200,
        output: '',
      };

      await monitor.reportFailure(testResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            failure_count: 3,
          }),
        })
      );
    });

    it('should include error excerpt in context', async () => {
      const testResult: TestResult = {
        hasFailures: true,
        testFile: 'test/error.test.ts',
        failedTests: ['should handle error'],
        passedTests: [],
        totalTests: 1,
        duration: 50,
        output: 'Error: Expected 200 but got 500',
      };

      await monitor.reportFailure(testResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            last_error: expect.stringContaining('Expected 200'),
          }),
        })
      );
    });
  });

  // Test history management
  describe('test history', () => {
    it('should limit history per test', async () => {
      // Record more than limit
      for (let i = 0; i < 15; i++) {
        await monitor.recordTestRun('test/spam.test.ts', 'lots of runs', i % 2 === 0);
      }

      const history = monitor.getTestHistory('test/spam.test.ts', 'lots of runs');
      expect(history.length).toBeLessThanOrEqual(10); // Default limit
    });

    it('should clear history on reset', async () => {
      await monitor.recordTestRun('test/clear.test.ts', 'will be cleared', true);

      monitor.reset();

      const history = monitor.getTestHistory('test/clear.test.ts', 'will be cleared');
      expect(history.length).toBe(0);
    });
  });
});
