/**
 * NotificationCopyService Tests
 *
 * @behavior Notification copy is generated from templates with context
 * @acceptance-criteria AC-COPY.1 through AC-COPY.15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  NotificationCopyService,
  SessionEvent,
  WorkflowEvent,
  IssueType,
} from '../../src/services/notification-copy.js';

describe('NotificationCopyService', () => {
  let service: NotificationCopyService;

  beforeEach(() => {
    service = new NotificationCopyService();
  });

  // ==========================================================================
  // Phase 1.1: Core service functionality
  // ==========================================================================

  describe('getSessionCopy', () => {
    /**
     * @behavior Session copy returns branded title and contextual message
     * @acceptance-criteria AC-COPY.1
     */
    test('returns "Charting Course" for context_restored with branch', () => {
      const copy = service.getSessionCopy('context_restored', { branch: 'feat/auth' });
      expect(copy.title).toBe('Charting Course');
      expect(copy.message).toContain('feat/auth');
    });

    /**
     * @behavior Fresh session is welcoming
     * @acceptance-criteria AC-COPY.2
     */
    test('returns "New Voyage" for fresh_session', () => {
      const copy = service.getSessionCopy('fresh_session', { project: 'my-app' });
      expect(copy.title).toBe('New Voyage');
      expect(copy.message).toContain('my-app');
    });

    /**
     * @behavior Session end confirms save
     * @acceptance-criteria AC-COPY.3
     */
    test('returns "Anchored" for session_end with uncommitted count', () => {
      const copy = service.getSessionCopy('session_end', { uncommitted: 3, branch: 'main' });
      expect(copy.title).toBe('Anchored');
      expect(copy.message).toContain('3');
    });
  });

  // ==========================================================================
  // Phase 1.2: Session templates with edge cases
  // ==========================================================================

  describe('Session Copy Templates', () => {
    /**
     * @behavior Context restored includes age when available
     * @acceptance-criteria AC-COPY.4
     */
    test('context_restored includes age when available', () => {
      const copy = service.getSessionCopy('context_restored', {
        branch: 'main',
        age: '2h ago',
      });
      expect(copy.message).toMatch(/2h ago/);
    });

    /**
     * @behavior Fresh session handles missing project gracefully
     * @acceptance-criteria AC-COPY.5
     */
    test('fresh_session is welcoming for new users', () => {
      const copy = service.getSessionCopy('fresh_session', { project: 'untitled' });
      expect(copy.message).not.toContain('undefined');
      expect(copy.title).toBe('New Voyage');
    });

    /**
     * @behavior Session end shows clean state when no uncommitted
     * @acceptance-criteria AC-COPY.6
     */
    test('session_end shows clean state when no uncommitted changes', () => {
      const copy = service.getSessionCopy('session_end', {
        branch: 'feat/login',
        uncommitted: 0,
      });
      expect(copy.message).toContain('clean');
    });
  });

  // ==========================================================================
  // Phase 2.1: Ideate command copy
  // ==========================================================================

  describe('Ideate Copy', () => {
    /**
     * @behavior Ideate start shows feature being explored
     * @acceptance-criteria AC-COPY.7
     */
    test('start shows feature being explored', () => {
      const copy = service.getWorkflowCopy('ideate', 'start', {
        idea: 'user dashboard',
      });
      expect(copy.title).toBe('Charting Course');
      expect(copy.message).toContain('user dashboard');
    });

    /**
     * @behavior Ideate complete celebrates with next step
     * @acceptance-criteria AC-COPY.8
     */
    test('complete celebrates with next step', () => {
      const copy = service.getWorkflowCopy('ideate', 'complete', {
        requirementsCount: 5,
      });
      expect(copy.title).toBe('Course Plotted');
      expect(copy.message).toMatch(/5 requirements/);
    });

    /**
     * @behavior Ideate failed is honest but encouraging
     * @acceptance-criteria AC-COPY.9
     */
    test('failed is honest but encouraging', () => {
      const copy = service.getWorkflowCopy('ideate', 'failed', {
        reason: 'API timeout',
      });
      expect(copy.title).toBe('Off Course');
      expect(copy.message).not.toContain('Error');
    });
  });

  // ==========================================================================
  // Phase 2.2: Plan command copy
  // ==========================================================================

  describe('Plan Copy', () => {
    /**
     * @behavior Plan start shows planning action
     * @acceptance-criteria AC-COPY.10
     */
    test('start shows planning action', () => {
      const copy = service.getWorkflowCopy('plan', 'start', {});
      expect(copy.title).toBe('Drawing Maps');
      expect(copy.message).toContain('TDD');
    });

    /**
     * @behavior Plan complete shows task count and next step
     * @acceptance-criteria AC-COPY.11
     */
    test('complete shows task count and next step', () => {
      const copy = service.getWorkflowCopy('plan', 'complete', {
        taskCount: 12,
        phases: 3,
      });
      expect(copy.title).toBe('Maps Ready');
      expect(copy.message).toMatch(/12 tasks/);
    });

    /**
     * @behavior Plan failed suggests recovery
     * @acceptance-criteria AC-COPY.12
     */
    test('failed suggests recovery', () => {
      const copy = service.getWorkflowCopy('plan', 'failed', {});
      expect(copy.title).toBe('Compass Spinning');
    });
  });

  // ==========================================================================
  // Phase 2.3: Build command copy
  // ==========================================================================

  describe('Build Copy', () => {
    /**
     * @behavior Build start shows construction beginning
     * @acceptance-criteria AC-COPY.13
     */
    test('start shows construction beginning', () => {
      const copy = service.getWorkflowCopy('build', 'start', {
        totalTasks: 8,
      });
      expect(copy.title).toBe('Raising Sails');
      expect(copy.message).toContain('8');
    });

    /**
     * @behavior Build task complete shows progress fraction
     * @acceptance-criteria AC-COPY.14
     */
    test('task_complete shows progress fraction', () => {
      const copy = service.getWorkflowCopy('build', 'task_complete', {
        current: 3,
        total: 8,
        taskName: 'auth service',
      });
      expect(copy.title).toBe('Knot Tied');
      expect(copy.message).toMatch(/3.*8/);
    });

    /**
     * @behavior Build complete celebrates all tests passing
     * @acceptance-criteria AC-COPY.15
     */
    test('complete celebrates all tests passing', () => {
      const copy = service.getWorkflowCopy('build', 'complete', {
        testsPass: 47,
        duration: '4m 32s',
      });
      expect(copy.title).toBe('Ship Shape');
      expect(copy.message).toMatch(/47.*green/i);
    });

    /**
     * @behavior Build failed identifies the broken test
     * @acceptance-criteria AC-COPY.16
     */
    test('failed identifies the broken test', () => {
      const copy = service.getWorkflowCopy('build', 'failed', {
        failedTest: 'auth.test.ts:42',
      });
      expect(copy.title).toBe('Man Overboard');
      expect(copy.message).toContain('auth.test.ts');
    });
  });

  // ==========================================================================
  // Phase 2.4: Ship command copy
  // ==========================================================================

  describe('Ship Copy', () => {
    /**
     * @behavior Ship start shows quality check beginning
     * @acceptance-criteria AC-COPY.17
     */
    test('start shows quality check beginning', () => {
      const copy = service.getWorkflowCopy('ship', 'start', {});
      expect(copy.title).toBe('Final Check');
      expect(copy.message).toContain('quality');
    });

    /**
     * @behavior Ship quality passed is satisfying
     * @acceptance-criteria AC-COPY.18
     */
    test('quality_passed is satisfying', () => {
      const copy = service.getWorkflowCopy('ship', 'quality_passed', {
        checks: ['lint', 'types', 'tests'],
      });
      expect(copy.title).toBe('All Clear');
      expect(copy.message).toMatch(/3 checks/);
    });

    /**
     * @behavior Ship PR created shows PR number and title
     * @acceptance-criteria AC-COPY.19
     */
    test('pr_created shows PR number and title', () => {
      const copy = service.getWorkflowCopy('ship', 'pr_created', {
        prNumber: 42,
        prTitle: 'Add user auth',
      });
      expect(copy.title).toBe('Ready to Launch');
      expect(copy.message).toContain('#42');
    });

    /**
     * @behavior Ship merged is celebratory
     * @acceptance-criteria AC-COPY.20
     */
    test('merged is celebratory', () => {
      const copy = service.getWorkflowCopy('ship', 'merged', {
        branch: 'feat/auth',
        prNumber: 42,
      });
      expect(copy.title).toBe('Land Ho!');
      expect(copy.message).toContain('merged');
    });

    /**
     * @behavior Ship failed explains what blocked
     * @acceptance-criteria AC-COPY.21
     */
    test('failed explains what blocked', () => {
      const copy = service.getWorkflowCopy('ship', 'failed', {
        blocker: 'CI failed',
      });
      expect(copy.title).toBe('Stuck in Port');
      expect(copy.message).toContain('CI');
    });
  });

  // ==========================================================================
  // Phase 3.1: Issue/Intervention copy
  // ==========================================================================

  describe('Issue Copy', () => {
    /**
     * @behavior Loop detected is urgent but helpful
     * @acceptance-criteria AC-COPY.22
     */
    test('loop_detected is urgent but helpful', () => {
      const copy = service.getIssueCopy('loop_detected', {
        toolName: 'Grep',
        iterations: 7,
      });
      expect(copy.title).toBe('Caught in Whirlpool');
      expect(copy.message).toContain('Grep');
      expect(copy.message).toContain('7');
    });

    /**
     * @behavior TDD violation is educational
     * @acceptance-criteria AC-COPY.23
     */
    test('tdd_violation is educational', () => {
      const copy = service.getIssueCopy('tdd_violation', {
        violation: 'code before test',
      });
      expect(copy.title).toBe('Wrong Heading');
      expect(copy.message).toContain('RED');
    });

    /**
     * @behavior Regression shows what broke
     * @acceptance-criteria AC-COPY.24
     */
    test('regression shows what broke', () => {
      const copy = service.getIssueCopy('regression', {
        failedTests: 3,
        previouslyPassing: true,
      });
      expect(copy.title).toBe('Taking on Water');
      expect(copy.message).toMatch(/3.*broke/);
    });

    /**
     * @behavior Phase stuck suggests action
     * @acceptance-criteria AC-COPY.25
     */
    test('phase_stuck suggests action', () => {
      const copy = service.getIssueCopy('phase_stuck', {
        phase: 'GREEN',
        duration: '5m',
      });
      expect(copy.title).toBe('Becalmed');
      expect(copy.message).toContain('GREEN');
    });
  });

  // ==========================================================================
  // Phase 5.1: Quality validation
  // ==========================================================================

  describe('Copy Quality Validation', () => {
    /**
     * @behavior All titles are under 20 characters
     * @acceptance-criteria AC-COPY.26
     */
    test('all titles are under 20 characters', () => {
      const allTitles = service.getAllTitles();
      allTitles.forEach((title) => {
        expect(title.length).toBeLessThanOrEqual(20);
      });
    });

    /**
     * @behavior No copy contains corporate-speak words
     * @acceptance-criteria AC-COPY.27
     */
    test('no copy contains "Error" or "Failed" words', () => {
      const allMessages = service.getAllMessages();
      allMessages.forEach((msg) => {
        expect(msg).not.toMatch(/\bError\b/);
        expect(msg).not.toMatch(/\bFailed\b/);
      });
    });

    /**
     * @behavior Workflow flows produce distinct notifications
     * @acceptance-criteria AC-COPY.28
     */
    test('full ideate workflow produces correct notifications', () => {
      const start = service.getWorkflowCopy('ideate', 'start', { idea: 'auth' });
      const complete = service.getWorkflowCopy('ideate', 'complete', { requirementsCount: 5 });

      expect(start.title).not.toBe(complete.title);
      expect(complete.message).toContain('/oss:plan');
    });
  });
});
