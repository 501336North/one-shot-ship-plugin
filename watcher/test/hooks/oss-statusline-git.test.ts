/**
 * @behavior Status line reads git branch from workspace.current_dir, not script CWD
 * @acceptance-criteria Branch display reflects project directory passed via stdin
 * @business-rule Git branch should match the project being worked on, not where script runs
 * @boundary Shell script (oss-statusline.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-statusline.sh - Git Branch from Project Directory', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const statuslineScript = path.join(hooksDir, 'oss-statusline.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');

  // Two test project directories with different branches
  const projectADir = path.join(os.tmpdir(), `oss-git-test-A-${Date.now()}`);
  const projectBDir = path.join(os.tmpdir(), `oss-git-test-B-${Date.now()}`);

  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Save original current-project
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create Project A with feat/alpha branch
    fs.mkdirSync(path.join(projectADir, '.oss'), { recursive: true });
    fs.writeFileSync(
      path.join(projectADir, '.oss', 'workflow-state.json'),
      JSON.stringify({ tddPhase: 'red', supervisor: 'watching' })
    );
    try {
      execSync('git init', { cwd: projectADir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: projectADir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: projectADir, stdio: 'ignore' });
      execSync('git checkout -b feat/alpha', { cwd: projectADir, stdio: 'ignore' });
    } catch {
      // Git might fail in some environments
    }

    // Create Project B with feat/beta branch
    fs.mkdirSync(path.join(projectBDir, '.oss'), { recursive: true });
    fs.writeFileSync(
      path.join(projectBDir, '.oss', 'workflow-state.json'),
      JSON.stringify({ tddPhase: 'green', supervisor: 'watching' })
    );
    try {
      execSync('git init', { cwd: projectBDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: projectBDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: projectBDir, stdio: 'ignore' });
      execSync('git checkout -b feat/beta', { cwd: projectBDir, stdio: 'ignore' });
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

    // Cleanup projects
    fs.rmSync(projectADir, { recursive: true, force: true });
    fs.rmSync(projectBDir, { recursive: true, force: true });
  });

  /**
   * @behavior Status line reads git branch from workspace.current_dir in stdin
   * @acceptance-criteria When script runs from Project B but stdin says Project A,
   *                      status line shows Project A's branch (feat/alpha)
   */
  it('should read git branch from workspace.current_dir, not script CWD', () => {
    // GIVEN: Script is invoked from Project B (CWD = projectBDir)
    // AND: stdin says workspace.current_dir is Project A

    // Set current-project to Project B (simulating another session)
    fs.writeFileSync(currentProjectFile, projectBDir);

    const input = JSON.stringify({
      model: { display_name: 'Claude' },
      workspace: { current_dir: projectADir }  // Truth for THIS session
    });

    let output = '';
    try {
      output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: projectBDir,  // Running from Project B!
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      output = execError.stdout || '';
    }

    // THEN: Output should show feat/alpha (Project A's branch)
    // NOT feat/beta (Project B's branch from CWD)
    expect(output).toContain('feat/alpha');
    expect(output).not.toContain('feat/beta');
  });

  /**
   * @behavior Git branch uses git -C for project directory
   * @acceptance-criteria Correct branch shown even when script cwd differs from project
   */
  it('should use git -C to read branch from correct project', () => {
    // GIVEN: stdin says workspace.current_dir is Project A
    const input = JSON.stringify({
      model: { display_name: 'Claude' },
      workspace: { current_dir: projectADir }
    });

    // Running from a directory with no git repo (home)
    let output = '';
    try {
      output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: os.homedir(),  // Running from home, NOT project!
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      output = execError.stdout || '';
    }

    // THEN: Output should show feat/alpha (from Project A via git -C)
    expect(output).toContain('feat/alpha');
  });

  /**
   * @behavior Status line shows branch indicator emoji
   * @acceptance-criteria Branch is prefixed with 🌿
   */
  it('should show branch with 🌿 prefix', () => {
    const input = JSON.stringify({
      model: { display_name: 'Claude' },
      workspace: { current_dir: projectADir }
    });

    let output = '';
    try {
      output = execSync(`echo '${input}' | bash "${statuslineScript}"`, {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: projectADir,
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      output = execError.stdout || '';
    }

    // THEN: Branch should be prefixed with 🌿
    expect(output).toContain('🌿 feat/alpha');
  });
});
