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
  // Use unique test ID to avoid parallel test pollution
  const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const testProjectDir = path.join(os.tmpdir(), `oss-session-logging-${testId}`);

  // Save original state
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Ensure logs directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Save original current-project if exists
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project with unique name
    fs.mkdirSync(testProjectDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original current-project
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else {
      // Clear it if it didn't exist before
      try { fs.unlinkSync(currentProjectFile); } catch { /* ignore */ }
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
    // GIVEN: Clear current-project to ensure global log path for testing
    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, '');

    // Add a unique marker before running the script to detect new content reliably
    const marker = `[TEST-MARKER-START-${testId}]`;
    fs.appendFileSync(sessionLog, `\n${marker}\n`);

    // WHEN: Running oss-session-start.sh (with minimal env to avoid API calls)
    try {
      execSync(`bash "${ossSessionStartScript}"`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          // Clear CLAUDE_PROJECT_DIR to ensure global log path for testing
          CLAUDE_PROJECT_DIR: '',
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
          OSS_SKIP_WATCHER: '1', // Prevent watcher from spawning during tests
          // Skip API call by not having valid config
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to missing config, but logging should still happen
    }

    // THEN: Session log should contain hook START entry after our marker
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const markerIndex = logContent.lastIndexOf(marker);
    const newContent = markerIndex >= 0 ? logContent.slice(markerIndex + marker.length) : logContent;

    expect(newContent).toMatch(/\[hook\].*\[START\].*oss-session-start/);
  });

  /**
   * @behavior Session start logs session event with project info
   * @acceptance-criteria Format: [HH:MM:SS] [session] [START] project=... branch=...
   */
  it('should log session START event with project metadata', () => {
    // GIVEN: A valid project directory with git
    // Create project .oss directory for project-local logs
    const projectOssDir = path.join(testProjectDir, '.oss', 'logs', 'current-session');
    fs.mkdirSync(projectOssDir, { recursive: true });

    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // Initialize git repo
    try {
      execSync('git init', { cwd: testProjectDir, encoding: 'utf-8' });
      execSync('git checkout -b test-branch', { cwd: testProjectDir, encoding: 'utf-8' });
    } catch {
      // Git may not be available, skip git-specific assertions
    }

    // Extract just the directory name for matching (script uses basename)
    const projectDirName = path.basename(testProjectDir);

    // WHEN: Running oss-session-start.sh
    try {
      execSync(`bash "${ossSessionStartScript}"`, {
        encoding: 'utf-8',
        cwd: testProjectDir, // Run from project dir for consistent behavior
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
          OSS_SKIP_WATCHER: '1', // Prevent watcher from spawning during tests
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to missing config
    }

    // THEN: Session log should contain session START entry with our project name
    // The [session] [START] is written directly to global log by oss-session-start.sh
    const logContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // Look for [session] [START] with our specific project directory name
    const expectedPattern = new RegExp(`\\[session\\].*\\[START\\].*project=${projectDirName}`);
    expect(logContent).toMatch(expectedPattern);
  });
});

describe('oss-session-end.sh logging', () => {
  const ossSessionEndScript = path.join(__dirname, '../../../hooks/oss-session-end.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');
  // Use unique test ID to avoid parallel test pollution
  const testId = `test-end-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const testProjectDir = path.join(os.tmpdir(), `oss-session-end-${testId}`);

  // Save original state
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Ensure logs directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Save original current-project if exists
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project
    fs.mkdirSync(testProjectDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original current-project
    const currentProjectFile = path.join(ossDir, 'current-project');
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else {
      try { fs.unlinkSync(currentProjectFile); } catch { /* ignore */ }
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
    // GIVEN: Clear current-project to ensure global log path for testing
    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, '');

    // Initialize git repo (required - oss-session-end.sh exits early without git)
    try {
      execSync('git init', { cwd: testProjectDir, encoding: 'utf-8' });
    } catch {
      // Git may not be available
    }

    // Add a unique marker before running the script
    const marker = `[TEST-MARKER-END-HOOK-${testId}]`;
    fs.appendFileSync(sessionLog, `\n${marker}\n`);

    // WHEN: Running oss-session-end.sh (must run from git repo)
    try {
      execSync(`bash "${ossSessionEndScript}"`, {
        encoding: 'utf-8',
        cwd: testProjectDir, // Run from project dir so git commands work
        env: {
          ...process.env,
          // Clear CLAUDE_PROJECT_DIR to ensure global log path for testing
          CLAUDE_PROJECT_DIR: '',
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
          OSS_SKIP_WATCHER: '1', // Prevent watcher from spawning during tests
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to various reasons
    }

    // THEN: Session log should contain hook entries after marker
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const markerIndex = logContent.lastIndexOf(marker);
    const newContent = markerIndex >= 0 ? logContent.slice(markerIndex + marker.length) : logContent;

    expect(newContent).toMatch(/\[hook\].*oss-session-end/);
  });

  /**
   * @behavior Session end logs session END event
   * @acceptance-criteria Format: [HH:MM:SS] [session] [END] ...
   */
  it('should log session END event', () => {
    // GIVEN: A valid project directory with git (session-end.sh requires git repo)
    const currentProjectFile = path.join(ossDir, 'current-project');
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // Initialize git repo (required - oss-session-end.sh exits early without git)
    try {
      execSync('git init', { cwd: testProjectDir, encoding: 'utf-8' });
    } catch {
      // Git may not be available
    }

    // Extract just the directory name for matching (script uses basename)
    const projectDirName = path.basename(testProjectDir);

    // WHEN: Running oss-session-end.sh (must run from git repo)
    try {
      execSync(`bash "${ossSessionEndScript}"`, {
        encoding: 'utf-8',
        cwd: testProjectDir, // Run from project dir so git commands work
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: testProjectDir,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
          OSS_SKIP_WATCHER: '1', // Prevent watcher from spawning during tests
        },
        timeout: 10000,
      });
    } catch {
      // May fail due to various reasons
    }

    // THEN: Session log should contain session END entry with our project name
    // Use project name matching instead of markers for reliable test isolation
    const logContent = fs.readFileSync(sessionLog, 'utf-8');

    // Look for [session] [END] with our specific project directory name
    const expectedPattern = new RegExp(`\\[session\\].*\\[END\\].*project=${projectDirName}`);
    expect(logContent).toMatch(expectedPattern);
  });
});
