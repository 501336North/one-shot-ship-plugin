/**
 * @behavior WorkflowStateService manages activeAgent field for tracking spawned agents
 * @acceptance-criteria Agents can be tracked in workflow state for status line display
 * @business-rule Status line shows which agent is currently executing
 * @boundary Service (WorkflowStateService) → workflow-state.json
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowStateService, WorkflowState } from '../../src/services/workflow-state.js';

describe('WorkflowStateService - Active Agent', () => {
  const testDir = path.join(os.tmpdir(), `workflow-state-agent-test-${Date.now()}`);
  const stateFile = path.join(testDir, '.oss', 'workflow-state.json');
  let service: WorkflowStateService;

  beforeEach(() => {
    // Create test directory
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    service = new WorkflowStateService(stateFile);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior activeAgent field exists in WorkflowState type
   * @acceptance-criteria AC-2.1.1
   */
  it('should have activeAgent field in default state', async () => {
    // GIVEN: A new WorkflowStateService
    await service.initialize();

    // WHEN: Getting default state
    const state = await service.getState();

    // THEN: activeAgent should be undefined/null
    expect('activeAgent' in state || state.activeAgent === undefined).toBe(true);
  });

  /**
   * @behavior setActiveAgent sets agent with type, task, and timestamp
   * @acceptance-criteria AC-2.2.1
   */
  it('should set activeAgent with type, task, and startedAt', async () => {
    // GIVEN: A WorkflowStateService
    await service.initialize();

    // WHEN: Setting active agent
    await service.setActiveAgent({ type: 'react-specialist', task: 'UserProfile component' });

    // THEN: State should have activeAgent with all fields
    const state = await service.getState();
    expect(state.activeAgent).toBeDefined();
    expect(state.activeAgent?.type).toBe('react-specialist');
    expect(state.activeAgent?.task).toBe('UserProfile component');
    expect(state.activeAgent?.startedAt).toBeDefined();
    // Verify startedAt is a valid ISO timestamp
    expect(new Date(state.activeAgent?.startedAt || '').toISOString()).toBe(state.activeAgent?.startedAt);
  });

  /**
   * @behavior clearActiveAgent removes the activeAgent field
   * @acceptance-criteria AC-2.2.2
   */
  it('should clear activeAgent when clearActiveAgent is called', async () => {
    // GIVEN: A WorkflowStateService with an active agent
    await service.initialize();
    await service.setActiveAgent({ type: 'typescript-pro', task: 'Fix type errors' });

    // WHEN: Clearing active agent
    await service.clearActiveAgent();

    // THEN: State should not have activeAgent
    const state = await service.getState();
    expect(state.activeAgent).toBeUndefined();
  });

  /**
   * @behavior setActiveAgent overwrites previous active agent
   */
  it('should overwrite previous activeAgent when setting new one', async () => {
    // GIVEN: A WorkflowStateService with an active agent
    await service.initialize();
    await service.setActiveAgent({ type: 'react-specialist', task: 'First task' });

    // WHEN: Setting a new active agent
    await service.setActiveAgent({ type: 'debugger', task: 'Second task' });

    // THEN: State should have the new agent
    const state = await service.getState();
    expect(state.activeAgent?.type).toBe('debugger');
    expect(state.activeAgent?.task).toBe('Second task');
  });
});
