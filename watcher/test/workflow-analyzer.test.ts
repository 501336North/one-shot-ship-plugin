/**
 * WorkflowAnalyzer Tests
 *
 * @behavior Watcher reasons about workflow health semantically
 * @acceptance-criteria AC-005.1 through AC-005.16
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkflowAnalyzer,
  WorkflowAnalysis,
  WorkflowIssue,
  IssueType,
} from '../src/analyzer/workflow-analyzer.js';
import { ParsedLogEntry } from '../src/logger/log-reader.js';

// Helper to create log entries
function entry(
  cmd: string,
  event: string,
  data: Record<string, unknown> = {},
  overrides: Partial<ParsedLogEntry> = {}
): ParsedLogEntry {
  return {
    ts: new Date().toISOString(),
    cmd,
    event: event as any,
    data,
    ...overrides,
  };
}

// Helper to create entry with specific timestamp
function entryAt(
  ts: Date,
  cmd: string,
  event: string,
  data: Record<string, unknown> = {},
  overrides: Partial<ParsedLogEntry> = {}
): ParsedLogEntry {
  return {
    ts: ts.toISOString(),
    cmd,
    event: event as any,
    data,
    ...overrides,
  };
}

describe('WorkflowAnalyzer', () => {
  let analyzer: WorkflowAnalyzer;

  beforeEach(() => {
    analyzer = new WorkflowAnalyzer();
  });

  describe('negative signal detection (presence of bad)', () => {
    it('detects loop when same action repeated 3+ times', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'PHASE_START', {}, { phase: 'RED' }),
        entry('build', 'MILESTONE', { test: 'auth.test.ts' }),
        entry('build', 'MILESTONE', { test: 'auth.test.ts' }),
        entry('build', 'MILESTONE', { test: 'auth.test.ts' }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'loop_detected')).toBe(true);
    });

    it('detects stuck phase when START without COMPLETE beyond timeout', () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      const entries: ParsedLogEntry[] = [
        entryAt(tenMinutesAgo, 'build', 'START'),
        entryAt(tenMinutesAgo, 'build', 'PHASE_START', {}, { phase: 'RED' }),
        // No PHASE_COMPLETE after 10 minutes
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.issues.some((i) => i.type === 'phase_stuck')).toBe(true);
    });

    it('detects regression when COMPLETE followed by FAILED', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'PHASE_START', {}, { phase: 'GREEN' }),
        entry('build', 'PHASE_COMPLETE', {}, { phase: 'GREEN' }),
        entry('build', 'PHASE_START', {}, { phase: 'REFACTOR' }),
        entry('build', 'FAILED', { error: 'Tests broke' }, { phase: 'REFACTOR' }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'regression')).toBe(true);
    });

    it('detects out-of-order when phase sequence violated', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'PHASE_START', {}, { phase: 'GREEN' }), // Should be RED first!
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'out_of_order')).toBe(true);
    });

    it('detects chain violation when command runs without predecessor', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'), // No ideate or plan before build!
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'chain_broken')).toBe(true);
    });

    it('detects TDD violation when GREEN before RED', () => {
      const entries: ParsedLogEntry[] = [
        entry('plan', 'COMPLETE'),
        entry('build', 'START'),
        entry('build', 'PHASE_START', {}, { phase: 'GREEN' }), // Skipped RED!
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'tdd_violation')).toBe(true);
    });

    it('detects explicit FAILED events', () => {
      const entries: ParsedLogEntry[] = [
        entry('ship', 'START'),
        entry('ship', 'FAILED', { error: 'CI check failed' }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'explicit_failure')).toBe(true);
    });

    it('detects agent failure', () => {
      const entries: ParsedLogEntry[] = [
        entry('plan', 'START'),
        entry('plan', 'AGENT_SPAWN', { agent_type: 'security-auditor', agent_id: 'sa-001' }),
        entry('plan', 'AGENT_COMPLETE', { agent_id: 'sa-001', status: 'failed', error: 'Timeout' }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'agent_failed')).toBe(true);
    });
  });

  describe('positive signal erosion (absence of good)', () => {
    it('detects silence (no entries for extended period while command active)', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      const entries: ParsedLogEntry[] = [
        entryAt(twoMinutesAgo, 'build', 'START'),
        entryAt(twoMinutesAgo, 'build', 'PHASE_START', {}, { phase: 'RED' }),
        // No entries for 2 minutes
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.issues.some((i) => i.type === 'silence')).toBe(true);
    });

    it('detects missing milestones (phase without expected checkpoints)', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'PHASE_START', {}, { phase: 'RED' }),
        entry('build', 'PHASE_COMPLETE', {}, { phase: 'RED' }), // No milestones in RED phase!
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'missing_milestones')).toBe(true);
    });

    it('detects declining velocity (time between milestones increasing)', () => {
      const now = new Date();

      const entries: ParsedLogEntry[] = [
        entryAt(new Date(now.getTime() - 300000), 'build', 'MILESTONE', { n: 1 }), // 5 min ago
        entryAt(new Date(now.getTime() - 240000), 'build', 'MILESTONE', { n: 2 }), // 4 min ago (1 min gap)
        entryAt(new Date(now.getTime() - 120000), 'build', 'MILESTONE', { n: 3 }), // 2 min ago (2 min gap)
        entryAt(new Date(now.getTime() - 0), 'build', 'MILESTONE', { n: 4 }), // now (2 min gap -> slowing down)
      ];

      const analysis = analyzer.analyze(entries, now);

      // Note: declining velocity is a lower-confidence warning
      expect(analysis.issues.some((i) => i.type === 'declining_velocity')).toBe(true);
    });

    it('detects incomplete chain (command completes without expected outputs)', () => {
      const entries: ParsedLogEntry[] = [
        entry('plan', 'START'),
        entry('plan', 'COMPLETE', { summary: 'Done' }), // No outputs array!
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.issues.some((i) => i.type === 'incomplete_outputs')).toBe(true);
    });

    it('detects agent silence (spawned agent produces no entries)', () => {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      const entries: ParsedLogEntry[] = [
        entryAt(oneMinuteAgo, 'plan', 'AGENT_SPAWN', { agent_type: 'test-engineer', agent_id: 'te-001' }),
        // No agent START or any other entries for 1 minute
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.issues.some((i) => i.type === 'agent_silence')).toBe(true);
    });
  });

  describe('hard stop detection (positive signals ceased)', () => {
    it('detects abrupt stop (active workflow, then nothing)', () => {
      const now = new Date();
      const threeMinutesAgo = new Date(now.getTime() - 3 * 60 * 1000);

      const entries: ParsedLogEntry[] = [
        entryAt(threeMinutesAgo, 'build', 'START'),
        entryAt(threeMinutesAgo, 'build', 'PHASE_START', {}, { phase: 'RED' }),
        entryAt(threeMinutesAgo, 'build', 'MILESTONE', { test: 'first.test.ts' }),
        // Then nothing for 3 minutes
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.issues.some((i) => i.type === 'abrupt_stop')).toBe(true);
    });

    it('detects partial completion (some phases complete, then silence)', () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      const entries: ParsedLogEntry[] = [
        entryAt(fiveMinutesAgo, 'build', 'START'),
        entryAt(fiveMinutesAgo, 'build', 'PHASE_START', {}, { phase: 'RED' }),
        entryAt(fiveMinutesAgo, 'build', 'PHASE_COMPLETE', {}, { phase: 'RED' }),
        entryAt(fiveMinutesAgo, 'build', 'PHASE_START', {}, { phase: 'GREEN' }),
        // GREEN started but never completed, then silence
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.issues.some((i) => i.type === 'partial_completion')).toBe(true);
    });

    it('detects abandoned agent (agent started, never completed)', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      const entries: ParsedLogEntry[] = [
        entryAt(twoMinutesAgo, 'plan', 'AGENT_SPAWN', { agent_type: 'backend-architect', agent_id: 'ba-001' }),
        entryAt(twoMinutesAgo, 'plan', 'START', {}, { agent: { type: 'backend-architect', id: 'ba-001', parent_cmd: 'plan' } }),
        // Agent started but never completed
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.issues.some((i) => i.type === 'abandoned_agent')).toBe(true);
    });
  });

  describe('healthy workflow recognition', () => {
    it('returns healthy for normal workflow progress', () => {
      const entries: ParsedLogEntry[] = [
        entry('ideate', 'START'),
        entry('ideate', 'MILESTONE', { section: 'problem' }),
        entry('ideate', 'MILESTONE', { section: 'solution' }),
        entry('ideate', 'COMPLETE', { summary: 'Design done', outputs: ['DESIGN.md'] }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.health).toBe('healthy');
      expect(analysis.issues.length).toBe(0);
    });

    it('returns healthy when milestones arrive at expected intervals', () => {
      const now = new Date();

      const entries: ParsedLogEntry[] = [
        entryAt(new Date(now.getTime() - 120000), 'build', 'START'),
        entryAt(new Date(now.getTime() - 90000), 'build', 'MILESTONE', { n: 1 }),
        entryAt(new Date(now.getTime() - 60000), 'build', 'MILESTONE', { n: 2 }),
        entryAt(new Date(now.getTime() - 30000), 'build', 'MILESTONE', { n: 3 }),
        entryAt(now, 'build', 'MILESTONE', { n: 4 }),
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.health).toBe('healthy');
    });

    it('returns healthy when phases complete in order', () => {
      const entries: ParsedLogEntry[] = [
        entry('plan', 'COMPLETE', { outputs: ['PLAN.md'] }),
        entry('build', 'START'),
        entry('build', 'PHASE_START', {}, { phase: 'RED' }),
        entry('build', 'MILESTONE', { test: 'feature.test.ts' }),
        entry('build', 'PHASE_COMPLETE', {}, { phase: 'RED' }),
        entry('build', 'PHASE_START', {}, { phase: 'GREEN' }),
        entry('build', 'MILESTONE', { impl: 'feature.ts' }),
        entry('build', 'PHASE_COMPLETE', {}, { phase: 'GREEN' }),
        entry('build', 'PHASE_START', {}, { phase: 'REFACTOR' }),
        entry('build', 'PHASE_COMPLETE', {}, { phase: 'REFACTOR' }),
        entry('build', 'COMPLETE', { outputs: ['feature.ts'] }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.health).toBe('healthy');
    });
  });

  describe('confidence scoring', () => {
    it('returns high confidence for clear loops (>0.9)', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'MILESTONE', { action: 'same' }),
        entry('build', 'MILESTONE', { action: 'same' }),
        entry('build', 'MILESTONE', { action: 'same' }),
        entry('build', 'MILESTONE', { action: 'same' }),
        entry('build', 'MILESTONE', { action: 'same' }),
      ];

      const analysis = analyzer.analyze(entries);
      const loopIssue = analysis.issues.find((i) => i.type === 'loop_detected');

      expect(loopIssue?.confidence).toBeGreaterThan(0.9);
    });

    it('returns high confidence for explicit failures (>0.9)', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'FAILED', { error: 'Tests failed' }),
      ];

      const analysis = analyzer.analyze(entries);
      const failureIssue = analysis.issues.find((i) => i.type === 'explicit_failure');

      expect(failureIssue?.confidence).toBeGreaterThan(0.9);
    });

    it('returns medium confidence for timing-based issues (0.7-0.9)', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      const entries: ParsedLogEntry[] = [
        entryAt(twoMinutesAgo, 'build', 'START'),
      ];

      const analysis = analyzer.analyze(entries, now);
      const silenceIssue = analysis.issues.find((i) => i.type === 'silence');

      expect(silenceIssue?.confidence).toBeGreaterThanOrEqual(0.7);
      expect(silenceIssue?.confidence).toBeLessThanOrEqual(0.9);
    });

    it('returns medium confidence for missing milestones (0.7-0.9)', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'PHASE_START', {}, { phase: 'RED' }),
        entry('build', 'PHASE_COMPLETE', {}, { phase: 'RED' }),
      ];

      const analysis = analyzer.analyze(entries);
      const missingIssue = analysis.issues.find((i) => i.type === 'missing_milestones');

      expect(missingIssue?.confidence).toBeGreaterThanOrEqual(0.7);
      expect(missingIssue?.confidence).toBeLessThanOrEqual(0.9);
    });

    it('returns low confidence for velocity decline (<0.7)', () => {
      const now = new Date();

      const entries: ParsedLogEntry[] = [
        entryAt(new Date(now.getTime() - 60000), 'build', 'MILESTONE', { n: 1 }),
        entryAt(new Date(now.getTime() - 50000), 'build', 'MILESTONE', { n: 2 }),
        entryAt(new Date(now.getTime() - 30000), 'build', 'MILESTONE', { n: 3 }),
        entryAt(now, 'build', 'MILESTONE', { n: 4 }),
      ];

      const analysis = analyzer.analyze(entries, now);
      const velocityIssue = analysis.issues.find((i) => i.type === 'declining_velocity');

      if (velocityIssue) {
        expect(velocityIssue.confidence).toBeLessThan(0.7);
      }
    });
  });

  describe('state tracking', () => {
    it('tracks current command and phase', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'PHASE_START', {}, { phase: 'GREEN' }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.current_command).toBe('build');
      expect(analysis.current_phase).toBe('GREEN');
    });

    it('tracks phase start time', () => {
      const now = new Date();
      const entries: ParsedLogEntry[] = [
        entryAt(now, 'build', 'PHASE_START', {}, { phase: 'RED' }),
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.phase_start_time).toBe(now.toISOString());
    });

    it('tracks last activity time', () => {
      const now = new Date();
      const entries: ParsedLogEntry[] = [
        entryAt(new Date(now.getTime() - 60000), 'build', 'START'),
        entryAt(now, 'build', 'MILESTONE', { n: 1 }),
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.last_activity_time).toBe(now.toISOString());
    });

    it('tracks milestone timestamps for velocity', () => {
      const now = new Date();
      const entries: ParsedLogEntry[] = [
        entryAt(new Date(now.getTime() - 30000), 'build', 'MILESTONE', { n: 1 }),
        entryAt(now, 'build', 'MILESTONE', { n: 2 }),
      ];

      const analysis = analyzer.analyze(entries, now);

      expect(analysis.milestone_timestamps.length).toBe(2);
    });

    it('tracks active agents', () => {
      const entries: ParsedLogEntry[] = [
        entry('plan', 'AGENT_SPAWN', { agent_type: 'test-engineer', agent_id: 'te-001' }),
        entry('plan', 'AGENT_SPAWN', { agent_type: 'security-auditor', agent_id: 'sa-001' }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.active_agents.length).toBe(2);
      expect(analysis.active_agents.some((a) => a.id === 'te-001')).toBe(true);
    });

    it('tracks expected vs actual milestones', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'PHASE_START', {}, { phase: 'RED' }),
        entry('build', 'MILESTONE', { type: 'test_written' }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.actual_milestones).toBe(1);
      // RED phase expects at least 1 milestone (test written)
      expect(analysis.expected_milestones).toBeGreaterThanOrEqual(1);
    });

    it('updates chain progress', () => {
      const entries: ParsedLogEntry[] = [
        entry('ideate', 'COMPLETE', { outputs: ['DESIGN.md'] }),
        entry('plan', 'COMPLETE', { outputs: ['PLAN.md'] }),
        entry('build', 'START'),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.chain_progress.ideate).toBe('complete');
      expect(analysis.chain_progress.plan).toBe('complete');
      expect(analysis.chain_progress.build).toBe('in_progress');
      expect(analysis.chain_progress.ship).toBe('pending');
    });
  });

  describe('IRON LAW violation detection', () => {
    /**
     * @behavior Watcher detects IRON LAW violations from workflow logs
     * @acceptance-criteria AC-005.17: Detect single IRON LAW violations
     * @business-rule IRON-001: Track IRON LAW compliance
     * @boundary Analyzer
     */
    it('IssueType should include iron_law_violation', () => {
      // Type check - will fail if type doesn't exist
      const issueType: IssueType = 'iron_law_violation';
      expect(issueType).toBe('iron_law_violation');
    });

    /**
     * @behavior Watcher detects repeated IRON LAW violations
     * @acceptance-criteria AC-005.18: Detect repeated violations of same law
     * @business-rule IRON-002: Escalate repeated violations
     * @boundary Analyzer
     */
    it('IssueType should include iron_law_repeated', () => {
      // Type check - will fail if type doesn't exist
      const issueType: IssueType = 'iron_law_repeated';
      expect(issueType).toBe('iron_law_repeated');
    });

    /**
     * @behavior Watcher detects ignored IRON LAW violations
     * @acceptance-criteria AC-005.19: Detect violations without correction
     * @business-rule IRON-003: Flag violations ignored by agent
     * @boundary Analyzer
     */
    it('IssueType should include iron_law_ignored', () => {
      // Type check - will fail if type doesn't exist
      const issueType: IssueType = 'iron_law_ignored';
      expect(issueType).toBe('iron_law_ignored');
    });

    /**
     * @behavior Watcher detects IRON LAW violations from IRON_LAW_CHECK events
     * @acceptance-criteria AC-005.17: Parse IRON_LAW_CHECK entries
     * @business-rule IRON-001: Single violation = high confidence issue
     * @boundary Analyzer
     */
    it('should detect iron_law_violation from IRON_LAW_CHECK entry', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'IRON_LAW_CHECK', {
          passed: false,
          violations: [
            { law: 4, message: 'On main branch, should be on feature branch' }
          ]
        }),
      ];

      const analysis = analyzer.analyze(entries);

      const violation = analysis.issues.find((i) => i.type === 'iron_law_violation');
      expect(violation).toBeDefined();
      expect(violation?.type).toBe('iron_law_violation');
    });

    /**
     * @behavior IRON LAW violations have high confidence (0.95)
     * @acceptance-criteria AC-005.17: Explicit violations = high confidence
     * @business-rule IRON-001: IRON_LAW_CHECK events are authoritative
     * @boundary Analyzer
     */
    it('iron_law_violation should have high confidence (0.95)', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'IRON_LAW_CHECK', {
          passed: false,
          violations: [
            { law: 1, message: 'Code written before test' }
          ]
        }),
      ];

      const analysis = analyzer.analyze(entries);
      const violation = analysis.issues.find((i) => i.type === 'iron_law_violation');

      expect(violation?.confidence).toBe(0.95);
    });

    /**
     * @behavior IRON LAW violation context includes law number and message
     * @acceptance-criteria AC-005.17: Provide actionable context for violations
     * @business-rule IRON-001: Include law # and violation details
     * @boundary Analyzer
     */
    it('iron_law_violation context should include law number and message', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'IRON_LAW_CHECK', {
          passed: false,
          violations: [
            { law: 2, message: 'Mock internal module instead of external boundary' }
          ]
        }),
      ];

      const analysis = analyzer.analyze(entries);
      const violation = analysis.issues.find((i) => i.type === 'iron_law_violation');

      expect(violation?.context).toMatchObject({
        law: 2,
        message: 'Mock internal module instead of external boundary'
      });
    });

    /**
     * @behavior IRON LAW violations trigger critical health status
     * @acceptance-criteria AC-005.20: iron_law_violation causes critical health
     * @business-rule IRON-004: IRON LAW violations = critical priority
     * @boundary Analyzer
     */
    it('iron_law_violation should trigger critical health status', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'IRON_LAW_CHECK', {
          passed: false,
          violations: [
            { law: 4, message: 'On main branch, should be on feature branch' }
          ]
        }),
      ];

      const analysis = analyzer.analyze(entries);

      expect(analysis.health).toBe('critical');
    });

    /**
     * @behavior Repeated IRON LAW violations trigger critical health status
     * @acceptance-criteria AC-005.21: iron_law_repeated causes critical health
     * @business-rule IRON-005: Repeated violations = escalated critical priority
     * @boundary Analyzer
     */
    it('iron_law_repeated should trigger critical health status', () => {
      const entries: ParsedLogEntry[] = [
        entry('build', 'START'),
        entry('build', 'IRON_LAW_CHECK', {
          passed: false,
          violations: [
            { law: 1, message: 'Code written before test' }
          ]
        }),
        entry('build', 'IRON_LAW_CHECK', {
          passed: false,
          violations: [
            { law: 1, message: 'Code written before test' }
          ]
        }),
      ];

      const analysis = analyzer.analyze(entries);

      const repeated = analysis.issues.find((i) => i.type === 'iron_law_repeated');
      expect(repeated).toBeDefined();
      expect(analysis.health).toBe('critical');
    });
  });
});
