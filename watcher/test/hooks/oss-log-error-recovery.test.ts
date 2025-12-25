/**
 * @behavior oss-log.sh recovery and timeout actions log to session.log
 * @acceptance-criteria Supervisor can see error recovery and timeout events
 * @business-rule Every error recovery attempt and timeout must be visible in session.log
 * @boundary Shell script (oss-log.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh recovery action', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');

  let originalSessionLog: string | null = null;

  beforeEach(() => {
    fs.mkdirSync(logsDir, { recursive: true });
    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }
  });

  afterEach(() => {
    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }
  });

  /**
   * @behavior recovery action logs with command and attempt details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [RECOVERY] message details
   */
  it('should log recovery attempt with command and details', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" recovery build "Retrying after error" "attempt=2"`, {
      encoding: 'utf-8',
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[build\] \[RECOVERY\] Retrying after error attempt=2/);
  });

  /**
   * @behavior recovery action logs without details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [RECOVERY] message
   */
  it('should log recovery attempt without details', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" recovery plan "Fallback to synchronous execution"`, {
      encoding: 'utf-8',
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[plan\] \[RECOVERY\] Fallback to synchronous execution/);
  });

  /**
   * @behavior recovery action requires command argument
   * @acceptance-criteria Command fails with usage message if command missing
   */
  it('should show usage error when command is missing', () => {
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" recovery`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    expect(errorOutput).toContain('Usage:');
    expect(errorOutput).toContain('recovery');
  });
});

describe('oss-log.sh timeout action', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');

  let originalSessionLog: string | null = null;

  beforeEach(() => {
    fs.mkdirSync(logsDir, { recursive: true });
    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }
  });

  afterEach(() => {
    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }
  });

  /**
   * @behavior timeout action logs with command and process details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [TIMEOUT] message details
   */
  it('should log timeout with command and details', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" timeout build "Process hung after 60s" "pid=12345"`, {
      encoding: 'utf-8',
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[build\] \[TIMEOUT\] Process hung after 60s pid=12345/);
  });

  /**
   * @behavior timeout action logs without details
   * @acceptance-criteria Format: [HH:MM:SS] [command] [TIMEOUT] message
   */
  it('should log timeout without details', () => {
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    execSync(`bash "${ossLogScript}" timeout ship "Test runner exceeded timeout"`, {
      encoding: 'utf-8',
    });

    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[ship\] \[TIMEOUT\] Test runner exceeded timeout/);
  });

  /**
   * @behavior timeout action requires command argument
   * @acceptance-criteria Command fails with usage message if command missing
   */
  it('should show usage error when command is missing', () => {
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" timeout`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    expect(errorOutput).toContain('Usage:');
    expect(errorOutput).toContain('timeout');
  });
});
