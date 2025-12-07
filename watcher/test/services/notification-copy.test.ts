/**
 * NotificationCopyService Tests
 *
 * @behavior Notification copy is generated from templates with context
 * @acceptance-criteria AC-COPY.1 through AC-COPY.28
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
  // Session copy
  // ==========================================================================

  describe('getSessionCopy', () => {
    /**
     * @behavior Context restored shows branch and age
     * @acceptance-criteria AC-COPY.1
     */
    test('returns "Resumed" for context_restored with branch', () => {
      const copy = service.getSessionCopy('context_restored', { branch: 'feat/auth', age: '2h ago' });
      expect(copy.title).toBe('Resumed');
      expect(copy.message).toContain('feat/auth');
      expect(copy.message).toContain('2h ago');
    });

    /**
     * @behavior Fresh session shows project name
     * @acceptance-criteria AC-COPY.2
     */
    test('returns "Ready" for fresh_session', () => {
      const copy = service.getSessionCopy('fresh_session', { project: 'my-app' });
      expect(copy.title).toBe('Ready');
      expect(copy.message).toContain('my-app');
    });

    /**
     * @behavior Session end shows branch and pending count
     * @acceptance-criteria AC-COPY.3
     */
    test('returns "Saved" for session_end with uncommitted count', () => {
      const copy = service.getSessionCopy('session_end', { uncommitted: 3, branch: 'main' });
      expect(copy.title).toBe('Saved');
      expect(copy.message).toContain('3');
    });

    /**
     * @behavior Session end shows clean when no uncommitted
     * @acceptance-criteria AC-COPY.4
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
  // Ideate copy
  // ==========================================================================

  describe('Ideate Copy', () => {
    /**
     * @behavior Ideate start shows the idea
     * @acceptance-criteria AC-COPY.5
     */
    test('start shows the idea being explored', () => {
      const copy = service.getWorkflowCopy('ideate', 'start', {
        idea: 'user dashboard',
      });
      expect(copy.title).toBe('Ideating');
      expect(copy.message).toContain('user dashboard');
    });

    /**
     * @behavior Ideate complete shows arrow to next step
     * @acceptance-criteria AC-COPY.6
     */
    test('complete shows arrow to Plan with requirements count', () => {
      const copy = service.getWorkflowCopy('ideate', 'complete', {
        requirementsCount: 5,
      });
      expect(copy.title).toBe('→ Plan');
      expect(copy.message).toMatch(/5 requirements/);
    });

    /**
     * @behavior Ideate failed shows reason
     * @acceptance-criteria AC-COPY.7
     */
    test('failed shows the reason', () => {
      const copy = service.getWorkflowCopy('ideate', 'failed', {
        reason: 'API timeout',
      });
      expect(copy.title).toBe('Ideate Failed');
      expect(copy.message).toContain('API timeout');
    });
  });

  // ==========================================================================
  // Plan copy
  // ==========================================================================

  describe('Plan Copy', () => {
    /**
     * @behavior Plan start shows planning action
     * @acceptance-criteria AC-COPY.8
     */
    test('start shows planning action', () => {
      const copy = service.getWorkflowCopy('plan', 'start', {});
      expect(copy.title).toBe('Planning');
      expect(copy.message).toContain('TDD');
    });

    /**
     * @behavior Plan complete shows arrow to Build with task count
     * @acceptance-criteria AC-COPY.9
     */
    test('complete shows arrow to Build with task count', () => {
      const copy = service.getWorkflowCopy('plan', 'complete', {
        taskCount: 12,
        phases: 3,
      });
      expect(copy.title).toBe('→ Build');
      expect(copy.message).toMatch(/12 tasks/);
    });

    /**
     * @behavior Plan failed is direct
     * @acceptance-criteria AC-COPY.10
     */
    test('failed is direct', () => {
      const copy = service.getWorkflowCopy('plan', 'failed', {});
      expect(copy.title).toBe('Plan Failed');
    });
  });

  // ==========================================================================
  // Build copy
  // ==========================================================================

  describe('Build Copy', () => {
    /**
     * @behavior Build start shows task count
     * @acceptance-criteria AC-COPY.11
     */
    test('start shows task count', () => {
      const copy = service.getWorkflowCopy('build', 'start', {
        totalTasks: 8,
      });
      expect(copy.title).toBe('Building');
      expect(copy.message).toContain('8');
    });

    /**
     * @behavior Build task complete shows progress
     * @acceptance-criteria AC-COPY.12
     */
    test('task_complete shows progress in title', () => {
      const copy = service.getWorkflowCopy('build', 'task_complete', {
        current: 3,
        total: 8,
        taskName: 'auth service',
      });
      expect(copy.title).toBe('3/8');
      expect(copy.message).toContain('auth service');
    });

    /**
     * @behavior Build complete shows arrow to Ship with test count
     * @acceptance-criteria AC-COPY.13
     */
    test('complete shows arrow to Ship with test count', () => {
      const copy = service.getWorkflowCopy('build', 'complete', {
        testsPass: 47,
        duration: '4m 32s',
      });
      expect(copy.title).toBe('→ Ship');
      expect(copy.message).toMatch(/47 tests/);
    });

    /**
     * @behavior Build failed shows the failed test
     * @acceptance-criteria AC-COPY.14
     */
    test('failed shows the failed test', () => {
      const copy = service.getWorkflowCopy('build', 'failed', {
        failedTest: 'auth.test.ts:42',
      });
      expect(copy.title).toBe('Build Failed');
      expect(copy.message).toContain('auth.test.ts');
    });
  });

  // ==========================================================================
  // Ship copy
  // ==========================================================================

  describe('Ship Copy', () => {
    /**
     * @behavior Ship start shows quality checks
     * @acceptance-criteria AC-COPY.15
     */
    test('start shows quality checks', () => {
      const copy = service.getWorkflowCopy('ship', 'start', {});
      expect(copy.title).toBe('Shipping');
      expect(copy.message).toContain('Quality');
    });

    /**
     * @behavior Ship quality passed shows gate count
     * @acceptance-criteria AC-COPY.16
     */
    test('quality_passed shows gate count', () => {
      const copy = service.getWorkflowCopy('ship', 'quality_passed', {
        checks: ['lint', 'types', 'tests'],
      });
      expect(copy.title).toBe('Checks Passed');
      expect(copy.message).toMatch(/3 gates/);
    });

    /**
     * @behavior Ship PR created shows PR number in title
     * @acceptance-criteria AC-COPY.17
     */
    test('pr_created shows PR number in title', () => {
      const copy = service.getWorkflowCopy('ship', 'pr_created', {
        prNumber: 42,
        prTitle: 'Add user auth',
      });
      expect(copy.title).toBe('PR #42');
      expect(copy.message).toContain('Add user auth');
    });

    /**
     * @behavior Ship merged shows branch arrow to main
     * @acceptance-criteria AC-COPY.18
     */
    test('merged shows branch arrow to main', () => {
      const copy = service.getWorkflowCopy('ship', 'merged', {
        branch: 'feat/auth',
        prNumber: 42,
      });
      expect(copy.title).toBe('Shipped');
      expect(copy.message).toContain('→ main');
    });

    /**
     * @behavior Ship failed shows blocker
     * @acceptance-criteria AC-COPY.19
     */
    test('failed shows the blocker', () => {
      const copy = service.getWorkflowCopy('ship', 'failed', {
        blocker: 'CI failed',
      });
      expect(copy.title).toBe('Ship Failed');
      expect(copy.message).toContain('CI failed');
    });
  });

  // ==========================================================================
  // Issue copy
  // ==========================================================================

  describe('Issue Copy', () => {
    /**
     * @behavior Loop detected shows tool and count
     * @acceptance-criteria AC-COPY.20
     */
    test('loop_detected shows tool and iteration count', () => {
      const copy = service.getIssueCopy('loop_detected', {
        toolName: 'Grep',
        iterations: 7,
      });
      expect(copy.title).toBe('Loop');
      expect(copy.message).toContain('Grep');
      expect(copy.message).toContain('7');
    });

    /**
     * @behavior TDD violation is direct
     * @acceptance-criteria AC-COPY.21
     */
    test('tdd_violation is direct', () => {
      const copy = service.getIssueCopy('tdd_violation', {
        violation: 'code before test',
      });
      expect(copy.title).toBe('TDD Violation');
      expect(copy.message).toContain('Test first');
    });

    /**
     * @behavior Regression shows count
     * @acceptance-criteria AC-COPY.22
     */
    test('regression shows test count', () => {
      const copy = service.getIssueCopy('regression', {
        failedTests: 3,
        previouslyPassing: true,
      });
      expect(copy.title).toBe('Regression');
      expect(copy.message).toMatch(/3.*broke/);
    });

    /**
     * @behavior Phase stuck shows phase and duration
     * @acceptance-criteria AC-COPY.23
     */
    test('phase_stuck shows phase and duration', () => {
      const copy = service.getIssueCopy('phase_stuck', {
        phase: 'GREEN',
        duration: '5m',
      });
      expect(copy.title).toBe('Stuck');
      expect(copy.message).toContain('GREEN');
    });
  });

  // ==========================================================================
  // Chain subtitle
  // ==========================================================================

  describe('Chain Subtitle - Full London TDD Chain', () => {
    /**
     * @behavior Ideate start shows ideate as active in full chain
     * @acceptance-criteria AC-COPY.27
     */
    test('ideate start shows IDEATE active in full chain subtitle', () => {
      const copy = service.getWorkflowCopy('ideate', 'start', { idea: 'auth' });
      expect(copy.subtitle).toBe(
        'IDEATE → plan → acceptance → red → green → refactor → integration → ship'
      );
    });

    /**
     * @behavior Ideate complete shows ideate done in chain
     * @acceptance-criteria AC-COPY.28
     */
    test('ideate complete shows ideate done in subtitle', () => {
      const copy = service.getWorkflowCopy('ideate', 'complete', { requirementsCount: 5 });
      expect(copy.subtitle).toBe(
        'ideate✓ → plan → acceptance → red → green → refactor → integration → ship'
      );
    });

    /**
     * @behavior Plan start shows ideate done, plan active
     * @acceptance-criteria AC-COPY.29
     */
    test('plan start shows ideate done, plan active in subtitle', () => {
      const copy = service.getWorkflowCopy('plan', 'start', {});
      expect(copy.subtitle).toBe(
        'ideate✓ → PLAN → acceptance → red → green → refactor → integration → ship'
      );
    });

    /**
     * @behavior Build start shows acceptance phase active
     * @acceptance-criteria AC-COPY.30
     */
    test('build start shows acceptance phase active', () => {
      const copy = service.getWorkflowCopy('build', 'start', { totalTasks: 12 });
      expect(copy.subtitle).toBe(
        'ideate✓ → plan✓ → ACCEPTANCE → red → green → refactor → integration → ship'
      );
    });

    /**
     * @behavior Build with tddPhase=red shows red phase active
     * @acceptance-criteria AC-COPY.31
     */
    test('build with tddPhase=red shows red phase active', () => {
      const copy = service.getWorkflowCopy('build', 'task_complete', {
        current: 3,
        total: 8,
        taskName: 'auth',
        tddPhase: 'red',
      });
      expect(copy.subtitle).toBe(
        'ideate✓ → plan✓ → acceptance✓ → RED → green → refactor → integration → ship'
      );
    });

    /**
     * @behavior Build with tddPhase=green shows green phase active
     * @acceptance-criteria AC-COPY.32
     */
    test('build with tddPhase=green shows green phase active', () => {
      const copy = service.getWorkflowCopy('build', 'task_complete', {
        current: 5,
        total: 8,
        taskName: 'auth impl',
        tddPhase: 'green',
      });
      expect(copy.subtitle).toBe(
        'ideate✓ → plan✓ → acceptance✓ → red✓ → GREEN → refactor → integration → ship'
      );
    });

    /**
     * @behavior Build complete shows all build phases done
     * @acceptance-criteria AC-COPY.33
     */
    test('build complete shows all build phases done', () => {
      const copy = service.getWorkflowCopy('build', 'complete', {
        testsPass: 47,
        duration: '4m 32s',
      });
      expect(copy.subtitle).toBe(
        'ideate✓ → plan✓ → acceptance✓ → red✓ → green✓ → refactor✓ → integration✓ → ship'
      );
    });

    /**
     * @behavior Ship merged shows all done
     * @acceptance-criteria AC-COPY.34
     */
    test('ship merged shows all done in subtitle', () => {
      const copy = service.getWorkflowCopy('ship', 'merged', { branch: 'feat/auth' });
      expect(copy.subtitle).toBe(
        'ideate✓ → plan✓ → acceptance✓ → red✓ → green✓ → refactor✓ → integration✓ → ship✓'
      );
    });

    /**
     * @behavior Supervisor watching shows robot with checkmark
     * @acceptance-criteria AC-COPY.35
     */
    test('supervisor watching shows robot with checkmark', () => {
      const copy = service.getWorkflowCopy('build', 'start', {
        totalTasks: 12,
        supervisor: 'watching',
      });
      expect(copy.subtitle).toMatch(/^🤖✓ /);
    });

    /**
     * @behavior Supervisor intervening shows robot with lightning
     * @acceptance-criteria AC-COPY.36
     */
    test('supervisor intervening shows robot with lightning', () => {
      const copy = service.getWorkflowCopy('build', 'task_complete', {
        current: 3,
        total: 8,
        taskName: 'auth',
        tddPhase: 'red',
        supervisor: 'intervening',
      });
      expect(copy.subtitle).toMatch(/^🤖⚡ /);
    });

    /**
     * @behavior Supervisor idle shows robot with X
     * @acceptance-criteria AC-COPY.38
     */
    test('supervisor idle shows robot with X', () => {
      const copy = service.getWorkflowCopy('build', 'start', {
        totalTasks: 12,
        supervisor: 'idle',
      });
      expect(copy.subtitle).toMatch(/^🤖✗ /);
    });

    /**
     * @behavior Custom chainState overrides derived state
     * @acceptance-criteria AC-COPY.37
     */
    test('custom chainState overrides derived state', () => {
      const copy = service.getWorkflowCopy('build', 'start', {
        totalTasks: 8,
        chainState: {
          ideate: 'done',
          plan: 'done',
          acceptance: 'done',
          red: 'active',
          green: 'pending',
          refactor: 'pending',
          integration: 'pending',
          ship: 'pending',
        },
      });
      expect(copy.subtitle).toBe(
        'ideate✓ → plan✓ → acceptance✓ → RED → green → refactor → integration → ship'
      );
    });
  });

  // ==========================================================================
  // Quality validation
  // ==========================================================================

  describe('Copy Quality Validation', () => {
    /**
     * @behavior All titles are under 20 characters
     * @acceptance-criteria AC-COPY.24
     */
    test('all titles are under 20 characters', () => {
      const allTitles = service.getAllTitles();
      allTitles.forEach((title) => {
        expect(title.length).toBeLessThanOrEqual(20);
      });
    });

    /**
     * @behavior Workflow chain is visible through arrows
     * @acceptance-criteria AC-COPY.25
     */
    test('complete events show arrow to next command', () => {
      const ideateComplete = service.getWorkflowCopy('ideate', 'complete', { requirementsCount: 5 });
      const planComplete = service.getWorkflowCopy('plan', 'complete', { taskCount: 10, phases: 2 });
      const buildComplete = service.getWorkflowCopy('build', 'complete', { testsPass: 50, duration: '2s' });

      expect(ideateComplete.title).toBe('→ Plan');
      expect(planComplete.title).toBe('→ Build');
      expect(buildComplete.title).toBe('→ Ship');
    });

    /**
     * @behavior Start and complete titles are distinct
     * @acceptance-criteria AC-COPY.26
     */
    test('start and complete produce distinct notifications', () => {
      const start = service.getWorkflowCopy('ideate', 'start', { idea: 'auth' });
      const complete = service.getWorkflowCopy('ideate', 'complete', { requirementsCount: 5 });

      expect(start.title).not.toBe(complete.title);
    });
  });
});
