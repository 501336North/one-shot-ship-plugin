/**
 * TDD Cycle Commands Logging Tests
 *
 * @behavior TDD commands (/oss:red, /oss:green, /oss:refactor) log their lifecycle
 * @acceptance-criteria AC-TDD-001: /oss:red logs START when begins
 * @acceptance-criteria AC-TDD-002: /oss:red logs COMPLETE when succeeds
 * @acceptance-criteria AC-TDD-003: /oss:red logs FAILED when fails
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';
import { WorkflowAnalyzer } from '../../src/analyzer/workflow-analyzer.js';

describe('TDD Cycle Commands Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;
  let analyzer: WorkflowAnalyzer;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-cycle-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
    analyzer = new WorkflowAnalyzer();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('/oss:red command logging', () => {
    it('should log START when /oss:red begins', async () => {
      // GIVEN: Red command starts
      await logger.log({
        cmd: 'red',
        event: 'START',
        data: {
          feature: 'user-authentication',
          target: 'Write failing test for login',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: START event logged correctly
      expect(entries.length).toBe(1);
      expect(entries[0].cmd).toBe('red');
      expect(entries[0].event).toBe('START');
      expect(entries[0].data.feature).toBe('user-authentication');
    });

    it('should log COMPLETE when /oss:red succeeds', async () => {
      // GIVEN: Red command completes successfully
      await logger.log({
        cmd: 'red',
        event: 'START',
        data: { feature: 'auth' },
      });
      await logger.log({
        cmd: 'red',
        event: 'COMPLETE',
        data: {
          summary: 'Failing test written',
          test_file: 'src/auth/login.test.ts',
          test_count: 1,
          failure_message: 'Expected login to return user, but got undefined',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: COMPLETE event logged with test info
      expect(entries.length).toBe(2);
      expect(entries[1].event).toBe('COMPLETE');
      expect(entries[1].data.test_count).toBe(1);
      expect(entries[1].data.failure_message).toContain('Expected');
    });

    it('should log FAILED when /oss:red fails', async () => {
      // GIVEN: Red command fails
      await logger.log({
        cmd: 'red',
        event: 'START',
        data: { feature: 'auth' },
      });
      await logger.log({
        cmd: 'red',
        event: 'FAILED',
        data: {
          error: 'Could not determine what to test - no acceptance criteria found',
          recoverable: true,
        },
      });

      // WHEN: LogReader reads entries and analyzer processes
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: FAILED event logged and detected
      expect(entries[1].event).toBe('FAILED');
      expect(entries[1].data.error).toContain('acceptance criteria');
      expect(analysis.issues.some((i) => i.type === 'explicit_failure')).toBe(true);
    });
  });

  describe('/oss:green command logging', () => {
    it('should log START when /oss:green begins', async () => {
      // GIVEN: Green command starts after red
      await logger.log({
        cmd: 'red',
        event: 'COMPLETE',
        data: { test_file: 'login.test.ts' },
      });
      await logger.log({
        cmd: 'green',
        event: 'START',
        data: {
          failing_test: 'login.test.ts',
          target: 'Implement minimal code to pass',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: GREEN START logged
      expect(entries[1].cmd).toBe('green');
      expect(entries[1].event).toBe('START');
    });

    it('should log COMPLETE when /oss:green succeeds with implementation', async () => {
      // GIVEN: Green command completes
      await logger.log({
        cmd: 'green',
        event: 'START',
        data: { failing_test: 'login.test.ts' },
      });
      await logger.log({
        cmd: 'green',
        event: 'COMPLETE',
        data: {
          summary: 'Test now passing',
          files_changed: ['src/auth/login.ts'],
          tests_passing: 1,
          lines_added: 15,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: COMPLETE logged with implementation details
      expect(entries[1].event).toBe('COMPLETE');
      expect(entries[1].data.tests_passing).toBe(1);
      expect(entries[1].data.files_changed).toContain('src/auth/login.ts');
    });

    it('should log FAILED when /oss:green cannot pass test', async () => {
      // GIVEN: Green command fails to make test pass
      await logger.log({
        cmd: 'green',
        event: 'START',
        data: { failing_test: 'login.test.ts' },
      });
      await logger.log({
        cmd: 'green',
        event: 'FAILED',
        data: {
          error: 'After 3 attempts, test still failing',
          last_failure: 'TypeError: Cannot read property \'id\' of null',
          recoverable: true,
        },
      });

      // WHEN: LogReader reads and analyzer processes
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: Failure detected
      expect(entries[1].event).toBe('FAILED');
      expect(analysis.issues.some((i) => i.type === 'explicit_failure')).toBe(true);
    });
  });

  describe('/oss:refactor command logging', () => {
    it('should log START when /oss:refactor begins', async () => {
      // GIVEN: Refactor command starts after green
      await logger.log({
        cmd: 'green',
        event: 'COMPLETE',
        data: { tests_passing: 1 },
      });
      await logger.log({
        cmd: 'refactor',
        event: 'START',
        data: {
          target: 'Clean up implementation',
          files_to_review: ['src/auth/login.ts'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: REFACTOR START logged
      expect(entries[1].cmd).toBe('refactor');
      expect(entries[1].event).toBe('START');
    });

    it('should log COMPLETE when /oss:refactor succeeds', async () => {
      // GIVEN: Refactor completes with improvements
      await logger.log({
        cmd: 'refactor',
        event: 'START',
        data: { files_to_review: ['login.ts'] },
      });
      await logger.log({
        cmd: 'refactor',
        event: 'COMPLETE',
        data: {
          summary: 'Code cleaned up, tests still passing',
          refactorings: ['extract-method', 'rename-variable'],
          tests_passing: 5,
          tests_run_after_each_change: true,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: COMPLETE logged with refactoring details
      expect(entries[1].event).toBe('COMPLETE');
      expect(entries[1].data.refactorings).toContain('extract-method');
      expect(entries[1].data.tests_passing).toBe(5);
    });

    it('should log FAILED when refactoring breaks tests', async () => {
      // GIVEN: Refactor breaks tests (regression)
      await logger.log({
        cmd: 'refactor',
        event: 'START',
        data: { files_to_review: ['login.ts'] },
      });
      await logger.log({
        cmd: 'refactor',
        event: 'FAILED',
        data: {
          error: 'Tests failed after refactoring',
          broken_tests: ['login.test.ts:25'],
          recoverable: true,
        },
      });

      // WHEN: LogReader reads and analyzer processes
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: Failure detected
      expect(entries[1].event).toBe('FAILED');
      expect(analysis.issues.some((i) => i.type === 'explicit_failure')).toBe(true);
    });
  });

  describe('TDD cycle sequence detection', () => {
    it('should detect healthy RED → GREEN → REFACTOR sequence', async () => {
      // GIVEN: Complete TDD cycle in order
      await logger.log({ cmd: 'build', event: 'START', data: {} });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_START', data: {} });
      await logger.log({ cmd: 'red', event: 'START', data: {} });
      await logger.log({ cmd: 'red', event: 'COMPLETE', data: { test_count: 1 } });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_COMPLETE', data: {} });
      await logger.log({ cmd: 'build', phase: 'GREEN', event: 'PHASE_START', data: {} });
      await logger.log({ cmd: 'green', event: 'START', data: {} });
      await logger.log({ cmd: 'green', event: 'COMPLETE', data: { tests_passing: 1 } });
      await logger.log({ cmd: 'build', phase: 'GREEN', event: 'PHASE_COMPLETE', data: {} });
      await logger.log({ cmd: 'build', phase: 'REFACTOR', event: 'PHASE_START', data: {} });
      await logger.log({ cmd: 'refactor', event: 'START', data: {} });
      await logger.log({ cmd: 'refactor', event: 'COMPLETE', data: { tests_passing: 1 } });
      await logger.log({ cmd: 'build', phase: 'REFACTOR', event: 'PHASE_COMPLETE', data: {} });
      await logger.log({ cmd: 'build', event: 'COMPLETE', data: { outputs: ['feature.ts'] } });

      // WHEN: Analyzer processes complete sequence
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: Healthy workflow, no TDD violations
      // Note: chain_broken may be detected since we're starting with 'build' without 'plan'
      // but that's expected in isolated test context - we care about no TDD violations
      const tddViolation = analysis.issues.find((i) => i.type === 'tdd_violation');
      const outOfOrder = analysis.issues.find((i) => i.type === 'out_of_order');
      expect(tddViolation).toBeUndefined();
      expect(outOfOrder).toBeUndefined();
      expect(analysis.chain_progress.build).toBe('complete');
    });

    it('should detect TDD violation when GREEN runs before RED', async () => {
      // GIVEN: GREEN before RED (TDD violation)
      await logger.log({ cmd: 'build', event: 'START', data: {} });
      await logger.log({ cmd: 'build', phase: 'GREEN', event: 'PHASE_START', data: {} });
      await logger.log({ cmd: 'green', event: 'START', data: {} });

      // WHEN: Analyzer processes
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: TDD violation detected
      expect(analysis.issues.some((i) => i.type === 'tdd_violation')).toBe(true);
      expect(analysis.issues.some((i) => i.type === 'out_of_order')).toBe(true);
    });
  });
});
