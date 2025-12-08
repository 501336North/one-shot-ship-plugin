/**
 * MenuBarService Tests
 *
 * @behavior Manages workflow state for SwiftBar menu bar display
 * @acceptance-criteria AC-MENUBAR.1 through AC-MENUBAR.12
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Will implement after tests
import {
  MenuBarService,
  WorkflowState,
  ChainStep,
  SupervisorStatus,
} from '../../src/services/menubar.js';

describe('MenuBarService', () => {
  let service: MenuBarService;
  let tempDir: string;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-menubar-test-'));
    stateFilePath = path.join(tempDir, 'workflow-state.json');
    service = new MenuBarService(stateFilePath);
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
});
