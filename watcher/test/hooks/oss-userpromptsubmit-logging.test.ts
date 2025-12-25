/**
 * @behavior UserPromptSubmit hooks log execution to session.log for supervisor visibility
 * @acceptance-criteria Supervisor can see all UserPromptSubmit hook lifecycle events
 * @business-rule Every hook execution must be visible in session.log
 * @boundary Shell scripts (oss-context-gate.sh, oss-precommand.sh, oss-iron-law-check.sh, oss-context-inject.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-context-gate.sh logging', () => {
  const ossContextGateScript = path.join(__dirname, '../../../hooks/oss-context-gate.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');
  const currentProjectFile = path.join(ossDir, 'current-project');

  let originalSessionLog: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    fs.mkdirSync(logsDir, { recursive: true });

    // Save and clear current-project to ensure global log path
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    fs.writeFileSync(currentProjectFile, '');

    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }
  });

  /**
   * @behavior oss-context-gate.sh logs hook execution
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START|COMPLETE] oss-context-gate
   */
  it('should log hook START and COMPLETE events', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // Run with non-major command to get a quick exit
    try {
      execSync(`echo '{"prompt": "/oss:status", "transcript_path": ""}' | bash "${ossContextGateScript}"`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        },
        timeout: 5000,
      });
    } catch {
      // May exit with error, but logging should still happen
    }

    const logContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[hook\].*oss-context-gate/);
  });
});

describe('oss-precommand.sh logging', () => {
  const ossPrecommandScript = path.join(__dirname, '../../../hooks/oss-precommand.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');
  const currentProjectFile = path.join(ossDir, 'current-project');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);

  let originalSessionLog: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    fs.mkdirSync(logsDir, { recursive: true });

    // Save and clear current-project to ensure global log path
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    fs.writeFileSync(currentProjectFile, '');

    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }
    fs.mkdirSync(testProjectDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior oss-precommand.sh logs hook execution
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START|COMPLETE] oss-precommand
   */
  it('should log hook START and COMPLETE events', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    try {
      execSync(`bash "${ossPrecommandScript}" --no-queue`, {
        encoding: 'utf-8',
        cwd: testProjectDir,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
          // Clear CLAUDE_PROJECT_DIR to ensure global log path for testing
          CLAUDE_PROJECT_DIR: '',
        },
        timeout: 5000,
      });
    } catch {
      // May exit with error
    }

    const logContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[hook\].*oss-precommand/);
  });
});

describe('oss-iron-law-check.sh logging', () => {
  const ossIronLawCheckScript = path.join(__dirname, '../../../hooks/oss-iron-law-check.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');
  const currentProjectFile = path.join(ossDir, 'current-project');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);

  let originalSessionLog: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    fs.mkdirSync(logsDir, { recursive: true });

    // Save and clear current-project to ensure global log path
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    fs.writeFileSync(currentProjectFile, '');

    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }
    // Create test project with git
    fs.mkdirSync(testProjectDir, { recursive: true });
    try {
      execSync('git init', { cwd: testProjectDir, encoding: 'utf-8' });
      execSync('git checkout -b test-branch', { cwd: testProjectDir, encoding: 'utf-8' });
    } catch {
      // Git may not be available
    }
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior oss-iron-law-check.sh logs hook execution
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START|COMPLETE] oss-iron-law-check
   */
  it('should log hook START and COMPLETE events', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    try {
      execSync(`bash "${ossIronLawCheckScript}"`, {
        encoding: 'utf-8',
        cwd: testProjectDir,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        },
        timeout: 5000,
      });
    } catch {
      // May exit with error
    }

    const logContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[hook\].*oss-iron-law-check/);
  });
});

describe('oss-context-inject.sh logging', () => {
  const ossContextInjectScript = path.join(__dirname, '../../../hooks/oss-context-inject.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');
  const currentProjectFile = path.join(ossDir, 'current-project');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);

  let originalSessionLog: string | null = null;
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    fs.mkdirSync(logsDir, { recursive: true });

    // Save and clear current-project to ensure global log path
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    fs.writeFileSync(currentProjectFile, '');

    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }
    // Create test project with git
    fs.mkdirSync(testProjectDir, { recursive: true });
    try {
      execSync('git init', { cwd: testProjectDir, encoding: 'utf-8' });
      execSync('git checkout -b test-branch', { cwd: testProjectDir, encoding: 'utf-8' });
    } catch {
      // Git may not be available
    }
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.writeFileSync(currentProjectFile, '');
    }

    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior oss-context-inject.sh logs hook execution
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START|COMPLETE] oss-context-inject
   */
  it('should log hook START and COMPLETE events', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    try {
      execSync(`bash "${ossContextInjectScript}"`, {
        encoding: 'utf-8',
        cwd: testProjectDir,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(__dirname, '../../..'),
        },
        timeout: 5000,
      });
    } catch {
      // May exit with error
    }

    const logContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[hook\].*oss-context-inject/);
  });
});
