/**
 * Agent Lifecycle Analyzer Tests
 *
 * @behavior WorkflowAnalyzer detects abandoned agents
 * @acceptance-criteria AC-AGENT-003: Detect SPAWN without COMPLETE within 5 min
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowAnalyzer } from '../../src/analyzer/workflow-analyzer.js';
import { ParsedLogEntry } from '../../src/logger/log-reader.js';

describe('Agent Lifecycle Analysis', () => {
  let analyzer: WorkflowAnalyzer;

  beforeEach(() => {
    analyzer = new WorkflowAnalyzer();
  });

  describe('Abandoned Agent Detection', () => {
    it('should detect abandoned agent (SPAWN without COMPLETE after timeout)', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      // GIVEN: Agent spawned and started but never completed
      const entries: ParsedLogEntry[] = [
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: {
            agent_type: 'test-engineer',
            agent_id: 'te-orphan',
          },
        },
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'START',
          data: {},
          agent: {
            type: 'test-engineer',
            id: 'te-orphan',
            parent_cmd: 'build',
          },
        },
        // No AGENT_COMPLETE for 2 minutes
      ];

      // WHEN: Analyzer processes entries
      const analysis = analyzer.analyze(entries, now);

      // THEN: Abandoned agent issue detected
      const abandonedIssue = analysis.issues.find((i) => i.type === 'abandoned_agent');
      expect(abandonedIssue).toBeDefined();
      expect(abandonedIssue?.message).toContain('test-engineer');
      expect(abandonedIssue?.context?.agent_id).toBe('te-orphan');
    });

    it('should NOT detect abandoned agent if AGENT_COMPLETE received', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      // GIVEN: Agent spawned, started, and completed
      const entries: ParsedLogEntry[] = [
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: {
            agent_type: 'test-engineer',
            agent_id: 'te-completed',
          },
        },
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'START',
          data: {},
          agent: {
            type: 'test-engineer',
            id: 'te-completed',
            parent_cmd: 'build',
          },
        },
        {
          ts: new Date(twoMinutesAgo.getTime() + 30000).toISOString(),
          cmd: 'build',
          event: 'AGENT_COMPLETE',
          data: {
            agent_id: 'te-completed',
            status: 'success',
          },
        },
      ];

      // WHEN: Analyzer processes entries
      const analysis = analyzer.analyze(entries, now);

      // THEN: No abandoned agent issue
      const abandonedIssue = analysis.issues.find((i) => i.type === 'abandoned_agent');
      expect(abandonedIssue).toBeUndefined();
    });

    it('should detect agent silence (SPAWN but never STARTed)', () => {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      // GIVEN: Agent spawned but never started
      const entries: ParsedLogEntry[] = [
        {
          ts: oneMinuteAgo.toISOString(),
          cmd: 'plan',
          event: 'AGENT_SPAWN',
          data: {
            agent_type: 'security-auditor',
            agent_id: 'sa-silent',
          },
        },
        // No START from this agent for 1 minute
      ];

      // WHEN: Analyzer processes entries
      const analysis = analyzer.analyze(entries, now);

      // THEN: Agent silence issue detected
      const silenceIssue = analysis.issues.find((i) => i.type === 'agent_silence');
      expect(silenceIssue).toBeDefined();
      expect(silenceIssue?.message).toContain('security-auditor');
    });

    it('should track multiple agents independently', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      // GIVEN: Two agents - one completed, one abandoned
      const entries: ParsedLogEntry[] = [
        // Agent 1: Completed
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: { agent_type: 'test-engineer', agent_id: 'te-good' },
        },
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'START',
          data: {},
          agent: { type: 'test-engineer', id: 'te-good', parent_cmd: 'build' },
        },
        {
          ts: new Date(twoMinutesAgo.getTime() + 10000).toISOString(),
          cmd: 'build',
          event: 'AGENT_COMPLETE',
          data: { agent_id: 'te-good', status: 'success' },
        },
        // Agent 2: Abandoned
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: { agent_type: 'debugger', agent_id: 'db-bad' },
        },
        {
          ts: twoMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'START',
          data: {},
          agent: { type: 'debugger', id: 'db-bad', parent_cmd: 'build' },
        },
        // No AGENT_COMPLETE for db-bad
      ];

      // WHEN: Analyzer processes entries
      const analysis = analyzer.analyze(entries, now);

      // THEN: Only the abandoned agent is flagged
      const abandonedIssues = analysis.issues.filter((i) => i.type === 'abandoned_agent');
      expect(abandonedIssues.length).toBe(1);
      expect(abandonedIssues[0].context?.agent_id).toBe('db-bad');
    });
  });

  describe('Active Agent Tracking', () => {
    it('should track active agents in analysis result', () => {
      const entries: ParsedLogEntry[] = [
        {
          ts: new Date().toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: { agent_type: 'typescript-pro', agent_id: 'ts-001' },
        },
        {
          ts: new Date().toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: { agent_type: 'react-specialist', agent_id: 'rs-001' },
        },
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.active_agents.length).toBe(2);
      expect(analysis.active_agents.some((a) => a.id === 'ts-001')).toBe(true);
      expect(analysis.active_agents.some((a) => a.id === 'rs-001')).toBe(true);
    });

    it('should mark agent as started when it logs START', () => {
      const entries: ParsedLogEntry[] = [
        {
          ts: new Date().toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: { agent_type: 'test-engineer', agent_id: 'te-track' },
        },
        {
          ts: new Date().toISOString(),
          cmd: 'build',
          event: 'START',
          data: {},
          agent: { type: 'test-engineer', id: 'te-track', parent_cmd: 'build' },
        },
      ];

      const analysis = analyzer.analyze(entries);

      const trackedAgent = analysis.active_agents.find((a) => a.id === 'te-track');
      expect(trackedAgent?.started).toBe(true);
      expect(trackedAgent?.completed).toBe(false);
    });

    it('should mark agent as completed when it logs AGENT_COMPLETE', () => {
      const entries: ParsedLogEntry[] = [
        {
          ts: new Date().toISOString(),
          cmd: 'build',
          event: 'AGENT_SPAWN',
          data: { agent_type: 'debugger', agent_id: 'db-done' },
        },
        {
          ts: new Date().toISOString(),
          cmd: 'build',
          event: 'AGENT_COMPLETE',
          data: { agent_id: 'db-done', status: 'success' },
        },
      ];

      const analysis = analyzer.analyze(entries);

      const trackedAgent = analysis.active_agents.find((a) => a.id === 'db-done');
      expect(trackedAgent?.completed).toBe(true);
    });
  });
});
