/**
 * @behavior TDD phase updates flow through to status line display
 * @acceptance-criteria When oss-log.sh phase command runs, status line shows TDD phase
 * @business-rule Status line is the primary feedback mechanism for TDD phase
 * @boundary oss-log.sh → workflow-state.json → oss-statusline.sh (E2E)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('E2E: TDD Phase Status Line Integration', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const logScript = path.join(hooksDir, 'oss-log.sh');
  const statuslineScript = path.join(hooksDir, 'oss-statusline.sh');
  const testProjectDir = path.join(os.tmpdir(), `oss-e2e-tdd-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const logsDir = path.join(projectOssDir, 'logs', 'current-session');
  const workflowStateFile = path.join(projectOssDir, 'workflow-state.json');

  // Save original state
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Save original current-project
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project directory with .oss structure
    fs.mkdirSync(projectOssDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Initialize git repo for status line branch detection
    try {
      execSync('git init', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git checkout -b feat/test-e2e', { cwd: testProjectDir, stdio: 'ignore' });
    } catch {
      // Git init might fail in some environments
    }

    // Set current-project to point to test project
    fs.writeFileSync(currentProjectFile, testProjectDir);
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }

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
          HOME: os.homedir(),
        },
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string };
      return execError.stdout || execError.stderr || '';
    }
  };

  const runStatusLine = (): string => {
    const input = JSON.stringify({
      model: { display_name: 'Claude' },
      workspace: { current_dir: testProjectDir }
    });

    try {
      return execSync(`echo '${input}' | bash "${statuslineScript}"`, {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: testProjectDir,
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string };
      return execError.stdout || '';
    }
  };

  // Wait for workflow state to be updated
  const waitForState = async (maxMs = 2000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (fs.existsSync(workflowStateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
          if (state.tddPhase) {
            return true;
          }
        } catch {
          // File might be partially written
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  };

  /**
   * @behavior Full E2E: oss-log.sh phase → workflow-state.json → status line
   * @acceptance-criteria Running oss-log.sh phase RED start results in status line showing 🔴 RED
   */
  it('should show RED phase in status line after oss-log.sh phase RED start', async () => {
    // GIVEN: A project with .oss directory

    // WHEN: Running oss-log.sh with phase RED start
    runLogCommand('phase build RED start');

    // AND: Waiting for workflow state to be updated
    const stateUpdated = await waitForState();
    expect(stateUpdated).toBe(true);

    // AND: Running status line script
    const output = runStatusLine();

    // THEN: Status line should show RED phase
    expect(output).toContain('🔴 RED');
  });

  /**
   * @behavior Full E2E: Phase transitions show in status line
   * @acceptance-criteria RED → GREEN → REFACTOR cycle reflected in status line
   */
  it('should show phase transitions in status line', async () => {
    // GIVEN: Project starts with RED phase
    runLogCommand('phase build RED start');
    await waitForState();

    let output = runStatusLine();
    expect(output).toContain('🔴 RED');

    // WHEN: Transitioning to GREEN
    runLogCommand('phase build GREEN start');
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait for update

    output = runStatusLine();
    expect(output).toContain('🟢 GREEN');

    // WHEN: Transitioning to REFACTOR
    runLogCommand('phase build REFACTOR start');
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait for update

    output = runStatusLine();
    expect(output).toContain('🔵 REFACTOR');
  });
});
