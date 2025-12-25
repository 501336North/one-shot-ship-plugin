/**
 * @behavior oss-log.sh milestone and skill actions log to session.log
 * @acceptance-criteria Supervisor can see milestone and skill execution events
 * @business-rule Every command milestone and skill execution must be visible in session.log
 * @boundary Shell script (oss-log.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh milestone action', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
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
   * @behavior milestone action logs with command and description
   * @acceptance-criteria Format: [HH:MM:SS] [command] [MILESTONE] name: description
   */
  it('should log milestone with command and description', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" milestone plan archive_check "Checked for features to archive"`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
      },
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[plan\] \[MILESTONE\] archive_check: Checked for features to archive/);
  });

  /**
   * @behavior milestone action requires command argument
   * @acceptance-criteria Command fails with usage message if command missing
   */
  it('should show usage error when command is missing', () => {
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" milestone`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
        },
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    expect(errorOutput).toContain('Usage:');
    expect(errorOutput).toContain('milestone');
  });

  /**
   * @behavior milestone action requires name argument
   * @acceptance-criteria Command fails with usage message if name missing
   */
  it('should show usage error when name is missing', () => {
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" milestone plan`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
        },
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    expect(errorOutput).toContain('Usage:');
  });
});

describe('oss-log.sh skill action', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
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
   * @behavior skill action logs START event with args
   * @acceptance-criteria Format: [HH:MM:SS] [skill] [START] skill_name args=...
   */
  it('should log skill START event with args', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" skill create-dev-docs START "feature=auth-module"`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
      },
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[skill\] \[START\] create-dev-docs feature=auth-module/);
  });

  /**
   * @behavior skill action logs COMPLETE event
   * @acceptance-criteria Format: [HH:MM:SS] [skill] [COMPLETE] skill_name result=...
   */
  it('should log skill COMPLETE event', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" skill create-dev-docs COMPLETE "files_created=3"`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
      },
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[skill\] \[COMPLETE\] create-dev-docs files_created=3/);
  });

  /**
   * @behavior skill action logs FAILED event
   * @acceptance-criteria Format: [HH:MM:SS] [skill] [FAILED] skill_name error=...
   */
  it('should log skill FAILED event', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" skill build FAILED "Test compilation failed"`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
      },
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[skill\] \[FAILED\] build Test compilation failed/);
  });

  /**
   * @behavior skill action requires skill_name argument
   * @acceptance-criteria Command fails with usage message if skill_name missing
   */
  it('should show usage error when skill_name is missing', () => {
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" skill`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
        },
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    expect(errorOutput).toContain('Usage:');
    expect(errorOutput).toContain('skill');
  });

  /**
   * @behavior skill action requires event argument
   * @acceptance-criteria Command fails with usage message if event missing
   */
  it('should show usage error when event is missing', () => {
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" skill create-dev-docs`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: '', // Clear to ensure global log path
        },
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    expect(errorOutput).toContain('Usage:');
  });
});
