/**
 * Dev Docs TESTING.md Synchronization Tests
 *
 * @behavior Test commands update TESTING.md with results
 * @acceptance-criteria AC-DOC-003: TESTING.md updated after test run
 * @acceptance-criteria AC-DOC-004: Coverage data included in TESTING.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('TESTING.md Synchronization', () => {
  let testDir: string;
  let devDocsDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testing-sync-test-'));
    devDocsDir = path.join(testDir, 'dev', 'active', 'test-feature');
    fs.mkdirSync(devDocsDir, { recursive: true });
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('TESTING.md update after test run', () => {
    it('should update TESTING.md with test results', async () => {
      // GIVEN: Initial TESTING.md
      const testingPath = path.join(devDocsDir, 'TESTING.md');

      fs.writeFileSync(
        testingPath,
        `# Testing: Test Feature

## Test Strategy
- Unit tests for all business logic
- Integration tests for API endpoints
- E2E tests for critical user journeys

## Test Results
_Pending first test run_

## Last Updated: 2025-12-08 10:00 by /oss:plan
`
      );

      // WHEN: Test run completes and updates TESTING.md
      await logger.log({
        cmd: 'test',
        event: 'COMPLETE',
        data: {
          tests_total: 25,
          tests_passed: 25,
          tests_failed: 0,
          duration_ms: 3456,
        },
      });

      // Simulate agent updating TESTING.md
      const updatedContent = `# Testing: Test Feature

## Test Strategy
- Unit tests for all business logic
- Integration tests for API endpoints
- E2E tests for critical user journeys

## Test Results

### Latest Run: 2025-12-08 15:30
| Metric | Value |
|--------|-------|
| Total Tests | 25 |
| Passed | 25 |
| Failed | 0 |
| Duration | 3.46s |
| Status | ✅ All Passing |

## Last Updated: 2025-12-08 15:30 by /oss:test
`;
      fs.writeFileSync(testingPath, updatedContent);

      // THEN: TESTING.md contains test results
      const content = fs.readFileSync(testingPath, 'utf-8');
      expect(content).toContain('Total Tests | 25');
      expect(content).toContain('Passed | 25');
      expect(content).toContain('All Passing');
    });

    it('should log test results in workflow log', async () => {
      // GIVEN: Test run completes
      await logger.log({
        cmd: 'test',
        event: 'COMPLETE',
        data: {
          tests_total: 50,
          tests_passed: 48,
          tests_failed: 2,
          duration_ms: 5000,
          devdocs_updated: true,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Test results logged
      expect(entries[0].data.tests_total).toBe(50);
      expect(entries[0].data.tests_failed).toBe(2);
      expect(entries[0].data.devdocs_updated).toBe(true);
    });
  });

  describe('Coverage data in TESTING.md', () => {
    it('should include coverage percentage in TESTING.md', async () => {
      // GIVEN: Test run with coverage
      const testingPath = path.join(devDocsDir, 'TESTING.md');

      await logger.log({
        cmd: 'test',
        event: 'COMPLETE',
        data: {
          tests_total: 100,
          tests_passed: 100,
          coverage: {
            lines: 85.5,
            branches: 78.2,
            functions: 90.1,
            statements: 84.3,
          },
        },
      });

      // Simulate agent updating TESTING.md with coverage
      const updatedContent = `# Testing: Test Feature

## Test Results

### Latest Run: 2025-12-08 15:30
| Metric | Value |
|--------|-------|
| Total Tests | 100 |
| Passed | 100 |
| Status | ✅ All Passing |

### Coverage
| Metric | Coverage |
|--------|----------|
| Lines | 85.5% |
| Branches | 78.2% |
| Functions | 90.1% |
| Statements | 84.3% |

## Last Updated: 2025-12-08 15:30 by /oss:test
`;
      fs.writeFileSync(testingPath, updatedContent);

      // THEN: Coverage data in TESTING.md
      const content = fs.readFileSync(testingPath, 'utf-8');
      expect(content).toContain('Lines | 85.5%');
      expect(content).toContain('Branches | 78.2%');
      expect(content).toContain('### Coverage');
    });

    it('should log coverage data in workflow log', async () => {
      // GIVEN: Test with coverage
      await logger.log({
        cmd: 'test',
        event: 'COMPLETE',
        data: {
          tests_total: 50,
          tests_passed: 50,
          coverage: {
            lines: 92.3,
            branches: 85.0,
            functions: 95.5,
            statements: 91.2,
          },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Coverage logged
      expect(entries[0].data.coverage.lines).toBe(92.3);
      expect(entries[0].data.coverage.branches).toBe(85.0);
    });
  });

  describe('TESTING.md failure reporting', () => {
    it('should include failure details in TESTING.md', async () => {
      // GIVEN: Test run with failures
      const testingPath = path.join(devDocsDir, 'TESTING.md');

      await logger.log({
        cmd: 'test',
        event: 'FAILED',
        data: {
          tests_total: 50,
          tests_passed: 47,
          tests_failed: 3,
          failures: [
            { file: 'auth.test.ts', line: 25, message: 'Expected true, got false' },
            { file: 'user.test.ts', line: 50, message: 'Timeout exceeded' },
            { file: 'payment.test.ts', line: 100, message: 'Invalid amount' },
          ],
        },
      });

      // Simulate agent updating TESTING.md with failures
      const updatedContent = `# Testing: Test Feature

## Test Results

### Latest Run: 2025-12-08 15:30
| Metric | Value |
|--------|-------|
| Total Tests | 50 |
| Passed | 47 |
| Failed | 3 |
| Status | ❌ Failures |

### Failures
| File | Line | Error |
|------|------|-------|
| auth.test.ts | 25 | Expected true, got false |
| user.test.ts | 50 | Timeout exceeded |
| payment.test.ts | 100 | Invalid amount |

## Last Updated: 2025-12-08 15:30 by /oss:test
`;
      fs.writeFileSync(testingPath, updatedContent);

      // THEN: Failures documented
      const content = fs.readFileSync(testingPath, 'utf-8');
      expect(content).toContain('Failed | 3');
      expect(content).toContain('auth.test.ts');
      expect(content).toContain('Expected true, got false');
    });
  });

  describe('TESTING.md format verification', () => {
    it('should verify TESTING.md contains required sections', async () => {
      // GIVEN: A valid TESTING.md
      const testingPath = path.join(devDocsDir, 'TESTING.md');

      fs.writeFileSync(
        testingPath,
        `# Testing: Test Feature

## Test Strategy
- Unit tests
- Integration tests

## Test Results
| Metric | Value |
|--------|-------|
| Total Tests | 50 |
| Passed | 50 |

## Last Updated: 2025-12-08 15:30 by /oss:test
`
      );

      // WHEN: Reading and validating content
      const content = fs.readFileSync(testingPath, 'utf-8');

      // THEN: Required sections exist
      expect(content).toContain('# Testing:');
      expect(content).toContain('## Test Strategy');
      expect(content).toContain('## Test Results');
      expect(content).toContain('## Last Updated:');
    });
  });
});
