/**
 * InterventionGenerator Tests
 *
 * @behavior Watcher generates appropriate interventions based on issue confidence
 * @acceptance-criteria AC-006.1 through AC-006.12
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InterventionGenerator,
  Intervention,
  ResponseType,
} from '../src/intervention/generator.js';
import { WorkflowIssue, IssueType } from '../src/analyzer/workflow-analyzer.js';

// Helper to create issues
function issue(
  type: IssueType,
  confidence: number,
  message: string = 'Test issue',
  context: Record<string, unknown> = {}
): WorkflowIssue {
  return { type, confidence, message, context };
}

describe('InterventionGenerator', () => {
  let generator: InterventionGenerator;

  beforeEach(() => {
    generator = new InterventionGenerator();
  });

  describe('generate()', () => {
    it('creates auto-remediate response for high confidence', () => {
      const loopIssue = issue('loop_detected', 0.95, 'Loop detected: same action 5 times');

      const intervention = generator.generate(loopIssue);

      expect(intervention.response_type).toBe('auto_remediate');
    });

    it('creates notify-suggest response for medium confidence', () => {
      const silenceIssue = issue('silence', 0.8, 'No activity for 3 minutes');

      const intervention = generator.generate(silenceIssue);

      expect(intervention.response_type).toBe('notify_suggest');
    });

    it('creates notify-only response for low confidence', () => {
      const velocityIssue = issue('declining_velocity', 0.5, 'Velocity declining');

      const intervention = generator.generate(velocityIssue);

      expect(intervention.response_type).toBe('notify_only');
    });

    it('includes queue task with correct priority for auto-remediate', () => {
      const failureIssue = issue('explicit_failure', 0.95, 'Build failed');

      const intervention = generator.generate(failureIssue);

      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.priority).toBe('high');
      expect(intervention.queue_task!.auto_execute).toBe(true);
    });

    it('includes queue task with prompt for suggested action', () => {
      const stuckIssue = issue('phase_stuck', 0.8, 'RED phase stuck for 5 minutes');

      const intervention = generator.generate(stuckIssue);

      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.prompt).toBeDefined();
      expect(intervention.queue_task!.auto_execute).toBe(false);
    });

    it('includes notification for all response types', () => {
      const issueTypes: Array<[IssueType, number]> = [
        ['loop_detected', 0.95],
        ['silence', 0.8],
        ['declining_velocity', 0.5],
      ];

      for (const [type, conf] of issueTypes) {
        const testIssue = issue(type, conf);
        const intervention = generator.generate(testIssue);

        expect(intervention.notification).toBeDefined();
        expect(intervention.notification.title).toBeDefined();
        expect(intervention.notification.message).toBeDefined();
      }
    });

    it('selects appropriate agent for issue type', () => {
      const tddIssue = issue('tdd_violation', 0.95, 'GREEN before RED');
      const securityIssue = issue('agent_failed', 0.9, 'Security auditor failed', {
        agent_type: 'security-auditor',
      });

      const tddIntervention = generator.generate(tddIssue);
      const securityIntervention = generator.generate(securityIssue);

      expect(tddIntervention.queue_task?.agent_type).toBe('test-engineer');
      // Security issue should spawn a related agent or general debugger
      expect(securityIntervention.queue_task?.agent_type).toBeDefined();
    });
  });

  describe('createPrompt()', () => {
    it('generates clear prompt describing the issue', () => {
      const loopIssue = issue('loop_detected', 0.95, 'Same action repeated 5 times', {
        repeat_count: 5,
      });

      const prompt = generator.createPrompt(loopIssue);

      expect(prompt).toContain('loop');
      expect(prompt).toContain('5');
    });

    it('includes evidence from log entries', () => {
      const stuckIssue = issue('phase_stuck', 0.85, 'Phase stuck', {
        phase: 'RED',
        elapsed_ms: 300000,
      });

      const prompt = generator.createPrompt(stuckIssue);

      expect(prompt).toContain('RED');
      expect(prompt).toMatch(/5|minutes/i);
    });

    it('includes suggested action', () => {
      const regressionIssue = issue('regression', 0.9, 'Tests broke during REFACTOR', {
        completed_phase: 'GREEN',
      });

      const prompt = generator.createPrompt(regressionIssue);

      expect(prompt).toMatch(/fix|revert|investigate/i);
    });

    it('formats for Claude readability', () => {
      const failureIssue = issue('explicit_failure', 0.95, 'Build failed: type error', {
        error: 'TS2345: Argument of type X is not assignable to Y',
      });

      const prompt = generator.createPrompt(failureIssue);

      // Should have clear structure
      expect(prompt).toContain('##');
      expect(prompt.length).toBeGreaterThan(50);
    });
  });

  describe('createNotification()', () => {
    it('creates title with issue type', () => {
      const loopIssue = issue('loop_detected', 0.95);

      const notification = generator.createNotification(loopIssue);

      expect(notification.title).toMatch(/loop/i);
    });

    it('creates message with actionable info', () => {
      const stuckIssue = issue('phase_stuck', 0.8, 'RED phase stuck for 5 minutes');

      const notification = generator.createNotification(stuckIssue);

      expect(notification.message).toContain('RED');
      expect(notification.message.length).toBeGreaterThan(10);
    });

    it('uses appropriate sound for severity', () => {
      const criticalIssue = issue('explicit_failure', 0.95);
      const warningIssue = issue('silence', 0.8);
      const infoIssue = issue('declining_velocity', 0.5);

      const criticalNotif = generator.createNotification(criticalIssue);
      const warningNotif = generator.createNotification(warningIssue);
      const infoNotif = generator.createNotification(infoIssue);

      // Critical should use alert sound
      expect(criticalNotif.sound).toBe('Basso');
      // Warning should use gentler sound
      expect(warningNotif.sound).toBe('Purr');
      // Info can be silent or quiet
      expect(['Pop', 'default', undefined]).toContain(infoNotif.sound);
    });
  });

  describe('IRON LAW violation handling', () => {
    /**
     * @behavior Watcher creates notification for IRON LAW violations
     * @acceptance-criteria AC-006.13
     * @boundary Notification
     */
    it('should create notification for iron_law_violation', () => {
      const ironLawIssue = issue(
        'iron_law_violation',
        0.95,
        'IRON LAW #1 violated: Code written before test',
        { law_number: 1, violation_type: 'code_before_test' }
      );

      const notification = generator.createNotification(ironLawIssue);

      expect(notification.title).toMatch(/IRON LAW/i);
      expect(notification.message).toContain('IRON LAW #1');
      expect(notification.message).toContain('Code written before test');
    });

    /**
     * @behavior Watcher creates notification for repeated IRON LAW violations
     * @acceptance-criteria AC-006.14
     * @boundary Notification
     */
    it('should create notification for iron_law_repeated', () => {
      const repeatedIssue = issue(
        'iron_law_repeated',
        0.98,
        'IRON LAW #1 violated 3 times in this session',
        { law_number: 1, repeat_count: 3 }
      );

      const notification = generator.createNotification(repeatedIssue);

      expect(notification.title).toMatch(/IRON LAW/i);
      expect(notification.message).toContain('3 times');
      expect(notification.message).toContain('repeated');
    });

    /**
     * @behavior Watcher maps IRON LAW violations to debugger agent
     * @acceptance-criteria AC-006.15
     * @boundary Agent Selection
     */
    it('should suggest debugger agent for iron_law_violation', () => {
      const ironLawIssue = issue(
        'iron_law_violation',
        0.95,
        'IRON LAW #2 violated: Tests not passing',
        { law_number: 2 }
      );

      const intervention = generator.generate(ironLawIssue);

      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.agent_type).toBe('debugger');
    });

    /**
     * @behavior Watcher provides corrective action for IRON LAW violations
     * @acceptance-criteria AC-006.16
     * @boundary Suggested Action
     */
    it('should provide corrective action for iron_law_violation', () => {
      const ironLawIssue = issue(
        'iron_law_violation',
        0.95,
        'IRON LAW #1 violated: Code written before test',
        { law_number: 1 }
      );

      const prompt = generator.createPrompt(ironLawIssue);

      expect(prompt).toMatch(/IRON LAW/i);
      expect(prompt).toContain('Suggested Action');
      expect(prompt).toMatch(/delete.*code|remove.*implementation|start.*with.*test/i);
    });

    /**
     * @behavior Watcher handles ignored IRON LAW violations
     * @acceptance-criteria AC-006.17
     * @boundary Notification
     */
    it('should create notification for iron_law_ignored', () => {
      const ignoredIssue = issue(
        'iron_law_ignored',
        0.99,
        'IRON LAW violation not addressed after 5 minutes',
        { law_number: 1, elapsed_ms: 300000 }
      );

      const notification = generator.createNotification(ignoredIssue);

      expect(notification.title).toMatch(/IRON LAW/i);
      expect(notification.message).toContain('not addressed');
      expect(notification.sound).toBe('Basso'); // Critical alert
    });
  });
});
