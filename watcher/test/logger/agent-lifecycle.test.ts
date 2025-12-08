/**
 * Agent Lifecycle Tests
 *
 * @behavior Delegated agents log their lifecycle properly
 * @acceptance-criteria AC-AGENT-001: AGENT_SPAWN logged with agent_type, agent_id, task
 * @acceptance-criteria AC-AGENT-002: AGENT_COMPLETE logged with agent_id, success status
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('Agent Lifecycle Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lifecycle-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('AGENT_SPAWN', () => {
    it('should log AGENT_SPAWN with agent_type and task', async () => {
      // GIVEN: A command spawns a delegated agent
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'test-engineer',
          agent_id: 'te-001',
          task: 'Write unit tests for auth module',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Log entry contains required fields
      expect(entries.length).toBe(1);
      expect(entries[0].event).toBe('AGENT_SPAWN');
      expect(entries[0].data.agent_type).toBe('test-engineer');
      expect(entries[0].data.agent_id).toBe('te-001');
      expect(entries[0].data.task).toBe('Write unit tests for auth module');
    });

    it('should include agent info in log entry when provided', async () => {
      // GIVEN: AGENT_SPAWN with full agent info
      await logger.log({
        cmd: 'plan',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'security-auditor',
          agent_id: 'sa-002',
          task: 'Review API security',
        },
        agent: {
          type: 'security-auditor',
          id: 'sa-002',
          parent_cmd: 'plan',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Agent field is populated
      expect(entries[0].agent).toBeDefined();
      expect(entries[0].agent?.type).toBe('security-auditor');
      expect(entries[0].agent?.id).toBe('sa-002');
      expect(entries[0].agent?.parent_cmd).toBe('plan');
    });

    it('should format human-readable summary with agent type', async () => {
      // GIVEN: AGENT_SPAWN event
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'debugger',
          agent_id: 'db-001',
          task: 'Investigate flaky test',
        },
        agent: {
          type: 'debugger',
          id: 'db-001',
          parent_cmd: 'build',
        },
      });

      // WHEN: Reading raw log file
      const logPath = path.join(testDir, 'workflow.log');
      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      // THEN: Human summary mentions agent type
      const humanLine = lines[1];
      expect(humanLine).toContain('AGENT');
      expect(humanLine).toContain('debugger');
    });
  });

  describe('AGENT_COMPLETE', () => {
    it('should log AGENT_COMPLETE with agent_id and result', async () => {
      // GIVEN: An agent completes successfully
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'te-001',
          agent_type: 'test-engineer',
          status: 'success',
          duration_ms: 5000,
          result: { tests_written: 3 },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Log entry contains completion data
      expect(entries.length).toBe(1);
      expect(entries[0].event).toBe('AGENT_COMPLETE');
      expect(entries[0].data.agent_id).toBe('te-001');
      expect(entries[0].data.status).toBe('success');
      expect(entries[0].data.duration_ms).toBe(5000);
    });

    it('should log AGENT_COMPLETE with failure status and error', async () => {
      // GIVEN: An agent fails
      await logger.log({
        cmd: 'plan',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'sa-001',
          agent_type: 'security-auditor',
          status: 'failed',
          error: 'Timeout after 60 seconds',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Failure is recorded
      expect(entries[0].data.status).toBe('failed');
      expect(entries[0].data.error).toBe('Timeout after 60 seconds');
    });
  });

  describe('Agent lifecycle sequence', () => {
    it('should track complete SPAWN → START → COMPLETE sequence', async () => {
      const agentId = 'ts-001';

      // GIVEN: Full agent lifecycle
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'typescript-pro',
          agent_id: agentId,
          task: 'Implement feature',
        },
      });

      await logger.log({
        cmd: 'build',
        event: 'START',
        data: { step: 'implementation' },
        agent: {
          type: 'typescript-pro',
          id: agentId,
          parent_cmd: 'build',
        },
      });

      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: { file: 'feature.ts' },
        agent: {
          type: 'typescript-pro',
          id: agentId,
          parent_cmd: 'build',
        },
      });

      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: agentId,
          agent_type: 'typescript-pro',
          status: 'success',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: All entries recorded
      expect(entries.length).toBe(4);
      expect(entries[0].event).toBe('AGENT_SPAWN');
      expect(entries[1].event).toBe('START');
      expect(entries[2].event).toBe('MILESTONE');
      expect(entries[3].event).toBe('AGENT_COMPLETE');

      // Agent context preserved
      expect(entries[1].agent?.id).toBe(agentId);
      expect(entries[2].agent?.id).toBe(agentId);
    });
  });
});
