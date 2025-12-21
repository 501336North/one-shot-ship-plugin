/**
 * @behavior update-workflow-state CLI supports project-level state via --project-dir flag
 * @acceptance-criteria CLI writes to project .oss/ when --project-dir is specified
 * @business-rule Multi-project support requires writing state to correct project
 * @boundary CLI (update-workflow-state.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('update-workflow-state CLI - Project Support', () => {
  const cliPath = path.join(__dirname, '../../dist/cli/update-workflow-state.js');
  const testProjectDir = path.join(os.tmpdir(), `oss-cli-test-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const projectWorkflowFile = path.join(projectOssDir, 'workflow-state.json');
  const ossDir = path.join(os.homedir(), '.oss');
  const globalWorkflowFile = path.join(ossDir, 'workflow-state.json');
  const currentProjectFile = path.join(ossDir, 'current-project');

  // Save original state
  let originalGlobalWorkflow: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Save original files
    if (fs.existsSync(globalWorkflowFile)) {
      originalGlobalWorkflow = fs.readFileSync(globalWorkflowFile, 'utf-8');
    }
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project directory
    fs.mkdirSync(projectOssDir, { recursive: true });

    // Clear current-project
    if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }
  });

  afterEach(() => {
    // Restore original files
    if (originalGlobalWorkflow !== null) {
      fs.writeFileSync(globalWorkflowFile, originalGlobalWorkflow);
    }
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

  describe('--project-dir flag', () => {
    /**
     * @behavior CLI with --project-dir writes to project .oss/
     * @acceptance-criteria State written to specified project directory
     */
    it('should write state to project .oss when --project-dir specified', () => {
      // GIVEN: Project directory with .oss exists
      expect(fs.existsSync(projectOssDir)).toBe(true);

      // WHEN: Running CLI with --project-dir
      try {
        execSync(`node "${cliPath}" --project-dir "${testProjectDir}" setActiveStep build`, {
          timeout: 10000,
          encoding: 'utf-8',
        });
      } catch (error) {
        // Ignore exit code, check state file
      }

      // THEN: State should be in project .oss/
      expect(fs.existsSync(projectWorkflowFile)).toBe(true);
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.activeStep).toBe('build');
    });

    /**
     * @behavior CLI with --project-dir creates .oss if needed
     * @acceptance-criteria Creates project .oss directory if it doesn't exist
     */
    it('should create project .oss directory if missing', () => {
      // GIVEN: Project .oss directory doesn't exist
      fs.rmSync(projectOssDir, { recursive: true, force: true });
      expect(fs.existsSync(projectOssDir)).toBe(false);

      // WHEN: Running CLI with --project-dir
      try {
        execSync(`node "${cliPath}" --project-dir "${testProjectDir}" setActiveStep plan`, {
          timeout: 10000,
          encoding: 'utf-8',
        });
      } catch (error) {
        // Ignore exit code
      }

      // THEN: Project .oss should be created with state
      expect(fs.existsSync(projectOssDir)).toBe(true);
      expect(fs.existsSync(projectWorkflowFile)).toBe(true);
    });
  });

  describe('current-project file', () => {
    /**
     * @behavior CLI reads current-project when no --project-dir
     * @acceptance-criteria Uses project from ~/.oss/current-project if set
     */
    it('should use current-project when no --project-dir', () => {
      // GIVEN: current-project points to test project
      fs.writeFileSync(currentProjectFile, testProjectDir);

      // WHEN: Running CLI without --project-dir
      try {
        execSync(`node "${cliPath}" setActiveStep ship`, {
          timeout: 10000,
          encoding: 'utf-8',
        });
      } catch (error) {
        // Ignore exit code
      }

      // THEN: State should be in project .oss/
      expect(fs.existsSync(projectWorkflowFile)).toBe(true);
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.activeStep).toBe('ship');
    });

    /**
     * @behavior CLI falls back to global when current-project empty
     * @acceptance-criteria Uses ~/.oss/ when current-project is empty
     */
    it('should fall back to global when current-project empty', () => {
      // GIVEN: current-project is empty
      fs.writeFileSync(currentProjectFile, '');

      // AND: Global .oss directory exists, no state file
      fs.mkdirSync(path.dirname(globalWorkflowFile), { recursive: true });
      if (fs.existsSync(globalWorkflowFile)) {
        fs.unlinkSync(globalWorkflowFile);
      }

      // WHEN: Running CLI without --project-dir
      let output = '';
      try {
        output = execSync(`node "${cliPath}" setActiveStep ideate`, {
          timeout: 10000,
          encoding: 'utf-8',
        });
      } catch (error) {
        const execError = error as { stdout?: string };
        output = execError.stdout || '';
      }

      // THEN: State should be in global .oss/ (CLI creates it)
      expect(fs.existsSync(globalWorkflowFile)).toBe(true);
      const state = JSON.parse(fs.readFileSync(globalWorkflowFile, 'utf-8'));
      expect(state.activeStep).toBe('ideate');
    });
  });
});
