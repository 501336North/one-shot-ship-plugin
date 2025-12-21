/**
 * @behavior update-workflow-state.js CLI supports activeAgent commands
 * @acceptance-criteria CLI can set/clear active agent in workflow state
 * @business-rule oss-log.sh uses CLI to update agent status
 * @boundary CLI (update-workflow-state.js) → workflow-state.json
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('update-workflow-state.js - Agent Commands', () => {
  const cliPath = path.join(__dirname, '../../dist/cli/update-workflow-state.js');
  const testDir = path.join(os.tmpdir(), `update-workflow-state-agent-test-${Date.now()}`);
  const ossDir = path.join(testDir, '.oss');
  const stateFile = path.join(ossDir, 'workflow-state.json');

  beforeEach(() => {
    // Create test directory
    fs.mkdirSync(ossDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const runCli = (args: string): string => {
    try {
      return execSync(`node "${cliPath}" --project-dir "${testDir}" ${args}`, {
        timeout: 10000,
        encoding: 'utf-8',
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string };
      return execError.stdout || execError.stderr || '';
    }
  };

  /**
   * @behavior setActiveAgent command sets agent in workflow state
   * @acceptance-criteria AC-2.3.1
   */
  it('should set activeAgent via CLI command', () => {
    // GIVEN: An initialized workflow state
    runCli('init');

    // WHEN: Running setActiveAgent command
    const output = runCli('setActiveAgent \'{"type": "react-specialist", "task": "UserProfile component"}\'');

    // THEN: Output should confirm and state should have agent
    expect(output).toContain('Active agent set');
    expect(fs.existsSync(stateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.activeAgent).toBeDefined();
    expect(state.activeAgent.type).toBe('react-specialist');
    expect(state.activeAgent.task).toBe('UserProfile component');
  });

  /**
   * @behavior clearActiveAgent command removes agent from workflow state
   * @acceptance-criteria AC-2.3.2
   */
  it('should clear activeAgent via CLI command', () => {
    // GIVEN: A workflow state with an active agent
    runCli('init');
    runCli('setActiveAgent \'{"type": "typescript-pro", "task": "Fix types"}\'');

    // WHEN: Running clearActiveAgent command
    const output = runCli('clearActiveAgent');

    // THEN: Output should confirm and state should not have agent
    expect(output).toContain('Active agent cleared');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.activeAgent).toBeUndefined();
  });
});
