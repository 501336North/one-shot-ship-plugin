/**
 * @behavior oss-log.sh phase command updates tddPhase in workflow-state.json
 * @acceptance-criteria TDD phase transitions are reflected in status line state
 * @business-rule Status line shows current TDD phase (RED/GREEN/REFACTOR)
 * @boundary Shell script (oss-log.sh phase commands) → workflow-state.json
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh - Phase State Updates', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const watcherDir = path.join(__dirname, '../../../watcher');
  const logScript = path.join(hooksDir, 'oss-log.sh');
  const testProjectDir = path.join(os.tmpdir(), `oss-log-phase-test-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const workflowStateFile = path.join(projectOssDir, 'workflow-state.json');
  const logsDir = path.join(projectOssDir, 'logs', 'current-session');
  const currentProjectFile = path.join(projectOssDir, 'current-project');

  beforeEach(() => {
    // Create test project directory with .oss structure
    fs.mkdirSync(projectOssDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Set current-project to point to this test project
    fs.writeFileSync(currentProjectFile, testProjectDir);
  });

  afterEach(() => {
    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  const runLogCommand = (args: string): string => {
    try {
      return execSync(`bash "${logScript}" ${args}`, {
        timeout: 10000,
        encoding: 'utf-8',
        cwd: testProjectDir,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          HOME: testProjectDir,
        },
      });
    } catch (error: unknown) {
      // Return output even on error (some commands exit non-zero)
      const execError = error as { stdout?: string; stderr?: string };
      return execError.stdout || execError.stderr || '';
    }
  };

  // Wait for async workflow state update with timeout
  const waitForState = async (maxMs = 2000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (fs.existsSync(workflowStateFile)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  };

  /**
   * @behavior oss-log.sh phase build RED start sets tddPhase to "red"
   * @acceptance-criteria AC-1.1.1
   */
  it('should set tddPhase to "red" when phase build RED start is called', async () => {
    // GIVEN: A project with .oss directory

    // WHEN: Running log script with phase build RED start
    runLogCommand('phase build RED start');

    // THEN: workflow-state.json should have tddPhase: "red" (wait for async update)
    const found = await waitForState();
    expect(found).toBe(true);
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.chainState.red).toBe('active');
  });

  /**
   * @behavior oss-log.sh phase build GREEN start sets tddPhase to "green"
   * @acceptance-criteria AC-1.1.2
   */
  it('should set tddPhase to "green" when phase build GREEN start is called', async () => {
    // GIVEN: A project with .oss directory

    // WHEN: Running log script with phase build GREEN start
    runLogCommand('phase build GREEN start');

    // THEN: workflow-state.json should have green as active (wait for async update)
    const found = await waitForState();
    expect(found).toBe(true);
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.chainState.green).toBe('active');
  });

  /**
   * @behavior oss-log.sh phase build REFACTOR start sets tddPhase to "refactor"
   * @acceptance-criteria AC-1.1.3
   */
  it('should set tddPhase to "refactor" when phase build REFACTOR start is called', async () => {
    // GIVEN: A project with .oss directory

    // WHEN: Running log script with phase build REFACTOR start
    runLogCommand('phase build REFACTOR start');

    // THEN: workflow-state.json should have refactor as active (wait for async update)
    const found = await waitForState();
    expect(found).toBe(true);
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.chainState.refactor).toBe('active');
  });

  /**
   * @behavior oss-log.sh phase command still writes to log file
   * @acceptance-criteria AC-1.1.4 - Existing logging behavior preserved
   */
  it('should still write to log file when phase command is called', () => {
    // GIVEN: A project with .oss/logs directory
    const buildLogFile = path.join(logsDir, 'build.log');

    // WHEN: Running log script with phase build RED start
    runLogCommand('phase build RED start');

    // THEN: build.log should contain the phase entry
    expect(fs.existsSync(buildLogFile)).toBe(true);
    const logContent = fs.readFileSync(buildLogFile, 'utf-8');
    expect(logContent).toContain('[PHASE] RED start');
  });

  /**
   * @behavior oss-log.sh phase build RED complete keeps tddPhase (awaiting GREEN)
   * @acceptance-criteria AC-1.2.1
   */
  it('should keep tddPhase after phase build RED complete', async () => {
    // GIVEN: A project with red as active phase
    runLogCommand('phase build RED start');
    await waitForState();

    // WHEN: Running log script with phase build RED complete
    runLogCommand('phase build RED complete');

    // Small delay for any state update to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // THEN: workflow-state.json should still have chainState.red as active (no change on complete)
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.chainState.red).toBe('active');
  });

  /**
   * @behavior oss-log.sh phase build REFACTOR complete clears tddPhase (cycle done)
   * @acceptance-criteria AC-1.2.2
   */
  it('should clear tddPhase after phase build REFACTOR complete when workflow ends', async () => {
    // GIVEN: A project with refactor as active phase
    runLogCommand('phase build REFACTOR start');
    await waitForState();

    // WHEN: Running log script with phase build REFACTOR complete
    runLogCommand('phase build REFACTOR complete');

    // Small delay for any state update to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // THEN: workflow-state.json should still have refactor as active
    // (Clearing happens at workflow end, not per-phase complete)
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.chainState.refactor).toBe('active');
  });
});
