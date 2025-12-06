/**
 * Supervisor E2E Tests
 *
 * @behavior Full workflow monitoring and intervention system works end-to-end
 * @acceptance-criteria AC-E2E.1 through AC-E2E.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WatcherSupervisor } from '../src/supervisor/watcher-supervisor.js';
import { WorkflowLogger } from '../src/logger/workflow-logger.js';
import { LogReader } from '../src/logger/log-reader.js';
import { QueueManager } from '../src/queue/manager.js';

describe('Supervisor E2E', () => {
  let testDir: string;
  let ossDir: string;
  let supervisor: WatcherSupervisor;
  let logger: WorkflowLogger;
  let reader: LogReader;
  let queueManager: QueueManager;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-e2e-test-'));
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });

    queueManager = new QueueManager(ossDir);
    await queueManager.initialize();
    logger = new WorkflowLogger(ossDir);
    reader = new LogReader(ossDir);
    supervisor = new WatcherSupervisor(ossDir, queueManager);
  });

  afterEach(async () => {
    await supervisor.stop();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('full chain produces valid workflow log', async () => {
    // Simulate a complete ideate -> plan chain
    await logger.log({ cmd: 'ideate', event: 'START', data: { args: ['user auth'] } });
    await logger.log({ cmd: 'ideate', event: 'MILESTONE', data: { section: 'problem_definition' } });
    await logger.log({ cmd: 'ideate', event: 'MILESTONE', data: { section: 'solution_design' } });
    await logger.log({
      cmd: 'ideate',
      event: 'COMPLETE',
      data: { summary: 'Design complete', outputs: ['DESIGN.md'] },
    });
    await logger.log({ cmd: 'plan', event: 'START', data: {} });
    await logger.log({ cmd: 'plan', event: 'MILESTONE', data: { phase: 'analysis' } });
    await logger.log({ cmd: 'plan', event: 'MILESTONE', data: { phase: 'generation' } });
    await logger.log({
      cmd: 'plan',
      event: 'COMPLETE',
      data: { summary: 'TDD plan created', outputs: ['PLAN.md'] },
    });

    // Read and verify log structure
    const entries = await reader.readAll();

    expect(entries.length).toBe(8);
    expect(entries[0].event).toBe('START');
    expect(entries[0].cmd).toBe('ideate');
    expect(entries[7].event).toBe('COMPLETE');
    expect(entries[7].cmd).toBe('plan');

    // Verify each entry has required fields
    for (const entry of entries) {
      expect(entry.ts).toBeDefined();
      expect(entry.cmd).toBeDefined();
      expect(entry.event).toBeDefined();
    }
  });

  it('watcher detects simulated loop and intervenes', async () => {
    await supervisor.start();
    const interventions: Array<{ issue: { type: string }; response_type: string }> = [];
    supervisor.onIntervention((int) => interventions.push(int));

    await new Promise((r) => setTimeout(r, 100));

    // Simulate a loop (same action repeated)
    for (let i = 0; i < 5; i++) {
      await logger.log({ cmd: 'build', event: 'MILESTONE', data: { retry: 'fix_import' } });
    }

    await new Promise((r) => setTimeout(r, 200));

    // Should have detected and intervened
    expect(interventions.length).toBeGreaterThan(0);
    expect(interventions[0].issue.type).toBe('loop_detected');
  });

  it('watcher detects simulated failure and notifies', async () => {
    await supervisor.start();
    const notifications: Array<{ title: string; message: string }> = [];
    supervisor.onNotify((title, message) => notifications.push({ title, message }));

    await new Promise((r) => setTimeout(r, 100));

    // Provide proper chain context first
    await logger.log({ cmd: 'plan', event: 'COMPLETE', data: { outputs: ['PLAN.md'] } });
    // Then log a failed command
    await logger.log({ cmd: 'build', event: 'START', data: {} });
    await logger.log({
      cmd: 'build',
      event: 'FAILED',
      data: { error: 'Tests failed: 3 assertions' },
    });

    await new Promise((r) => setTimeout(r, 200));

    // Should have notified about failure
    expect(notifications.length).toBeGreaterThan(0);
    const failureNotif = notifications.find((n) => n.title.includes('Failure'));
    expect(failureNotif).toBeDefined();
  });

  it('commands read chain memory from log', async () => {
    // Simulate previous command completion
    await logger.log({
      cmd: 'ideate',
      event: 'COMPLETE',
      data: { summary: 'Auth system design', outputs: ['dev/active/auth/DESIGN.md'] },
    });
    await logger.log({
      cmd: 'plan',
      event: 'COMPLETE',
      data: { summary: 'TDD plan ready', outputs: ['dev/active/auth/PLAN.md'] },
    });

    // Query for last completed command
    const lastPlan = await reader.queryLast({ cmd: 'plan', event: 'COMPLETE' });
    const lastIdeate = await reader.queryLast({ cmd: 'ideate', event: 'COMPLETE' });

    expect(lastPlan).not.toBeNull();
    expect(lastPlan?.data.outputs).toContain('dev/active/auth/PLAN.md');
    expect(lastIdeate?.data.summary).toBe('Auth system design');
  });

  it('intervention appears in queue', async () => {
    await supervisor.start();

    await new Promise((r) => setTimeout(r, 100));

    // Trigger an issue
    await logger.log({ cmd: 'build', event: 'FAILED', data: { error: 'Compilation error' } });

    await new Promise((r) => setTimeout(r, 200));

    // Check queue
    const tasks = await queueManager.getTasks();

    // There should be a task created for the failure
    expect(tasks.length).toBeGreaterThan(0);
    const failureTask = tasks.find((t) => t.anomaly_type === 'agent_error');
    expect(failureTask).toBeDefined();
    expect(failureTask?.prompt).toContain('Failure');
  });

  it('state persists across supervisor restart', async () => {
    // First session: log some events
    await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: { outputs: ['DESIGN.md'] } });
    await logger.log({ cmd: 'plan', event: 'START', data: {} });

    await supervisor.start();
    await new Promise((r) => setTimeout(r, 150));
    await supervisor.stop();

    // Verify state was saved
    const statePath = path.join(ossDir, 'workflow-state.json');
    expect(fs.existsSync(statePath)).toBe(true);

    // Second session: create new supervisor
    const supervisor2 = new WatcherSupervisor(ossDir, queueManager);
    await supervisor2.start();
    await new Promise((r) => setTimeout(r, 100));

    // State should be restored
    const state = supervisor2.getState();
    expect(state.chain_progress.ideate).toBe('complete');
    expect(state.chain_progress.plan).toBe('in_progress');

    await supervisor2.stop();
  });
});
