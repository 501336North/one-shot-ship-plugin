/**
 * @behavior Status line displays nextCommand with arrow indicator
 * @acceptance-criteria Format: "plan → build" when currentCommand=plan, nextCommand=build
 * @business-rule User always knows what command to run next
 * @boundary Shell script (oss-statusline.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-statusline.sh - Next Command Display', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const statuslineScript = path.join(hooksDir, 'oss-statusline.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');

  const testProjectDir = path.join(os.tmpdir(), `oss-next-cmd-display-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const projectWorkflowFile = path.join(projectOssDir, 'workflow-state.json');

  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Save original current-project
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project directory
    fs.mkdirSync(projectOssDir, { recursive: true });

    // Initialize as git repo
    try {
      execSync('git init', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git checkout -b feat/test-branch', { cwd: testProjectDir, stdio: 'ignore' });
    } catch {
      // Git might fail
    }
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }

    // Cleanup
    fs.rmSync(testProjectDir, { recursive: true, force: true });
  });

  /**
   * @behavior Status line shows currentCommand → nextCommand with arrow
   * @acceptance-criteria Output contains "plan → build" format
   */
  it('should display currentCommand → nextCommand with arrow', () => {
    // GIVEN: Workflow state has both currentCommand and nextCommand
    const projectState = {
      currentCommand: 'plan',
      nextCommand: 'build',
      supervisor: 'watching'
    };
    fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // WHEN: Running statusline script
    const input = JSON.stringify({
      model: { display_name: 'Claude' },
      workspace: { current_dir: testProjectDir }
    });

    let output = '';
    try {
      output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: testProjectDir,
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      output = execError.stdout || '';
    }

    // THEN: Output should contain "plan → build"
    expect(output).toContain('plan → build');
  });

  /**
   * @behavior Status line shows only nextCommand when no currentCommand
   * @acceptance-criteria Output contains "→ ideate" format (fresh start)
   */
  it('should show "→ nextCommand" when only nextCommand is set', () => {
    // GIVEN: Only nextCommand is set (fresh start or between commands)
    const projectState = {
      nextCommand: 'ideate',
      supervisor: 'watching'
    };
    fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // WHEN: Running statusline script
    const input = JSON.stringify({
      model: { display_name: 'Claude' },
      workspace: { current_dir: testProjectDir }
    });

    let output = '';
    try {
      output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: testProjectDir,
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      output = execError.stdout || '';
    }

    // THEN: Output should contain "→ ideate"
    expect(output).toContain('→ ideate');
  });

  /**
   * @behavior Status line shows only currentCommand when no nextCommand
   * @acceptance-criteria Output contains just the command name (no arrow)
   */
  it('should show currentCommand without arrow when nextCommand is null', () => {
    // GIVEN: currentCommand is set but nextCommand is null (after ship)
    const projectState = {
      currentCommand: 'ship',
      nextCommand: null,
      supervisor: 'watching'
    };
    fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // WHEN: Running statusline script
    const input = JSON.stringify({
      model: { display_name: 'Claude' },
      workspace: { current_dir: testProjectDir }
    });

    let output = '';
    try {
      output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: testProjectDir,
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      output = execError.stdout || '';
    }

    // THEN: Output should contain "ship" but not "→"
    expect(output).toContain('ship');
    expect(output).not.toContain('→');
  });
});
