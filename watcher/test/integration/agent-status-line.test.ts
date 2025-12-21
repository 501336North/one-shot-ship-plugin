/**
 * @behavior Agent status updates flow through to status line display
 * @acceptance-criteria When oss-log.sh agent command runs, status line shows active agent
 * @business-rule Status line shows delegated work to help users track agent activity
 * @boundary oss-log.sh → workflow-state.json → oss-statusline.sh (E2E)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('E2E: Agent Status Line Integration', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const logScript = path.join(hooksDir, 'oss-log.sh');
  const statuslineScript = path.join(hooksDir, 'oss-statusline.sh');
  const testProjectDir = path.join(os.tmpdir(), `oss-e2e-agent-${Date.now()}`);
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

  // Wait for agent to appear in workflow state
  const waitForAgent = async (maxMs = 2000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (fs.existsSync(workflowStateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
          if (state.activeAgent) {
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

  // Wait for agent to be cleared from workflow state
  const waitForAgentCleared = async (maxMs = 2000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (fs.existsSync(workflowStateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
          if (!state.activeAgent) {
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
   * @behavior Full E2E: oss-log.sh agent starting → status line shows agent
   * @acceptance-criteria Running oss-log.sh agent with "starting:" shows agent in status line
   */
  it('should show agent in status line when agent starts', async () => {
    // GIVEN: A project with .oss directory

    // WHEN: Running oss-log.sh with agent command containing "starting:"
    runLogCommand('agent build react-specialist "starting: UserProfile component"');

    // AND: Waiting for workflow state to be updated
    const agentActive = await waitForAgent();
    expect(agentActive).toBe(true);

    // AND: Running status line script
    const output = runStatusLine();

    // THEN: Status line should show the agent type
    expect(output).toContain('react-specialist');
    // AND: Should show intervening indicator
    expect(output).toContain('⚡');
  });

  /**
   * @behavior Full E2E: Agent lifecycle shows in status line
   * @acceptance-criteria Agent appears on start, disappears on complete
   */
  it('should clear agent from status line when agent completes', async () => {
    // GIVEN: An active agent
    runLogCommand('agent build typescript-pro "starting: Fix type errors"');
    await waitForAgent();

    let output = runStatusLine();
    expect(output).toContain('typescript-pro');

    // WHEN: Agent completes
    runLogCommand('agent build typescript-pro "completed: Types fixed"');

    // AND: Waiting for agent to be cleared
    const agentCleared = await waitForAgentCleared();
    expect(agentCleared).toBe(true);

    // THEN: Status line should NOT show the agent
    output = runStatusLine();
    expect(output).not.toContain('typescript-pro');
    // AND: Should show watching indicator (not intervening)
    expect(output).toContain('✓');
    expect(output).not.toContain('⚡');
  });
});
