/**
 * @behavior oss-notify.sh writes workflow state to project .oss/ via CLI
 * @acceptance-criteria Workflow state updates go to project directory when current-project set
 * @business-rule Multi-project support requires notifications to update correct project state
 * @boundary Shell script (oss-notify.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-notify.sh - Project State Updates', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const notifyScript = path.join(hooksDir, 'oss-notify.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');
  const globalWorkflowFile = path.join(ossDir, 'workflow-state.json');
  const testProjectDir = path.join(os.tmpdir(), `oss-notify-test-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const projectWorkflowFile = path.join(projectOssDir, 'workflow-state.json');

  // Save original state
  let originalCurrentProject: string | null = null;
  let originalGlobalWorkflow: string | null = null;

  beforeEach(() => {
    // Save original files
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    if (fs.existsSync(globalWorkflowFile)) {
      originalGlobalWorkflow = fs.readFileSync(globalWorkflowFile, 'utf-8');
    }

    // Create test project directory with .oss
    fs.mkdirSync(projectOssDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original files
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }

    if (originalGlobalWorkflow !== null) {
      fs.writeFileSync(globalWorkflowFile, originalGlobalWorkflow);
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior oss-notify.sh workflow start updates project state via CLI
   * @acceptance-criteria activeStep written to project .oss/workflow-state.json
   */
  it('should write workflow state to project .oss when current-project set', () => {
    // GIVEN: current-project points to test project
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // WHEN: Running notify script with workflow start
    try {
      // Delete CLAUDE_PROJECT_DIR so CLI uses current-project file
      const env = { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..') };
      delete env.CLAUDE_PROJECT_DIR;

      execSync(`bash "${notifyScript}" --workflow build start '{}'`, {
        timeout: 10000,
        encoding: 'utf-8',
        env,
      });
    } catch {
      // Ignore exit code, we care about state file
    }

    // THEN: Project workflow-state.json should have build as active step
    expect(fs.existsSync(projectWorkflowFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
    expect(state.activeStep).toBe('build');
  });

  /**
   * @behavior oss-notify.sh task_complete updates project progress
   * @acceptance-criteria progress written to project .oss/workflow-state.json
   */
  it('should update project progress on task_complete', () => {
    // GIVEN: current-project points to test project
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // AND: Project has initial state from build start
    fs.writeFileSync(projectWorkflowFile, JSON.stringify({
      activeStep: 'build',
      supervisor: 'watching'
    }));

    // WHEN: Running notify script with task_complete
    try {
      // Delete CLAUDE_PROJECT_DIR so CLI uses current-project file
      const env = { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..') };
      delete env.CLAUDE_PROJECT_DIR;

      execSync(`bash "${notifyScript}" --workflow build task_complete '{"current": 3, "total": 10, "taskName": "Test task"}'`, {
        timeout: 10000,
        encoding: 'utf-8',
        env,
      });
    } catch {
      // Ignore exit code
    }

    // THEN: Project state should have progress updated
    const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
    expect(state.progress).toContain('3/10');
  });
});
