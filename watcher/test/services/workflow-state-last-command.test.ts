/**
 * WorkflowState lastCommand Tests
 *
 * @behavior Tracks the last completed command for status line display
 * @acceptance-criteria AC-LASTCMD.1 through AC-LASTCMD.6
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { WorkflowStateService } from '../../src/services/workflow-state.js';

describe('WorkflowState lastCommand tracking', () => {
  let service: WorkflowStateService;
  let tempDir: string;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-last-command-test-'));
    stateFilePath = path.join(tempDir, 'workflow-state.json');
    service = new WorkflowStateService(stateFilePath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // lastCommand field tracking
  // ==========================================================================

  describe('lastCommand Field', () => {
    /**
     * @behavior setLastCommand stores the last completed command
     * @acceptance-criteria AC-LASTCMD.1
     * @business-rule Status line shows lastCommand → nextCommand
     */
    test('setLastCommand stores the command name in state', async () => {
      await service.initialize();

      await service.setLastCommand('build');

      const state = await service.getState();
      expect(state.lastCommand).toBe('build');
    });

    /**
     * @behavior lastCommand persists across sessions (stored in file)
     * @acceptance-criteria AC-LASTCMD.2
     */
    test('lastCommand persists to state file', async () => {
      await service.initialize();
      await service.setLastCommand('plan');

      // Read directly from file to verify persistence
      const fileContents = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
      expect(fileContents.lastCommand).toBe('plan');
    });

    /**
     * @behavior clearLastCommand removes the lastCommand field
     * @acceptance-criteria AC-LASTCMD.3
     */
    test('clearLastCommand removes lastCommand from state', async () => {
      await service.initialize();
      await service.setLastCommand('ship');

      await service.clearLastCommand();

      const state = await service.getState();
      expect(state.lastCommand).toBeUndefined();
    });

    /**
     * @behavior reset clears lastCommand (fresh workflow)
     * @acceptance-criteria AC-LASTCMD.4
     */
    test('reset clears lastCommand', async () => {
      await service.initialize();
      await service.setLastCommand('build');

      await service.reset();

      const state = await service.getState();
      expect(state.lastCommand).toBeUndefined();
    });

    /**
     * @behavior prepareForNewSession preserves lastCommand
     * @acceptance-criteria AC-LASTCMD.5
     * @business-rule New sessions should still show last workflow state
     */
    test('prepareForNewSession preserves lastCommand', async () => {
      await service.initialize();
      await service.setLastCommand('plan');

      await service.prepareForNewSession();

      const state = await service.getState();
      expect(state.lastCommand).toBe('plan');
    });

    /**
     * @behavior workflowComplete preserves lastCommand
     * @acceptance-criteria AC-LASTCMD.6
     * @business-rule After ship completes, lastCommand should be 'ship'
     */
    test('workflowComplete preserves lastCommand', async () => {
      await service.initialize();
      await service.setLastCommand('ship');

      await service.workflowComplete();

      const state = await service.getState();
      expect(state.lastCommand).toBe('ship');
    });
  });

  // ==========================================================================
  // workflowComplete flag
  // ==========================================================================

  describe('workflowComplete Flag', () => {
    /**
     * @behavior setWorkflowComplete sets flag to true
     * @acceptance-criteria AC-WFCOMPLETE.1
     * @business-rule Status line shows "→ DONE" when workflow is complete
     */
    test('setWorkflowComplete sets workflowComplete flag', async () => {
      await service.initialize();

      await service.setWorkflowComplete(true);

      const state = await service.getState();
      expect(state.workflowComplete).toBe(true);
    });

    /**
     * @behavior workflowComplete flag persists to file
     * @acceptance-criteria AC-WFCOMPLETE.2
     */
    test('workflowComplete flag persists to state file', async () => {
      await service.initialize();
      await service.setWorkflowComplete(true);

      const fileContents = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
      expect(fileContents.workflowComplete).toBe(true);
    });

    /**
     * @behavior reset clears workflowComplete flag
     * @acceptance-criteria AC-WFCOMPLETE.3
     */
    test('reset clears workflowComplete flag', async () => {
      await service.initialize();
      await service.setWorkflowComplete(true);

      await service.reset();

      const state = await service.getState();
      expect(state.workflowComplete).toBeUndefined();
    });

    /**
     * @behavior setActiveStep clears workflowComplete (new work starting)
     * @acceptance-criteria AC-WFCOMPLETE.4
     */
    test('setActiveStep clears workflowComplete flag', async () => {
      await service.initialize();
      await service.setWorkflowComplete(true);

      await service.setActiveStep('ideate');

      const state = await service.getState();
      expect(state.workflowComplete).toBeFalsy();
    });
  });
});
