/**
 * Testing Commands Logging Tests
 *
 * @behavior Testing commands (/oss:test, /oss:integration, /oss:contract) log properly
 * @acceptance-criteria AC-TEST-001: /oss:test logs START/COMPLETE with test results
 * @acceptance-criteria AC-TEST-002: /oss:integration logs START/COMPLETE with integration results
 * @acceptance-criteria AC-TEST-003: TDD_VIOLATION logged when .skip() detected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('Testing Commands Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testing-cmd-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('/oss:test command logging', () => {
    it('should log START/COMPLETE for /oss:test', async () => {
      // GIVEN: test command runs
      await logger.log({
        cmd: 'test',
        event: 'START',
        data: { target: 'all' },
      });
      await logger.log({
        cmd: 'test',
        event: 'COMPLETE',
        data: {
          summary: 'All tests passed',
          tests_total: 150,
          tests_passed: 150,
          tests_failed: 0,
          duration_ms: 5432,
          outputs: ['test-report.json'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Test results logged
      expect(entries.length).toBe(2);
      expect(entries[1].data.tests_total).toBe(150);
      expect(entries[1].data.tests_passed).toBe(150);
    });

    it('should log FAILED with failure details', async () => {
      // GIVEN: test command fails
      await logger.log({
        cmd: 'test',
        event: 'START',
        data: { target: 'all' },
      });
      await logger.log({
        cmd: 'test',
        event: 'FAILED',
        data: {
          error: 'Tests failed',
          tests_total: 150,
          tests_passed: 148,
          tests_failed: 2,
          failures: [
            { file: 'auth.test.ts', line: 25, message: 'Expected true, got false' },
            { file: 'user.test.ts', line: 50, message: 'Timeout exceeded' },
          ],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Failure details logged
      expect(entries[1].event).toBe('FAILED');
      expect(entries[1].data.tests_failed).toBe(2);
      expect(entries[1].data.failures).toHaveLength(2);
    });
  });

  describe('/oss:integration command logging', () => {
    it('should log START/COMPLETE for /oss:integration', async () => {
      // GIVEN: integration command runs
      await logger.log({
        cmd: 'integration',
        event: 'START',
        data: {
          target: 'Validate mock/reality alignment',
          mocks_to_verify: ['UserRepository', 'EmailService'],
        },
      });
      await logger.log({
        cmd: 'integration',
        event: 'COMPLETE',
        data: {
          summary: 'All mocks validated',
          mocks_verified: 2,
          mismatches: 0,
          outputs: ['integration-report.md'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Integration results logged
      expect(entries[1].event).toBe('COMPLETE');
      expect(entries[1].data.mocks_verified).toBe(2);
      expect(entries[1].data.mismatches).toBe(0);
    });
  });

  describe('/oss:contract command logging', () => {
    it('should log START/COMPLETE for /oss:contract', async () => {
      // GIVEN: contract test runs
      await logger.log({
        cmd: 'contract',
        event: 'START',
        data: {
          consumer: 'frontend',
          provider: 'api',
        },
      });
      await logger.log({
        cmd: 'contract',
        event: 'COMPLETE',
        data: {
          summary: 'Contract verified',
          contracts_passed: 5,
          contracts_failed: 0,
          pact_version: '1.2.3',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Contract results logged
      expect(entries[1].data.contracts_passed).toBe(5);
    });
  });

  describe('TDD violation detection', () => {
    it('should log TDD_VIOLATION milestone when .skip() detected', async () => {
      // GIVEN: Tests with skipped tests detected
      await logger.log({
        cmd: 'test',
        event: 'START',
        data: {},
      });
      await logger.log({
        cmd: 'test',
        event: 'MILESTONE',
        data: {
          type: 'TDD_VIOLATION',
          violation: 'skipped_tests',
          skipped_count: 3,
          skipped_files: ['auth.test.ts', 'user.test.ts'],
          message: 'Found .skip() or .todo() in test files',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Violation milestone logged
      const milestone = entries.find((e) => e.event === 'MILESTONE');
      expect(milestone).toBeDefined();
      expect(milestone?.data.type).toBe('TDD_VIOLATION');
      expect(milestone?.data.violation).toBe('skipped_tests');
    });
  });
});
