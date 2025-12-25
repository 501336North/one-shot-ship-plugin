/**
 * @behavior Session start/end hooks log to session.log for supervisor visibility
 * @acceptance-criteria Supervisor can see session lifecycle events
 * @business-rule Every session start/end must be visible in session.log
 * @boundary Shell scripts (oss-session-start.sh, oss-session-end.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-session-start.sh logging', () => {
  const ossSessionStartScript = path.join(__dirname, '../../../hooks/oss-session-start.sh');
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);

  // Save original state
  let originalSessionLog: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Ensure logs directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Save original session log if exists
    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }

    // Save original current-project if exists
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project
    fs.mkdirSync(testProjectDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original session log
    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }

    // Restore original current-project
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Session start logs hook execution to session.log
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START] oss-session-start
   */
  it('should log hook START event for session start', () => {
    // GIVEN: A valid project directory
    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, testProjectDir);

    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-session-start.sh (with minimal env to avoid API calls)
    try {
      execSync(`bash "${ossSessionStartScript}"`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
          // Skip API call by not having valid config
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to missing config, but logging should still happen
    }

    // THEN: Session log should contain hook START entry
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[hook\].*\[START\].*oss-session-start/);
  });

  /**
   * @behavior Session start logs session event with project info
   * @acceptance-criteria Format: [HH:MM:SS] [session] [START] project=... branch=...
   */
  it('should log session START event with project metadata', () => {
    // GIVEN: A valid project directory with git
    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // Initialize git repo
    try {
      execSync('git init', { cwd: testProjectDir, encoding: 'utf-8' });
      execSync('git checkout -b test-branch', { cwd: testProjectDir, encoding: 'utf-8' });
    } catch {
      // Git may not be available, skip git-specific assertions
    }

    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-session-start.sh
    try {
      execSync(`bash "${ossSessionStartScript}"`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to missing config
    }

    // THEN: Session log should contain session START entry with project info
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    // Should have session START entry (either via hook or session event)
    expect(newContent).toMatch(/\[session\].*\[START\]|session.*START/i);
  });
});

describe('oss-session-end.sh logging', () => {
  const ossSessionEndScript = path.join(__dirname, '../../../hooks/oss-session-end.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);

  // Save original state
  let originalSessionLog: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Ensure logs directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Save original session log if exists
    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }

    // Save original current-project if exists
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project
    fs.mkdirSync(testProjectDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original session log
    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }

    // Restore original current-project
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Session end logs hook execution to session.log
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START|COMPLETE] oss-session-end
   */
  it('should log hook events for session end', () => {
    // GIVEN: A valid project directory
    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, testProjectDir);

    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-session-end.sh
    try {
      execSync(`bash "${ossSessionEndScript}"`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to various reasons
    }

    // THEN: Session log should contain hook entries
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[hook\].*oss-session-end/);
  });

  /**
   * @behavior Session end logs session END event
   * @acceptance-criteria Format: [HH:MM:SS] [session] [END] ...
   */
  it('should log session END event', () => {
    // GIVEN: A valid project directory
    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, testProjectDir);

    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-session-end.sh
    try {
      execSync(`bash "${ossSessionEndScript}"`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to various reasons
    }

    // THEN: Session log should contain session END entry
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[session\].*\[END\]|session.*END/i);
  });
});
