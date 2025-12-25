/**
 * @behavior oss-log.sh hook action logs hook execution to session log
 * @acceptance-criteria Supervisor can see all hook START/COMPLETE/FAILED events
 * @business-rule Every hook execution must be visible in session.log
 * @boundary Shell script (oss-log.sh hook)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh hook action', () => {
  const ossLogScript = path.join(__dirname, '../../../hooks/oss-log.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const logsDir = path.join(ossDir, 'logs', 'current-session');
  const sessionLog = path.join(logsDir, 'session.log');

  // Save original session log content
  let originalSessionLog: string | null = null;

  beforeEach(() => {
    // Ensure logs directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Save original session log if exists
    if (fs.existsSync(sessionLog)) {
      originalSessionLog = fs.readFileSync(sessionLog, 'utf-8');
    }
  });

  afterEach(() => {
    // Restore original session log
    if (originalSessionLog !== null) {
      fs.writeFileSync(sessionLog, originalSessionLog);
    }
  });

  /**
   * @behavior hook action with START event logs correctly
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [START] hook_name
   */
  it('should log hook START event to session log', () => {
    // GIVEN: A session log file
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-log.sh hook SessionStart START
    execSync(`bash "${ossLogScript}" hook SessionStart START`, {
      encoding: 'utf-8',
    });

    // THEN: Session log should contain the hook START entry
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    // Should have format: [HH:MM:SS] [hook] [START] SessionStart
    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[hook\] \[START\] SessionStart/);
  });

  /**
   * @behavior hook action with COMPLETE event logs correctly
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [COMPLETE] hook_name
   */
  it('should log hook COMPLETE event to session log', () => {
    // GIVEN: A session log file
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-log.sh hook oss-precommand COMPLETE
    execSync(`bash "${ossLogScript}" hook oss-precommand COMPLETE`, {
      encoding: 'utf-8',
    });

    // THEN: Session log should contain the hook COMPLETE entry
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[hook\] \[COMPLETE\] oss-precommand/);
  });

  /**
   * @behavior hook action with FAILED event logs correctly
   * @acceptance-criteria Format: [HH:MM:SS] [hook] [FAILED] hook_name reason
   */
  it('should log hook FAILED event with reason to session log', () => {
    // GIVEN: A session log file
    const initialContent = fs.existsSync(sessionLog)
      ? fs.readFileSync(sessionLog, 'utf-8')
      : '';

    // WHEN: Running oss-log.sh hook oss-iron-law-check FAILED "Violation detected"
    execSync(`bash "${ossLogScript}" hook oss-iron-law-check FAILED "Violation detected"`, {
      encoding: 'utf-8',
    });

    // THEN: Session log should contain the hook FAILED entry with reason
    const logContent = fs.readFileSync(sessionLog, 'utf-8');
    const newContent = logContent.slice(initialContent.length);

    expect(newContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[hook\] \[FAILED\] oss-iron-law-check Violation detected/);
  });

  /**
   * @behavior hook action requires hook_name argument
   * @acceptance-criteria Command fails with usage message if hook_name missing
   */
  it('should show usage error when hook_name is missing', () => {
    // GIVEN: No hook_name provided

    // WHEN: Running oss-log.sh hook (without arguments)
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" hook`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    // THEN: Should show usage error
    expect(errorOutput).toContain('Usage:');
    expect(errorOutput).toContain('hook');
  });

  /**
   * @behavior hook action requires event argument
   * @acceptance-criteria Command fails with usage message if event missing
   */
  it('should show usage error when event is missing', () => {
    // GIVEN: No event provided

    // WHEN: Running oss-log.sh hook SessionStart (without event)
    let errorOutput = '';
    try {
      execSync(`bash "${ossLogScript}" hook SessionStart`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const execError = error as { stderr?: string };
      errorOutput = execError.stderr || '';
    }

    // THEN: Should show usage error
    expect(errorOutput).toContain('Usage:');
  });
});
