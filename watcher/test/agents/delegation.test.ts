/**
 * Agent Delegation Logging Tests
 *
 * @behavior Delegated agents log their lifecycle and work properly
 * @acceptance-criteria AC-AGENT-DEL-001: AGENT_SPAWN logged on creation
 * @acceptance-criteria AC-AGENT-DEL-002: AGENT_COMPLETE logged on finish
 * @acceptance-criteria AC-AGENT-DEL-003: MILESTONE events logged for significant work
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';
import { WorkflowAnalyzer } from '../../src/analyzer/workflow-analyzer.js';

describe('Agent Delegation Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;
  let analyzer: WorkflowAnalyzer;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-delegation-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
    analyzer = new WorkflowAnalyzer();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Agent spawn logging', () => {
    it('should log AGENT_SPAWN with agent_type, agent_id, and parent_cmd', async () => {
      // GIVEN: A command spawns an agent via Task tool
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'test-engineer',
          agent_id: 'te-spawn-001',
          task: 'Write unit tests for user authentication',
          parent_cmd: 'build',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Spawn logged with required fields
      expect(entries[0].event).toBe('AGENT_SPAWN');
      expect(entries[0].data.agent_type).toBe('test-engineer');
      expect(entries[0].data.agent_id).toBe('te-spawn-001');
      expect(entries[0].data.parent_cmd).toBe('build');
      expect(entries[0].data.task).toBeDefined();
    });

    it('should track multiple concurrent agent spawns', async () => {
      // GIVEN: Multiple agents spawned in parallel
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'typescript-pro',
          agent_id: 'ts-001',
          task: 'Implement feature A',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'test-engineer',
          agent_id: 'te-001',
          task: 'Write tests for feature A',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'security-auditor',
          agent_id: 'sa-001',
          task: 'Review security of feature A',
          parent_cmd: 'build',
        },
      });

      // WHEN: Analyzer processes entries
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: All agents tracked
      expect(entries.length).toBe(3);
      expect(analysis.active_agents.length).toBe(3);
      expect(analysis.active_agents.map((a) => a.type)).toContain('typescript-pro');
      expect(analysis.active_agents.map((a) => a.type)).toContain('test-engineer');
      expect(analysis.active_agents.map((a) => a.type)).toContain('security-auditor');
    });
  });

  describe('Agent completion logging', () => {
    it('should log AGENT_COMPLETE with agent_id and success status', async () => {
      // GIVEN: Agent completes successfully
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'typescript-pro',
          agent_id: 'ts-complete-001',
          task: 'Implement login function',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'ts-complete-001',
          agent_type: 'typescript-pro',
          status: 'success',
          duration_ms: 15000,
          result: {
            files_created: ['src/auth/login.ts'],
            lines_added: 45,
          },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Completion logged with success
      expect(entries[1].event).toBe('AGENT_COMPLETE');
      expect(entries[1].data.agent_id).toBe('ts-complete-001');
      expect(entries[1].data.status).toBe('success');
      expect(entries[1].data.result.files_created).toContain('src/auth/login.ts');
    });

    it('should log AGENT_COMPLETE with failure status and error', async () => {
      // GIVEN: Agent fails
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'debugger',
          agent_id: 'db-fail-001',
          task: 'Fix flaky test',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'db-fail-001',
          agent_type: 'debugger',
          status: 'failed',
          error: 'Could not reproduce flaky test in 10 attempts',
          duration_ms: 60000,
        },
      });

      // WHEN: Analyzer processes entries
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: Failure detected
      expect(entries[1].data.status).toBe('failed');
      expect(entries[1].data.error).toContain('reproduce');
      expect(analysis.issues.some((i) => i.type === 'agent_failed')).toBe(true);
    });
  });

  describe('Agent milestone logging', () => {
    it('should log MILESTONE for significant work checkpoints', async () => {
      // GIVEN: Agent logs milestones during work
      const agentId = 'te-milestone-001';
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'test-engineer',
          agent_id: agentId,
          task: 'Write comprehensive test suite',
          parent_cmd: 'build',
        },
      });
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
        agent: { type: 'test-engineer', id: agentId, parent_cmd: 'build' },
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'test_file_created',
          file: 'src/auth/login.test.ts',
          tests_count: 5,
        },
        agent: { type: 'test-engineer', id: agentId, parent_cmd: 'build' },
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: {
          step: 'test_file_created',
          file: 'src/auth/register.test.ts',
          tests_count: 8,
        },
        agent: { type: 'test-engineer', id: agentId, parent_cmd: 'build' },
      });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: agentId,
          agent_type: 'test-engineer',
          status: 'success',
          result: { total_tests: 13 },
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();
      const milestones = entries.filter((e) => e.event === 'MILESTONE');

      // THEN: Milestones tracked
      expect(milestones.length).toBe(2);
      expect(milestones[0].data.file).toBe('src/auth/login.test.ts');
      expect(milestones[0].agent?.id).toBe(agentId);
    });
  });

  describe('Agent work context preservation', () => {
    it('should preserve agent context in all entries', async () => {
      // GIVEN: Agent does work with full context
      const agent = {
        type: 'refactoring-specialist',
        id: 'rs-context-001',
        parent_cmd: 'build',
      };

      await logger.log({
        cmd: 'build',
        event: 'START',
        data: { target: 'Extract method from large function' },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: { step: 'identified_extraction_point' },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'MILESTONE',
        data: { step: 'extracted_method', new_function: 'validateUserInput' },
        agent,
      });
      await logger.log({
        cmd: 'build',
        event: 'COMPLETE',
        data: { summary: 'Method extracted successfully' },
        agent,
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: All entries have agent context
      for (const entry of entries) {
        expect(entry.agent).toBeDefined();
        expect(entry.agent?.id).toBe('rs-context-001');
        expect(entry.agent?.type).toBe('refactoring-specialist');
        expect(entry.agent?.parent_cmd).toBe('build');
      }
    });
  });

  describe('Nested agent delegation', () => {
    it('should track when agent spawns sub-agent', async () => {
      // GIVEN: Agent spawns another agent
      const parentAgent = { type: 'backend-architect', id: 'ba-001', parent_cmd: 'plan' };

      await logger.log({
        cmd: 'plan',
        event: 'START',
        data: { task: 'Design API' },
        agent: parentAgent,
      });

      // Parent agent spawns security auditor
      await logger.log({
        cmd: 'plan',
        event: 'AGENT_SPAWN',
        data: {
          agent_type: 'security-auditor',
          agent_id: 'sa-nested-001',
          task: 'Review API security design',
          parent_cmd: 'plan',
          parent_agent_id: 'ba-001', // Track nesting
        },
        agent: parentAgent,
      });

      await logger.log({
        cmd: 'plan',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'sa-nested-001',
          status: 'success',
        },
        agent: parentAgent,
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Nested delegation tracked
      const spawnEntry = entries.find((e) => e.event === 'AGENT_SPAWN');
      expect(spawnEntry?.data.parent_agent_id).toBe('ba-001');
      expect(spawnEntry?.agent?.id).toBe('ba-001');
    });
  });
});
