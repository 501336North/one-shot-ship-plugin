/**
 * @behavior oss-log.sh uses project-local paths when project context is available
 * @acceptance-criteria Logs are created in {project}/.oss/logs/ when project context exists
 * @business-rule Each project should have independent logs for supervisor isolation
 * @boundary Shell script (oss-log.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh project-local paths', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  // On macOS, realpath resolves /var/folders to /private/var/folders
  // The script uses realpath, so we need to check the resolved path
  const resolvedProjectDir = testProjectDir.startsWith('/var/')
    ? '/private' + testProjectDir
    : testProjectDir;
  const resolvedProjectLogsDir = path.join(resolvedProjectDir, '.oss', 'logs', 'current-session');
  const globalLogsDir = path.join(os.homedir(), '.oss', 'logs', 'current-session');
  const currentProjectFile = path.join(os.homedir(), '.oss', 'current-project');

  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Create test project directory with .oss structure
    fs.mkdirSync(projectOssDir, { recursive: true });

    // Save original current-project if exists
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Clear current-project to avoid interference from parallel tests
    // Tests will use CLAUDE_PROJECT_DIR env var instead
    fs.writeFileSync(currentProjectFile, '');
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior oss-log.sh init creates log in project-local directory
   * @acceptance-criteria Log file path returned points to project-local location
   */
  it('should create log file in project-local directory when project context exists', () => {
    // GIVEN: CLAUDE_PROJECT_DIR env var points to test project (file is cleared to avoid parallel test conflicts)

    // WHEN: Running oss-log.sh init with CLAUDE_PROJECT_DIR set
    const output = execSync(`bash "${ossLogScript}" init testcmd`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        CLAUDE_PROJECT_DIR: testProjectDir,
      },
    }).trim();

    // THEN: Log path should be in project-local directory
    // Note: realpath on macOS resolves /var/folders to /private/var/folders
    expect(output).toMatch(new RegExp(testProjectDir.replace('/var/', '/private/var/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|' + testProjectDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(output).toContain('.oss/logs/current-session/testcmd.log');
    expect(fs.existsSync(path.join(resolvedProjectLogsDir, 'testcmd.log'))).toBe(true);
  });

  /**
   * @behavior oss-log.sh writes to project-local session.log
   * @acceptance-criteria Unified session log is in project-local directory
   */
  it('should write to project-local session.log', () => {
    // GIVEN: CLAUDE_PROJECT_DIR env var points to test project

    // WHEN: Running oss-log.sh init and write
    execSync(`bash "${ossLogScript}" init testcmd`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        CLAUDE_PROJECT_DIR: testProjectDir,
      },
    });

    // THEN: session.log should exist in project-local directory (at resolved path)
    const projectSessionLog = path.join(resolvedProjectLogsDir, 'session.log');
    expect(fs.existsSync(projectSessionLog)).toBe(true);
    const content = fs.readFileSync(projectSessionLog, 'utf-8');
    expect(content).toContain('[INIT]');
  });

  /**
   * @behavior oss-log.sh falls back to global when no project context
   * @acceptance-criteria Without current-project file, uses ~/.oss/logs/
   */
  it('should fall back to global logs when no project context', () => {
    // GIVEN: No current-project file (empty it)
    fs.writeFileSync(currentProjectFile, '');

    // Save initial state of global logs
    const globalSessionLog = path.join(globalLogsDir, 'session.log');
    const initialGlobalContent = fs.existsSync(globalSessionLog)
      ? fs.readFileSync(globalSessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-log.sh init
    const output = execSync(`bash "${ossLogScript}" init fallbacktest`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        // Explicitly unset CLAUDE_PROJECT_DIR
        CLAUDE_PROJECT_DIR: '',
      },
    }).trim();

    // THEN: Log path should be in global directory
    expect(output).toContain(os.homedir());
    expect(output).toContain('.oss/logs/current-session/fallbacktest.log');

    // Check that global session.log was updated
    const finalGlobalContent = fs.readFileSync(globalSessionLog, 'utf-8');
    const newContent = finalGlobalContent.slice(initialGlobalContent.length);
    expect(newContent).toContain('fallbacktest');
  });

  /**
   * @behavior oss-log.sh uses CLAUDE_PROJECT_DIR when current-project not available
   * @acceptance-criteria CLAUDE_PROJECT_DIR env var is used as fallback
   */
  it('should use CLAUDE_PROJECT_DIR when current-project file is empty', () => {
    // GIVEN: current-project file is empty but CLAUDE_PROJECT_DIR is set
    // (already cleared in beforeEach)

    // WHEN: Running oss-log.sh init with CLAUDE_PROJECT_DIR set
    const output = execSync(`bash "${ossLogScript}" init envtest`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        CLAUDE_PROJECT_DIR: testProjectDir,
      },
    }).trim();

    // THEN: Log path should be in project-local directory (from env var)
    // Note: realpath on macOS resolves /var/folders to /private/var/folders
    expect(output).toMatch(new RegExp(testProjectDir.replace('/var/', '/private/var/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|' + testProjectDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(output).toContain('.oss/logs/current-session/envtest.log');
  });
});

