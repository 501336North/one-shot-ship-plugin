/**
 * @behavior WorkflowStateService tracks the next recommended command
 * @acceptance-criteria nextCommand field is set after workflow step completion
 * @business-rule User always knows what command to run next
 * @boundary Service (workflow-state.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowStateService } from '../../src/services/workflow-state.js';

describe('WorkflowStateService - nextCommand tracking', () => {
  const testDir = path.join(os.tmpdir(), `oss-next-cmd-test-${Date.now()}`);
  const stateFile = path.join(testDir, 'workflow-state.json');
  let service: WorkflowStateService;

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    service = new WorkflowStateService(stateFile);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Default state has no nextCommand
   * @acceptance-criteria nextCommand is undefined by default
   */
  it('should have undefined nextCommand in default state', async () => {
    const state = await service.getState();
    expect(state.nextCommand).toBeUndefined();
  });

  /**
   * @behavior completeStep(ideate) sets nextCommand to plan
   * @acceptance-criteria After ideate completes, nextCommand is 'plan'
   */
  it('should set nextCommand to "plan" after ideate completes', async () => {
    await service.completeStep('ideate');
    const state = await service.getState();
    expect(state.nextCommand).toBe('plan');
  });

  /**
   * @behavior completeStep(plan) sets nextCommand to build
   * @acceptance-criteria After plan completes, nextCommand is 'build'
   */
  it('should set nextCommand to "build" after plan completes', async () => {
    await service.completeStep('plan');
    const state = await service.getState();
    expect(state.nextCommand).toBe('build');
  });

  /**
   * @behavior completeStep(build) sets nextCommand to ship
   * @acceptance-criteria After build completes, nextCommand is 'ship'
   */
  it('should set nextCommand to "ship" after build completes', async () => {
    await service.completeStep('build');
    const state = await service.getState();
    expect(state.nextCommand).toBe('ship');
  });

  /**
   * @behavior completeStep(ship) clears nextCommand
   * @acceptance-criteria After ship completes, nextCommand is null
   */
  it('should set nextCommand to null after ship completes', async () => {
    await service.completeStep('ship');
    const state = await service.getState();
    expect(state.nextCommand).toBeNull();
  });
});
