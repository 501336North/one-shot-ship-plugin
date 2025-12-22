/**
 * WorkflowStateService Tests
 *
 * @behavior Manages workflow state for status line display
 * @acceptance-criteria AC-WORKFLOW-STATE.1 through AC-WORKFLOW-STATE.12
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Will implement after tests
import {
  WorkflowStateService,
  WorkflowState,
  ChainStep,
  SupervisorStatus,
} from '../../src/services/workflow-state.js';

describe('WorkflowStateService', () => {
  let service: WorkflowStateService;
  let tempDir: string;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-workflow-state-test-'));
    stateFilePath = path.join(tempDir, 'workflow-state.json');
    service = new WorkflowStateService(stateFilePath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // State file management
  // ==========================================================================

  describe('State File Management', () => {
    /**
     * @behavior Creates state file with default values when none exists
     * @acceptance-criteria AC-MENUBAR.1
     */
    test('initializes state file with defaults', async () => {
      await service.initialize();

      expect(fs.existsSync(stateFilePath)).toBe(true);
      const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
      expect(state.supervisor).toBe('idle');
      expect(state.activeStep).toBeNull();
    });

    /**
     * @behavior Reads existing state file correctly
     * @acceptance-criteria AC-MENUBAR.2
     */
    test('reads existing state file', async () => {
      const existingState: WorkflowState = {
        supervisor: 'watching',
        activeStep: 'build',
        chainState: {
          ideate: 'done',
          plan: 'done',
          acceptance: 'active',
          red: 'pending',
          green: 'pending',
          refactor: 'pending',
          integration: 'pending',
          ship: 'pending',
        },
        lastUpdate: new Date().toISOString(),
      };
      fs.writeFileSync(stateFilePath, JSON.stringify(existingState));

      const state = await service.getState();

      expect(state.supervisor).toBe('watching');
      expect(state.activeStep).toBe('build');
    });

    /**
     * @behavior Returns default state when file is corrupted
     * @acceptance-criteria AC-MENUBAR.3
     */
    test('returns default state when file is corrupted', async () => {
      fs.writeFileSync(stateFilePath, 'not valid json{{{');

      const state = await service.getState();

      expect(state.supervisor).toBe('idle');
      expect(state.activeStep).toBeNull();
    });
  });

  // ==========================================================================
  // Chain state updates
  // ==========================================================================

  describe('Chain State Updates', () => {
    /**
     * @behavior Updates active step correctly
     * @acceptance-criteria AC-MENUBAR.4
     */
    test('updates active step and marks previous as done', async () => {
      await service.initialize();

      await service.setActiveStep('plan');

      const state = await service.getState();
      expect(state.activeStep).toBe('plan');
      expect(state.chainState.ideate).toBe('done');
      expect(state.chainState.plan).toBe('active');
      expect(state.chainState.acceptance).toBe('pending');
    });

    /**
     * @behavior Sets TDD phase within build
     * @acceptance-criteria AC-MENUBAR.5
     */
    test('sets TDD phase within build', async () => {
      await service.initialize();
      await service.setActiveStep('build');

      await service.setTddPhase('green');

      const state = await service.getState();
      expect(state.chainState.acceptance).toBe('done');
      expect(state.chainState.red).toBe('done');
      expect(state.chainState.green).toBe('active');
      expect(state.chainState.refactor).toBe('pending');
    });

    /**
     * @behavior Marks step as complete
     * @acceptance-criteria AC-MENUBAR.6
     */
    test('marks step as complete', async () => {
      await service.initialize();
      await service.setActiveStep('ideate');

      await service.completeStep('ideate');

      const state = await service.getState();
      expect(state.chainState.ideate).toBe('done');
      expect(state.activeStep).toBeNull();
    });

    /**
     * @behavior Clears state on workflow complete
     * @acceptance-criteria AC-MENUBAR.7
     */
    test('clears state on workflow complete', async () => {
      await service.initialize();
      await service.setActiveStep('ship');

      await service.workflowComplete();

      const state = await service.getState();
      expect(state.supervisor).toBe('idle');
      expect(state.activeStep).toBeNull();
      // All steps should be done
      expect(state.chainState.ship).toBe('done');
    });

    /**
     * @behavior Resets all state to defaults (for starting fresh workflow)
     * @acceptance-criteria AC-MENUBAR.7a - When ship merged, entire workflow resets
     */
    test('reset returns all state to defaults', async () => {
      await service.initialize();
      // Set up a mid-workflow state
      await service.setActiveStep('build');
      await service.setTddPhase('green');
      await service.setSupervisor('watching');
      await service.setProgress({
        currentTask: 'Some task',
        progress: '5/10',
        testsPass: 50,
      });

      await service.reset();

      const state = await service.getState();
      // All should be back to defaults
      expect(state.supervisor).toBe('idle');
      expect(state.activeStep).toBeNull();
      expect(state.chainState.ideate).toBe('pending');
      expect(state.chainState.plan).toBe('pending');
      expect(state.chainState.acceptance).toBe('pending');
      expect(state.chainState.red).toBe('pending');
      expect(state.chainState.green).toBe('pending');
      expect(state.chainState.ship).toBe('pending');
      expect(state.tddCycle).toBe(1);
      // Progress should be cleared
      expect(state.currentTask).toBeUndefined();
      expect(state.progress).toBeUndefined();
      expect(state.testsPass).toBeUndefined();
    });
  });

  // ==========================================================================
  // Supervisor status
  // ==========================================================================

  describe('Supervisor Status', () => {
    /**
     * @behavior Sets supervisor to watching
     * @acceptance-criteria AC-MENUBAR.8
     */
    test('sets supervisor to watching', async () => {
      await service.initialize();

      await service.setSupervisor('watching');

      const state = await service.getState();
      expect(state.supervisor).toBe('watching');
    });

    /**
     * @behavior Sets supervisor to intervening
     * @acceptance-criteria AC-MENUBAR.9
     */
    test('sets supervisor to intervening', async () => {
      await service.initialize();

      await service.setSupervisor('intervening');

      const state = await service.getState();
      expect(state.supervisor).toBe('intervening');
    });

    /**
     * @behavior Sets supervisor to idle
     * @acceptance-criteria AC-MENUBAR.10
     */
    test('sets supervisor to idle', async () => {
      await service.initialize();
      await service.setSupervisor('watching');

      await service.setSupervisor('idle');

      const state = await service.getState();
      expect(state.supervisor).toBe('idle');
    });
  });

  // ==========================================================================
  // Progress tracking
  // ==========================================================================

  describe('Progress Tracking', () => {
    /**
     * @behavior Updates current task
     * @acceptance-criteria AC-MENUBAR.11
     */
    test('updates current task and progress', async () => {
      await service.initialize();
      await service.setActiveStep('build');

      await service.setProgress({
        currentTask: 'Implementing auth service',
        progress: '3/8',
        testsPass: 47,
      });

      const state = await service.getState();
      expect(state.currentTask).toBe('Implementing auth service');
      expect(state.progress).toBe('3/8');
      expect(state.testsPass).toBe(47);
    });

    /**
     * @behavior Updates lastUpdate timestamp on every change
     * @acceptance-criteria AC-MENUBAR.12
     */
    test('updates lastUpdate timestamp on every change', async () => {
      await service.initialize();
      const initialState = await service.getState();
      const initialTime = initialState.lastUpdate;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.setSupervisor('watching');
      const updatedState = await service.getState();

      expect(updatedState.lastUpdate).not.toBe(initialTime);
    });
  });

  // ==========================================================================
  // TDD Loop Reset (Domino Chain)
  // ==========================================================================

  describe('TDD Loop Reset', () => {
    /**
     * @behavior Resets TDD phases when starting a new loop iteration
     * @acceptance-criteria When refactor completes and there are more tasks,
     *                     mock/green/refactor should reset to pending, red becomes active
     */
    test('resetTddCycle resets mock/green/refactor to pending, red to active', async () => {
      await service.initialize();
      await service.setActiveStep('build');
      await service.setTddPhase('refactor');

      // Simulate completing a TDD cycle and needing to start the next one
      await service.resetTddCycle();

      const state = await service.getState();
      // Acceptance should still be done (we don't repeat acceptance tests each loop)
      expect(state.chainState.acceptance).toBe('done');
      // Red becomes active (we're starting the new cycle)
      expect(state.chainState.red).toBe('active');
      // Other TDD phases should be reset for next iteration
      expect(state.chainState.mock).toBe('pending');
      expect(state.chainState.green).toBe('pending');
      expect(state.chainState.refactor).toBe('pending');
      // Integration and ship should still be pending
      expect(state.chainState.integration).toBe('pending');
      expect(state.chainState.ship).toBe('pending');
    });

    /**
     * @behavior TDD cycle counter increments on reset
     * @acceptance-criteria Track which TDD iteration we're on
     */
    test('resetTddCycle increments cycle counter', async () => {
      await service.initialize();
      await service.setActiveStep('build');
      await service.setTddPhase('refactor');

      await service.resetTddCycle();

      const state = await service.getState();
      expect(state.tddCycle).toBe(2); // First cycle is 1, after reset is 2

      await service.setTddPhase('refactor');
      await service.resetTddCycle();

      const state2 = await service.getState();
      expect(state2.tddCycle).toBe(3);
    });

    /**
     * @behavior Reset preserves progress info
     * @acceptance-criteria Current task and test counts should persist
     */
    test('resetTddCycle preserves progress info', async () => {
      await service.initialize();
      await service.setActiveStep('build');
      await service.setProgress({
        currentTask: 'Task 5',
        progress: '5/10',
        testsPass: 50,
      });
      await service.setTddPhase('refactor');

      await service.resetTddCycle();

      const state = await service.getState();
      expect(state.progress).toBe('5/10');
      expect(state.testsPass).toBe(50);
    });

    /**
     * @behavior Sets red as active after reset
     * @acceptance-criteria After reset, red should be marked as active
     */
    test('resetTddCycle sets red as active', async () => {
      await service.initialize();
      await service.setActiveStep('build');
      await service.setTddPhase('refactor');

      await service.resetTddCycle();

      const state = await service.getState();
      expect(state.chainState.red).toBe('active');
      expect(state.activeStep).toBe('red');
    });
  });

  // ==========================================================================
  // Extended Chain State (Discovery Chain)
  // ==========================================================================

  describe('Extended Chain State', () => {
    /**
     * @behavior Tracks discovery chain steps
     * @acceptance-criteria requirements, api-design, data-model, adr should be tracked
     */
    test('tracks discovery chain steps', async () => {
      await service.initialize();

      await service.setActiveStep('requirements');

      const state = await service.getState();
      expect(state.chainState.ideate).toBe('done');
      expect(state.chainState.requirements).toBe('active');
      expect(state.chainState.apiDesign).toBe('pending');
    });

    /**
     * @behavior Tracks mock phase in build chain
     * @acceptance-criteria mock phase between red and green should be tracked
     */
    test('tracks mock phase in TDD cycle', async () => {
      await service.initialize();
      await service.setActiveStep('build');

      await service.setTddPhase('mock');

      const state = await service.getState();
      expect(state.chainState.red).toBe('done');
      expect(state.chainState.mock).toBe('active');
      expect(state.chainState.green).toBe('pending');
    });

    /**
     * @behavior Tracks contract phase in build chain
     * @acceptance-criteria contract phase after integration should be tracked
     */
    test('tracks contract phase in build', async () => {
      await service.initialize();
      await service.setActiveStep('build');

      await service.setTddPhase('contract');

      const state = await service.getState();
      expect(state.chainState.integration).toBe('done');
      expect(state.chainState.contract).toBe('active');
      expect(state.chainState.ship).toBe('pending');
    });
  });

  // ==========================================================================
  // Status Line Integration (tddPhase field)
  // ==========================================================================

  describe('Status Line Integration', () => {
    /**
     * @behavior setTddPhase also sets tddPhase field for status line
     * @acceptance-criteria oss-statusline.sh reads tddPhase field, so setTddPhase must set it
     * @business-rule Status line displays current TDD phase
     * @boundary WorkflowStateService → workflow-state.json → oss-statusline.sh
     */
    test('setTddPhase sets tddPhase field for status line display', async () => {
      await service.initialize();
      await service.setActiveStep('build');

      await service.setTddPhase('red');

      const state = await service.getState();
      expect(state.tddPhase).toBe('red');
    });

    /**
     * @behavior setTddPhase updates tddPhase when phase changes
     * @acceptance-criteria tddPhase field reflects current TDD phase
     */
    test('setTddPhase updates tddPhase field when phase changes', async () => {
      await service.initialize();
      await service.setActiveStep('build');

      await service.setTddPhase('red');
      let state = await service.getState();
      expect(state.tddPhase).toBe('red');

      await service.setTddPhase('green');
      state = await service.getState();
      expect(state.tddPhase).toBe('green');

      await service.setTddPhase('refactor');
      state = await service.getState();
      expect(state.tddPhase).toBe('refactor');
    });

    /**
     * @behavior workflowComplete clears tddPhase field
     * @acceptance-criteria Status line should not show stale TDD phase after workflow completes
     */
    test('workflowComplete clears tddPhase field', async () => {
      await service.initialize();
      await service.setActiveStep('build');
      await service.setTddPhase('green');

      await service.workflowComplete();

      const state = await service.getState();
      expect(state.tddPhase).toBeUndefined();
    });

    /**
     * @behavior reset clears tddPhase field
     * @acceptance-criteria Status line should not show stale TDD phase after reset
     */
    test('reset clears tddPhase field', async () => {
      await service.initialize();
      await service.setActiveStep('build');
      await service.setTddPhase('red');

      await service.reset();

      const state = await service.getState();
      expect(state.tddPhase).toBeUndefined();
    });
  });

  // ==========================================================================
  // Message field (for workflow/session events in status line)
  // ==========================================================================

  describe('Message Field', () => {
    /**
     * @behavior setMessage sets the message field for status line display
     * @acceptance-criteria AC-STATUS-MSG.1
     * @business-rule Users should see workflow event messages in status line
     */
    test('setMessage sets the message field', async () => {
      await service.initialize();

      await service.setMessage('Ideating');

      const state = await service.getState();
      expect(state.message).toBe('Ideating');
    });

    /**
     * @behavior clearMessage removes the message field
     * @acceptance-criteria AC-STATUS-MSG.2
     */
    test('clearMessage removes the message field', async () => {
      await service.initialize();
      await service.setMessage('Building 3/10');

      await service.clearMessage();

      const state = await service.getState();
      expect(state.message).toBeUndefined();
    });

    /**
     * @behavior workflowComplete clears message field
     * @acceptance-criteria AC-STATUS-MSG.3
     */
    test('workflowComplete clears message field', async () => {
      await service.initialize();
      await service.setMessage('Shipping');

      await service.workflowComplete();

      const state = await service.getState();
      expect(state.message).toBeUndefined();
    });

    /**
     * @behavior reset clears message field
     * @acceptance-criteria AC-STATUS-MSG.4
     */
    test('reset clears message field', async () => {
      await service.initialize();
      await service.setMessage('Planning');

      await service.reset();

      const state = await service.getState();
      expect(state.message).toBeUndefined();
    });
  });

  // ==========================================================================
  // Notification field (non-sticky messages with TTL)
  // ==========================================================================

  describe('Notification Field (Non-Sticky)', () => {
    /**
     * @behavior setNotification sets message with expiry timestamp
     * @acceptance-criteria AC-NOTIFY.1
     * @business-rule Notifications auto-clear after TTL (default 10s)
     */
    test('setNotification sets message and expiresAt', async () => {
      await service.initialize();
      const beforeSet = Date.now();

      await service.setNotification('Context restored');

      const state = await service.getState();
      expect(state.notification).toBeDefined();
      expect(state.notification?.message).toBe('Context restored');
      expect(state.notification?.expiresAt).toBeDefined();

      // expiresAt should be ~10s in the future (default TTL)
      const expiresAt = new Date(state.notification!.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThan(beforeSet + 9000); // At least 9s from now
      expect(expiresAt).toBeLessThan(beforeSet + 11000); // At most 11s from now
    });

    /**
     * @behavior setNotification accepts custom TTL
     * @acceptance-criteria AC-NOTIFY.2
     * @business-rule TTL can be customized per notification
     */
    test('setNotification accepts custom TTL', async () => {
      await service.initialize();
      const beforeSet = Date.now();

      await service.setNotification('Quick message', 5);

      const state = await service.getState();
      const expiresAt = new Date(state.notification!.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThan(beforeSet + 4000); // At least 4s
      expect(expiresAt).toBeLessThan(beforeSet + 6000); // At most 6s
    });

    /**
     * @behavior clearNotification removes notification field
     * @acceptance-criteria AC-NOTIFY.3
     */
    test('clearNotification removes notification', async () => {
      await service.initialize();
      await service.setNotification('Temporary');

      await service.clearNotification();

      const state = await service.getState();
      expect(state.notification).toBeUndefined();
    });

    /**
     * @behavior reset clears notification field
     * @acceptance-criteria AC-NOTIFY.4
     */
    test('reset clears notification', async () => {
      await service.initialize();
      await service.setNotification('Will be cleared');

      await service.reset();

      const state = await service.getState();
      expect(state.notification).toBeUndefined();
    });

    /**
     * @behavior workflowComplete clears notification field
     * @acceptance-criteria AC-NOTIFY.5
     */
    test('workflowComplete clears notification', async () => {
      await service.initialize();
      await service.setNotification('Shipping complete');

      await service.workflowComplete();

      const state = await service.getState();
      expect(state.notification).toBeUndefined();
    });

    /**
     * @behavior isNotificationExpired returns true for expired notifications
     * @acceptance-criteria AC-NOTIFY.6
     * @business-rule Status line should check expiry before displaying
     */
    test('isNotificationExpired returns true for expired', async () => {
      await service.initialize();
      // Set notification with 0s TTL (immediately expired)
      await service.setNotification('Expired', 0);

      // Wait a tiny bit to ensure expiry
      await new Promise((resolve) => setTimeout(resolve, 10));

      const isExpired = await service.isNotificationExpired();
      expect(isExpired).toBe(true);
    });

    /**
     * @behavior isNotificationExpired returns false for active notifications
     * @acceptance-criteria AC-NOTIFY.7
     */
    test('isNotificationExpired returns false for active', async () => {
      await service.initialize();
      await service.setNotification('Active', 10);

      const isExpired = await service.isNotificationExpired();
      expect(isExpired).toBe(false);
    });

    /**
     * @behavior isNotificationExpired returns true when no notification exists
     * @acceptance-criteria AC-NOTIFY.8
     */
    test('isNotificationExpired returns true when none exists', async () => {
      await service.initialize();

      const isExpired = await service.isNotificationExpired();
      expect(isExpired).toBe(true);
    });
  });

  // ==========================================================================
  // Version counter (atomic updates)
  // ==========================================================================

  describe('Version Counter', () => {
    /**
     * @behavior version increments on every state change
     * @acceptance-criteria AC-VERSION.1
     * @business-rule Status line uses version to detect stale reads
     */
    test('version increments on state changes', async () => {
      await service.initialize();
      const state1 = await service.getState();
      const version1 = state1.version ?? 0;

      await service.setSupervisor('watching');
      const state2 = await service.getState();
      const version2 = state2.version ?? 0;

      await service.setNotification('Test');
      const state3 = await service.getState();
      const version3 = state3.version ?? 0;

      expect(version2).toBeGreaterThan(version1);
      expect(version3).toBeGreaterThan(version2);
    });

    /**
     * @behavior version starts at 1 on initialize
     * @acceptance-criteria AC-VERSION.2
     */
    test('version starts at 1', async () => {
      await service.initialize();

      const state = await service.getState();
      expect(state.version).toBe(1);
    });

    /**
     * @behavior reset resets version to 1
     * @acceptance-criteria AC-VERSION.3
     */
    test('reset resets version to 1', async () => {
      await service.initialize();
      await service.setSupervisor('watching');
      await service.setSupervisor('intervening');
      const stateBefore = await service.getState();
      expect(stateBefore.version).toBeGreaterThan(1);

      await service.reset();

      const stateAfter = await service.getState();
      expect(stateAfter.version).toBe(1);
    });
  });

  // ==========================================================================
  // Queue Summary (Task 2.1 - consolidate queue info into workflow-state)
  // ==========================================================================

  describe('Queue Summary', () => {
    /**
     * @behavior Sets queue summary with pending and critical counts
     * @acceptance-criteria AC-STATUS-QUEUE.1
     * @business-rule Status line reads consolidated state (no queue.json)
     */
    test('setQueueSummary stores pending and critical counts', async () => {
      await service.initialize();

      await service.setQueueSummary({ pendingCount: 5, criticalCount: 2 });

      const state = await service.getState();
      expect(state.queueSummary).toBeDefined();
      expect(state.queueSummary?.pendingCount).toBe(5);
      expect(state.queueSummary?.criticalCount).toBe(2);
    });

    /**
     * @behavior Queue summary includes top task description
     * @acceptance-criteria AC-STATUS-QUEUE.2
     */
    test('setQueueSummary stores top task description', async () => {
      await service.initialize();

      await service.setQueueSummary({
        pendingCount: 3,
        criticalCount: 0,
        topTask: 'Fix failing tests',
      });

      const state = await service.getState();
      expect(state.queueSummary?.topTask).toBe('Fix failing tests');
    });

    /**
     * @behavior Clear queue summary removes from state
     * @acceptance-criteria AC-STATUS-QUEUE.3
     */
    test('clearQueueSummary removes queue summary from state', async () => {
      await service.initialize();
      await service.setQueueSummary({ pendingCount: 5, criticalCount: 1 });

      await service.clearQueueSummary();

      const state = await service.getState();
      expect(state.queueSummary).toBeUndefined();
    });

    /**
     * @behavior Zero counts means no queue items
     * @acceptance-criteria AC-STATUS-QUEUE.4
     */
    test('setQueueSummary with zero counts is valid', async () => {
      await service.initialize();

      await service.setQueueSummary({ pendingCount: 0, criticalCount: 0 });

      const state = await service.getState();
      expect(state.queueSummary).toBeDefined();
      expect(state.queueSummary?.pendingCount).toBe(0);
      expect(state.queueSummary?.criticalCount).toBe(0);
    });
  });

  // ==========================================================================
  // Health Status (Task 2.2 - consolidate IRON LAW violations into workflow-state)
  // ==========================================================================

  describe('Health Status', () => {
    /**
     * @behavior Sets health status for status line display
     * @acceptance-criteria AC-STATUS-HEALTH.1
     * @business-rule Status line reads consolidated state (no iron-law-state.json)
     */
    test('setHealth stores health status as healthy', async () => {
      await service.initialize();

      await service.setHealth({ status: 'healthy' });

      const state = await service.getState();
      expect(state.health).toBeDefined();
      expect(state.health?.status).toBe('healthy');
    });

    /**
     * @behavior Health status includes violated law number
     * @acceptance-criteria AC-STATUS-HEALTH.2
     */
    test('setHealth stores violated law number', async () => {
      await service.initialize();

      await service.setHealth({ status: 'violation', violatedLaw: 4 });

      const state = await service.getState();
      expect(state.health?.status).toBe('violation');
      expect(state.health?.violatedLaw).toBe(4);
    });

    /**
     * @behavior Clear health status removes from state
     * @acceptance-criteria AC-STATUS-HEALTH.3
     */
    test('clearHealth removes health from state', async () => {
      await service.initialize();
      await service.setHealth({ status: 'violation', violatedLaw: 4 });

      await service.clearHealth();

      const state = await service.getState();
      expect(state.health).toBeUndefined();
    });
  });

  // ==========================================================================
  // Session State Clearing (Fix stale "ship 2/9" issue)
  // ==========================================================================

  describe('Session State Clearing', () => {
    /**
     * @behavior clearProgress removes progress, currentTask, and testsPass fields
     * @acceptance-criteria AC-SESSION.1
     * @business-rule Fresh sessions should not show stale progress from previous workflows
     */
    test('clearProgress removes progress, currentTask, and testsPass fields', async () => {
      await service.initialize();
      await service.setProgress({ progress: '2/9', currentTask: 'Building tests', testsPass: 42 });

      // Verify fields were set
      let state = await service.getState();
      expect(state.progress).toBe('2/9');
      expect(state.currentTask).toBe('Building tests');
      expect(state.testsPass).toBe(42);

      await service.clearProgress();

      state = await service.getState();
      expect(state.progress).toBeUndefined();
      expect(state.currentTask).toBeUndefined();
      expect(state.testsPass).toBeUndefined();
    });

    /**
     * @behavior prepareForNewSession clears all stale workflow data but preserves chainState
     * @acceptance-criteria AC-SESSION.2
     * @business-rule Session start should clear transient data but preserve historical reference
     */
    test('prepareForNewSession clears stale data but preserves chainState', async () => {
      await service.initialize();

      // Set up stale workflow data
      await service.setProgress({ progress: '5/10', currentTask: 'Old task', testsPass: 100 });
      await service.setActiveStep('build');
      await service.setTddPhase('green');
      await service.setMessage('Stale message');
      await service.setNotification('Stale notification', 60);

      // Verify chainState has some history
      let state = await service.getState();
      expect(state.chainState.ideate).toBe('done');
      expect(state.chainState.plan).toBe('done');

      await service.prepareForNewSession();

      state = await service.getState();

      // These should be cleared
      expect(state.progress).toBeUndefined();
      expect(state.currentTask).toBeUndefined();
      expect(state.testsPass).toBeUndefined();
      expect(state.activeStep).toBeNull();
      expect(state.message).toBeUndefined();
      expect(state.notification).toBeUndefined();
      expect(state.tddPhase).toBeUndefined();
      expect(state.currentCommand).toBeUndefined();

      // chainState should be preserved
      expect(state.chainState.ideate).toBe('done');
      expect(state.chainState.plan).toBe('done');
    });

    /**
     * @behavior prepareForNewSession preserves supervisor as watching
     * @acceptance-criteria AC-SESSION.3
     * @business-rule Session start sets supervisor to watching (session is active)
     */
    test('prepareForNewSession sets supervisor to watching', async () => {
      await service.initialize();
      await service.setSupervisor('intervening');

      await service.prepareForNewSession();

      const state = await service.getState();
      expect(state.supervisor).toBe('watching');
    });
  });

  // ==========================================================================
  // Session ID Tracking (Detect cross-session staleness)
  // ==========================================================================

  describe('Session ID Tracking', () => {
    /**
     * @behavior setSessionId stores session ID in state
     * @acceptance-criteria AC-SESSIONID.1
     * @business-rule Each session gets a unique ID for staleness detection
     */
    test('setSessionId stores session ID in state', async () => {
      await service.initialize();

      await service.setSessionId('abc-123-def');

      const state = await service.getState();
      expect(state.sessionId).toBe('abc-123-def');
    });

    /**
     * @behavior isCurrentSession returns true for matching session ID
     * @acceptance-criteria AC-SESSIONID.2
     */
    test('isCurrentSession returns true for matching ID', async () => {
      await service.initialize();
      await service.setSessionId('current-session-id');

      const isCurrent = await service.isCurrentSession('current-session-id');

      expect(isCurrent).toBe(true);
    });

    /**
     * @behavior isCurrentSession returns false for different session ID
     * @acceptance-criteria AC-SESSIONID.3
     * @business-rule Stale sessions should be detected
     */
    test('isCurrentSession returns false for different ID', async () => {
      await service.initialize();
      await service.setSessionId('current-session-id');

      const isCurrent = await service.isCurrentSession('stale-session-id');

      expect(isCurrent).toBe(false);
    });

    /**
     * @behavior isCurrentSession returns false when no session ID is set
     * @acceptance-criteria AC-SESSIONID.4
     */
    test('isCurrentSession returns false when no session ID set', async () => {
      await service.initialize();

      const isCurrent = await service.isCurrentSession('any-session-id');

      expect(isCurrent).toBe(false);
    });

    /**
     * @behavior prepareForNewSession clears session ID (new session gets new ID)
     * @acceptance-criteria AC-SESSIONID.5
     */
    test('prepareForNewSession clears session ID', async () => {
      await service.initialize();
      await service.setSessionId('old-session-id');

      await service.prepareForNewSession();

      const state = await service.getState();
      expect(state.sessionId).toBeUndefined();
    });
  });
});
