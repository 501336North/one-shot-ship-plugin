/**
 * @behavior update-workflow-state.js CLI supports message commands
 * @acceptance-criteria CLI can set/clear message in workflow state
 * @business-rule oss-notify.sh uses CLI to update status line message
 * @boundary CLI (update-workflow-state.js) → workflow-state.json
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('update-workflow-state.js - Message Commands', () => {
  const cliPath = path.join(__dirname, '../../dist/cli/update-workflow-state.js');
  const testDir = path.join(os.tmpdir(), `update-workflow-state-message-test-${Date.now()}`);
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
   * @behavior setMessage command sets message in workflow state
   * @acceptance-criteria AC-STATUS-MSG.CLI.1
   */
  it('should set message via CLI command', () => {
    // GIVEN: An initialized workflow state
    runCli('init');

    // WHEN: Running setMessage command
    const output = runCli('setMessage "Ideating"');

    // THEN: Output should confirm and state should have message
    expect(output).toContain('Message set');
    expect(fs.existsSync(stateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.message).toBe('Ideating');
  });

  /**
   * @behavior clearMessage command removes message from workflow state
   * @acceptance-criteria AC-STATUS-MSG.CLI.2
   */
  it('should clear message via CLI command', () => {
    // GIVEN: A workflow state with a message
    runCli('init');
    runCli('setMessage "Building 3/10"');

    // WHEN: Running clearMessage command
    const output = runCli('clearMessage');

    // THEN: Output should confirm and state should not have message
    expect(output).toContain('Message cleared');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.message).toBeUndefined();
  });
});
