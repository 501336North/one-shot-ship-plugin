/**
 * Specialized Agents Logging Tests
 *
 * @behavior All specialized agent types log their work properly
 * @acceptance-criteria AC-SPEC-001: test-engineer logs testing actions
 * @acceptance-criteria AC-SPEC-002: typescript-pro logs code changes
 * @acceptance-criteria AC-SPEC-003: debugger logs investigation steps
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('Specialized Agents Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialized-agents-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('test-engineer agent', () => {
    it('should log testing actions: tests written, run, passed', async () => {
      // GIVEN: test-engineer agent working
      const agent = { type: 'test-engineer', id: 'te-spec-001', parent_cmd: 'build' };

      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'test-engineer',
          agent_id: 'te-spec-001',
          task: 'Write tests for payment module',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          action: 'test_written',
          file: 'src/payment/checkout.test.ts',
          test_name: 'should process valid payment',
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          action: 'tests_run',
          file: 'src/payment/checkout.test.ts',
          tests_total: 5,
          tests_passed: 5,
          duration_ms: 234,
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'te-spec-001',
          status: 'success',
          result: {
            tests_written: 5,
            tests_passing: 5,
            coverage: 85,
          },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();
      const milestones = entries.filter((e) => e.event === 'MILESTONE');

      // THEN: Test actions logged
      expect(milestones.some((m) => m.data.action === 'test_written')).toBe(true);
      expect(milestones.some((m) => m.data.action === 'tests_run')).toBe(true);
      expect(entries[entries.length - 1].data.result.tests_passing).toBe(5);
    });
  });

  describe('typescript-pro agent', () => {
    it('should log code changes: files modified', async () => {
      // GIVEN: typescript-pro agent working
      const agent = { type: 'typescript-pro', id: 'ts-spec-001', parent_cmd: 'build' };

      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'typescript-pro',
          agent_id: 'ts-spec-001',
          task: 'Implement user service',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          action: 'file_created',
          file: 'src/services/user.ts',
          lines: 45,
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          action: 'file_modified',
          file: 'src/services/index.ts',
          changes: { added: 2, removed: 0 },
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'ts-spec-001',
          status: 'success',
          result: {
            files_created: ['src/services/user.ts'],
            files_modified: ['src/services/index.ts'],
            total_lines_added: 47,
          },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();
      const milestones = entries.filter((e) => e.event === 'MILESTONE');

      // THEN: Code changes logged
      expect(milestones.some((m) => m.data.action === 'file_created')).toBe(true);
      expect(milestones.some((m) => m.data.action === 'file_modified')).toBe(true);
      expect(entries[entries.length - 1].data.result.files_created).toContain(
        'src/services/user.ts'
      );
    });
  });

  describe('debugger agent', () => {
    it('should log investigation steps: hypotheses, findings, resolution', async () => {
      // GIVEN: debugger agent working
      const agent = { type: 'debugger', id: 'db-spec-001', parent_cmd: 'build' };

      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'debugger',
          agent_id: 'db-spec-001',
          task: 'Fix flaky test in auth module',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'hypothesis_formed',
          hypothesis: 'Race condition in token refresh',
          confidence: 0.7,
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'investigation',
          action: 'added_logging',
          file: 'src/auth/token.ts',
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'finding',
          issue: 'Token refresh triggers before expiry check completes',
          root_cause: 'Missing await on async expiry check',
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'resolution',
          fix: 'Added await to expiry check',
          file: 'src/auth/token.ts',
          line: 42,
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'db-spec-001',
          status: 'success',
          result: {
            issue_resolved: true,
            root_cause: 'Missing await on async expiry check',
            fix_applied: true,
            tests_now_passing: true,
          },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();
      const milestones = entries.filter((e) => e.event === 'MILESTONE');

      // THEN: Investigation steps logged
      expect(milestones.some((m) => m.data.step === 'hypothesis_formed')).toBe(true);
      expect(milestones.some((m) => m.data.step === 'investigation')).toBe(true);
      expect(milestones.some((m) => m.data.step === 'finding')).toBe(true);
      expect(milestones.some((m) => m.data.step === 'resolution')).toBe(true);
      expect(entries[entries.length - 1].data.result.issue_resolved).toBe(true);
    });
  });

  describe('code-reviewer agent', () => {
    it('should log review findings', async () => {
      // GIVEN: code-reviewer agent working
      const agent = { type: 'code-reviewer', id: 'cr-spec-001', parent_cmd: 'ship' };

      await logger.log({
        cmd: 'ship',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'code-reviewer',
          agent_id: 'cr-spec-001',
          task: 'Review changes in PR #123',
          parent_cmd: 'ship',
        },
      });
      await logger.log({
        cmd: 'ship',
        event: 'START',
        data: {},
        agent,
      });
      await logger.log({
        cmd: 'ship',
        event: 'MILESTONE',
        data: {
          step: 'files_reviewed',
          files_count: 5,
          lines_changed: 120,
        },
        agent,
      });
      await logger.log({
        cmd: 'ship',
        event: 'MILESTONE',
        data: {
          step: 'finding',
          severity: 'high',
          type: 'security',
          message: 'SQL injection vulnerability in user query',
          file: 'src/db/users.ts',
          line: 35,
        },
        agent,
      });
      await logger.log({
        cmd: 'ship',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'cr-spec-001',
          status: 'success',
          result: {
            files_reviewed: 5,
            findings: 3,
            by_severity: { high: 1, medium: 1, low: 1 },
            approval: 'changes_requested',
          },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();
      const findings = entries.filter((e) => e.data.step === 'finding');

      // THEN: Review findings logged
      expect(findings.length).toBe(1);
      expect(findings[0].data.severity).toBe('high');
      expect(entries[entries.length - 1].data.result.findings).toBe(3);
    });
  });

  describe('performance-engineer agent', () => {
    it('should log performance metrics', async () => {
      // GIVEN: performance-engineer agent working
      const agent = { type: 'performance-engineer', id: 'pe-spec-001', parent_cmd: 'build' };

      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'performance-engineer',
          agent_id: 'pe-spec-001',
          task: 'Optimize database queries',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'benchmark_before',
          query: 'SELECT * FROM users WHERE...',
          avg_time_ms: 450,
          p99_time_ms: 1200,
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'optimization_applied',
          action: 'Added index on email column',
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'benchmark_after',
          query: 'SELECT * FROM users WHERE...',
          avg_time_ms: 15,
          p99_time_ms: 45,
          improvement: '97%',
        },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'pe-spec-001',
          status: 'success',
          result: {
            queries_optimized: 3,
            avg_improvement: '85%',
          },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();
      const benchmarks = entries.filter((e) => e.data.step?.startsWith('benchmark'));

      // THEN: Performance metrics logged
      expect(benchmarks.length).toBe(2);
      expect(benchmarks[0].data.avg_time_ms).toBe(450);
      expect(benchmarks[1].data.avg_time_ms).toBe(15);
    });
  });
});