describe('oss-log.sh multi-project isolation', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
  const testProjectA = path.join(os.tmpdir(), `oss-test-project-A-${Date.now()}`);
  const testProjectB = path.join(os.tmpdir(), `oss-test-project-B-${Date.now()}`);
  // On macOS, realpath resolves /var/folders to /private/var/folders
  const resolvedProjectA = testProjectA.startsWith('/var/') ? '/private' + testProjectA : testProjectA;
  const resolvedProjectB = testProjectB.startsWith('/var/') ? '/private' + testProjectB : testProjectB;
  const currentProjectFile = path.join(os.homedir(), '.oss', 'current-project');

  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Create both test project directories
    fs.mkdirSync(path.join(testProjectA, '.oss'), { recursive: true });
    fs.mkdirSync(path.join(testProjectB, '.oss'), { recursive: true });

    // Save original current-project if exists
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Clear current-project to avoid interference from parallel tests
    // Tests will use CLAUDE_PROJECT_DIR env var instead
    fs.writeFileSync(currentProjectFile, '');
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    // Clean up test projects
    if (fs.existsSync(testProjectA)) {
      fs.rmSync(testProjectA, { recursive: true, force: true });
    }
    if (fs.existsSync(testProjectB)) {
      fs.rmSync(testProjectB, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Two projects maintain completely separate logs
   * @acceptance-criteria Project A's logs are independent from Project B's logs
   */
  it('should maintain separate logs for different projects', () => {
    // GIVEN: Two separate project directories

    // WHEN: Logging to project A (using CLAUDE_PROJECT_DIR env var to avoid parallel test conflicts)
    execSync(`bash "${ossLogScript}" init projectA_cmd`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        CLAUDE_PROJECT_DIR: testProjectA,
      },
    });

    // AND: Logging to project B
    execSync(`bash "${ossLogScript}" init projectB_cmd`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        CLAUDE_PROJECT_DIR: testProjectB,
      },
    });

    // THEN: Each project has its own independent logs (at resolved paths)
    const projectALog = path.join(resolvedProjectA, '.oss', 'logs', 'current-session', 'session.log');
    const projectBLog = path.join(resolvedProjectB, '.oss', 'logs', 'current-session', 'session.log');

    expect(fs.existsSync(projectALog)).toBe(true);
    expect(fs.existsSync(projectBLog)).toBe(true);

    const projectAContent = fs.readFileSync(projectALog, 'utf-8');
    const projectBContent = fs.readFileSync(projectBLog, 'utf-8');

    // Project A should only have projectA_cmd
    expect(projectAContent).toContain('projectA_cmd');
    expect(projectAContent).not.toContain('projectB_cmd');

    // Project B should only have projectB_cmd
    expect(projectBContent).toContain('projectB_cmd');
    expect(projectBContent).not.toContain('projectA_cmd');
  });
});
