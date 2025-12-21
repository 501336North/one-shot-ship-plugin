/**
 * @behavior TDD phase displays as emoji only, not "emoji TEXT"
 * @acceptance-criteria Output contains "🔴" not "🔴 RED"
 * @business-rule Cleaner, more compact status line display
 * @boundary Shell script (oss-statusline.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-statusline.sh - Emoji-Only TDD Display', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const statuslineScript = path.join(hooksDir, 'oss-statusline.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');

  const testProjectDir = path.join(os.tmpdir(), `oss-tdd-emoji-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const projectWorkflowFile = path.join(projectOssDir, 'workflow-state.json');

  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    fs.mkdirSync(projectOssDir, { recursive: true });
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
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }
    fs.rmSync(testProjectDir, { recursive: true, force: true });
  });

  /**
   * @behavior RED phase displays as emoji only
   * @acceptance-criteria Output contains "🔴" not "🔴 RED"
   */
  it('should display RED phase as emoji only', () => {
    // GIVEN: Workflow state has tddPhase=red
    const projectState = {
      tddPhase: 'red',
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

    // THEN: Output should contain "🔴" but NOT "RED"
    expect(output).toContain('🔴');
    expect(output).not.toContain('RED');
  });

  /**
   * @behavior GREEN phase displays as emoji only
   * @acceptance-criteria Output contains "🟢" not "🟢 GREEN"
   */
  it('should display GREEN phase as emoji only', () => {
    const projectState = {
      tddPhase: 'green',
      supervisor: 'watching'
    };
    fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
    fs.writeFileSync(currentProjectFile, testProjectDir);

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

    expect(output).toContain('🟢');
    expect(output).not.toContain('GREEN');
  });

  /**
   * @behavior REFACTOR phase displays as emoji only
   * @acceptance-criteria Output contains "🔄" not "🔵 REFACTOR"
   */
  it('should display REFACTOR phase as emoji only', () => {
    const projectState = {
      tddPhase: 'refactor',
      supervisor: 'watching'
    };
    fs.writeFileSync(projectWorkflowFile, JSON.stringify(projectState));
    fs.writeFileSync(currentProjectFile, testProjectDir);

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

    expect(output).toContain('🔄');
    expect(output).not.toContain('REFACTOR');
  });
});
