/**
 * WorkflowLogger Tests
 *
 * @behavior Commands can log structured entries to workflow.log
 * @acceptance-criteria AC-001.1 through AC-001.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger, WorkflowEvent, WorkflowLogEntry } from '../src/logger/workflow-logger.js';

describe('WorkflowLogger', () => {
  let testDir: string;
  let logger: WorkflowLogger;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-logger-test-'));
    logger = new WorkflowLogger(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('log()', () => {
    it('creates .oss/workflow.log if not exists', async () => {
      const logPath = path.join(testDir, 'workflow.log');
      expect(fs.existsSync(logPath)).toBe(false);

      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
      });

      expect(fs.existsSync(logPath)).toBe(true);
    });

    it('appends JSON line with correct format', async () => {
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: { args: ['feature'] },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const lines = content.trim().split('\n');
      const jsonLine = lines[0];

      const parsed = JSON.parse(jsonLine);
      expect(parsed.cmd).toBe('build');
      expect(parsed.event).toBe('START');
      expect(parsed.data).toEqual({ args: ['feature'] });
    });

    it('appends human-readable summary after JSON', async () => {
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2);
      expect(lines[1]).toMatch(/^# BUILD:START/);
    });

    it('includes timestamp in ISO 8601 format', async () => {
      const before = new Date().toISOString();

      await logger.log({
        cmd: 'plan',
        event: 'COMPLETE',
        data: {},
      });

      const after = new Date().toISOString();

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const jsonLine = content.trim().split('\n')[0];
      const parsed = JSON.parse(jsonLine);

      expect(parsed.ts).toBeDefined();
      // Timestamp should be between before and after
      expect(parsed.ts >= before.slice(0, 19)).toBe(true);
      expect(parsed.ts <= after).toBe(true);
    });

    it('includes cmd, event, and data fields', async () => {
      await logger.log({
        cmd: 'ship',
        event: 'MILESTONE',
        data: { step: 'quality-check', passed: true },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const parsed = JSON.parse(content.trim().split('\n')[0]);

      expect(parsed.cmd).toBe('ship');
      expect(parsed.event).toBe('MILESTONE');
      expect(parsed.data).toEqual({ step: 'quality-check', passed: true });
    });

    it('includes phase field when provided', async () => {
      await logger.log({
        cmd: 'build',
        phase: 'RED',
        event: 'PHASE_START',
        data: {},
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const parsed = JSON.parse(content.trim().split('\n')[0]);

      expect(parsed.phase).toBe('RED');
    });

    it('includes agent field when logging agent events', async () => {
      await logger.log({
        cmd: 'plan',
        event: 'START',
        data: {},
        agent: {
          type: 'test-engineer',
          id: 'te-001',
          parent_cmd: 'plan',
        },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const parsed = JSON.parse(content.trim().split('\n')[0]);

      expect(parsed.agent).toEqual({
        type: 'test-engineer',
        id: 'te-001',
        parent_cmd: 'plan',
      });
    });

    it('writes atomically (no partial entries)', async () => {
      // Write multiple entries rapidly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          logger.log({
            cmd: 'build',
            event: 'MILESTONE',
            data: { index: i },
          })
        );
      }
      await Promise.all(promises);

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const lines = content.trim().split('\n');

      // Should have 20 lines (10 JSON + 10 human)
      expect(lines.length).toBe(20);

      // Each JSON line should be valid
      for (let i = 0; i < lines.length; i += 2) {
        expect(() => JSON.parse(lines[i])).not.toThrow();
      }
    });
  });

  describe('formatHumanSummary()', () => {
    it('formats START event as "CMD:START - description"', async () => {
      await logger.log({
        cmd: 'ideate',
        event: 'START',
        data: { args: ['user auth'] },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const humanLine = content.trim().split('\n')[1];

      expect(humanLine).toMatch(/^# IDEATE:START/);
    });

    it('formats PHASE_START as "CMD:PHASE:START - description"', async () => {
      await logger.log({
        cmd: 'build',
        phase: 'GREEN',
        event: 'PHASE_START',
        data: {},
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const humanLine = content.trim().split('\n')[1];

      expect(humanLine).toMatch(/^# BUILD:GREEN:PHASE_START/);
    });

    it('formats COMPLETE with summary from data', async () => {
      await logger.log({
        cmd: 'plan',
        event: 'COMPLETE',
        data: { summary: 'Created 5-phase TDD plan', outputs: ['PLAN.md'] },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const humanLine = content.trim().split('\n')[1];

      expect(humanLine).toContain('PLAN:COMPLETE');
      expect(humanLine).toContain('Created 5-phase TDD plan');
    });

    it('formats FAILED with error from data', async () => {
      await logger.log({
        cmd: 'build',
        phase: 'RED',
        event: 'FAILED',
        data: { error: 'Test file not found', recoverable: true },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const humanLine = content.trim().split('\n')[1];

      expect(humanLine).toContain('BUILD:RED:FAILED');
      expect(humanLine).toContain('Test file not found');
    });

    it('formats AGENT events with agent type', async () => {
      await logger.log({
        cmd: 'plan',
        event: 'AGENT_SPAWN',
        data: { agent_type: 'security-auditor', task: 'Review auth flow' },
        agent: {
          type: 'security-auditor',
          id: 'sa-001',
          parent_cmd: 'plan',
        },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const humanLine = content.trim().split('\n')[1];

      expect(humanLine).toContain('AGENT');
      expect(humanLine).toContain('security-auditor');
    });
  });

  describe('IRON LAW compliance checklist', () => {
    it('includes IRON LAW checklist in COMPLETE events when provided', async () => {
      await logger.log({
        cmd: 'build',
        event: 'COMPLETE',
        data: { summary: 'Feature implemented' },
        ironLaws: {
          law1_tdd: true,
          law2_behavior_tests: true,
          law3_no_loops: true,
          law4_feature_branch: true,
          law5_delegation: true,
          law6_docs_synced: false,
        },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');

      // Should include IRON LAW COMPLIANCE section
      expect(content).toContain('IRON LAW COMPLIANCE');
      expect(content).toContain('[✓] LAW #1');
      expect(content).toContain('[✓] LAW #2');
      expect(content).toContain('[✓] LAW #3');
      expect(content).toContain('[✓] LAW #4');
      expect(content).toContain('[✓] LAW #5');
      expect(content).toContain('[✗] LAW #6');
      expect(content).toContain('5/6 laws observed');
    });

    it('includes IRON LAW checklist in AGENT_COMPLETE events when provided', async () => {
      await logger.log({
        cmd: 'plan',
        event: 'AGENT_COMPLETE',
        data: { agent_type: 'test-engineer' },
        agent: {
          type: 'test-engineer',
          id: 'te-001',
          parent_cmd: 'plan',
        },
        ironLaws: {
          law1_tdd: true,
          law2_behavior_tests: true,
          law3_no_loops: true,
          law4_feature_branch: false,
          law5_delegation: true,
          law6_docs_synced: true,
        },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');

      expect(content).toContain('IRON LAW COMPLIANCE');
      expect(content).toContain('5/6 laws observed');
    });

    it('stores ironLaws in JSON when provided', async () => {
      await logger.log({
        cmd: 'ship',
        event: 'COMPLETE',
        data: { summary: 'Shipped to production' },
        ironLaws: {
          law1_tdd: true,
          law2_behavior_tests: true,
          law3_no_loops: true,
          law4_feature_branch: true,
          law5_delegation: true,
          law6_docs_synced: true,
        },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');
      const jsonLine = content.trim().split('\n')[0];
      const parsed = JSON.parse(jsonLine);

      expect(parsed.ironLaws).toBeDefined();
      expect(parsed.ironLaws.law1_tdd).toBe(true);
      expect(parsed.ironLaws.law6_docs_synced).toBe(true);
    });

    it('does not include checklist for non-COMPLETE events', async () => {
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
        ironLaws: {
          law1_tdd: true,
          law2_behavior_tests: true,
          law3_no_loops: true,
          law4_feature_branch: true,
          law5_delegation: true,
          law6_docs_synced: true,
        },
      });

      const content = fs.readFileSync(path.join(testDir, 'workflow.log'), 'utf-8');

      // Should NOT include checklist for START event
      expect(content).not.toContain('IRON LAW COMPLIANCE');
    });
  });
});
