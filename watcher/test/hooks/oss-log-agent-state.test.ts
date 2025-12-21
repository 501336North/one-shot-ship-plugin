/**
 * @behavior oss-log.sh agent command updates activeAgent in workflow-state.json
 * @acceptance-criteria Agent delegations are reflected in status line state
 * @business-rule Status line shows which agent is currently executing
 * @boundary Shell script (oss-log.sh agent commands) → workflow-state.json
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh - Agent State Updates', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const logScript = path.join(hooksDir, 'oss-log.sh');
  const testProjectDir = path.join(os.tmpdir(), `oss-log-agent-test-${Date.now()}`);
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

  // Wait for activeAgent to appear in state
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

  // Wait for activeAgent to be cleared
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
   * @behavior oss-log.sh agent command with "starting" sets activeAgent
   * @acceptance-criteria AC-2.4.1
   */
  it('should set activeAgent when agent command has "starting" message', async () => {
    // GIVEN: A project with .oss directory

    // WHEN: Running log script with agent command containing "starting"
    runLogCommand('agent build react-specialist "starting: UserProfile component"');

    // THEN: workflow-state.json should have activeAgent
    const found = await waitForAgent();
    expect(found).toBe(true);
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.activeAgent).toBeDefined();
    expect(state.activeAgent.type).toBe('react-specialist');
    expect(state.activeAgent.task).toContain('UserProfile');
  });

  /**
   * @behavior oss-log.sh agent command with "completed" clears activeAgent
   * @acceptance-criteria AC-2.4.2
   */
  it('should clear activeAgent when agent command has "completed" message', async () => {
    // GIVEN: A project with an active agent
    runLogCommand('agent build react-specialist "starting: UserProfile component"');
    await waitForAgent();

    // WHEN: Running log script with agent command containing "completed"
    runLogCommand('agent build react-specialist "completed: UserProfile component done"');

    // THEN: workflow-state.json should not have activeAgent
    const cleared = await waitForAgentCleared();
    expect(cleared).toBe(true);
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.activeAgent).toBeUndefined();
  });

  /**
   * @behavior oss-log.sh agent command with "starting" sets supervisor to "intervening"
   * @acceptance-criteria AC-2.4.3
   */
  it('should set supervisor to "intervening" when agent starts', async () => {
    // GIVEN: A project with .oss directory

    // WHEN: Running log script with agent command containing "starting"
    runLogCommand('agent build typescript-pro "starting: Fix type errors"');

    // THEN: workflow-state.json should have supervisor: "intervening"
    const found = await waitForAgent();
    expect(found).toBe(true);
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.supervisor).toBe('intervening');
  });

  /**
   * @behavior oss-log.sh agent command with "completed" sets supervisor to "watching"
   * @acceptance-criteria AC-2.4.4
   */
  it('should set supervisor to "watching" when agent completes', async () => {
    // GIVEN: A project with an active agent
    runLogCommand('agent build typescript-pro "starting: Fix type errors"');
    await waitForAgent();

    // WHEN: Running log script with agent command containing "completed"
    runLogCommand('agent build typescript-pro "completed: Types fixed"');

    // THEN: workflow-state.json should have supervisor: "watching"
    const cleared = await waitForAgentCleared();
    expect(cleared).toBe(true);
    const state = JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    expect(state.supervisor).toBe('watching');
  });

  /**
   * @behavior oss-log.sh agent command still writes to log file
   * @acceptance-criteria Existing logging behavior preserved
   */
  it('should still write to log file when agent command is called', () => {
    // GIVEN: A project with .oss/logs directory
    const buildLogFile = path.join(logsDir, 'build.log');

    // WHEN: Running log script with agent command
    runLogCommand('agent build react-specialist "starting: UserProfile"');

    // THEN: build.log should contain the agent entry
    expect(fs.existsSync(buildLogFile)).toBe(true);
    const logContent = fs.readFileSync(buildLogFile, 'utf-8');
    expect(logContent).toContain('[AGENT] react-specialist');
  });
});
