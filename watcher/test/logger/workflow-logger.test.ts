/**
 * WorkflowLogger Tests - IRON_LAW_CHECK Event Type (RED Phase)
 *
 * @behavior Logger should track IRON LAW pre-checks
 * @acceptance-criteria
 *   - IRON_LAW_CHECK added to WorkflowEvent type
 *   - Logger accepts IRON_LAW_CHECK entries with violations data
 *   - Human summary shows PRE-CHECK PASSED/FAILED status
 * @boundary Logger API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger, WorkflowEvent } from '../../src/logger/workflow-logger';

describe('WorkflowLogger - IRON_LAW_CHECK', () => {
  let tmpDir: string;
  let logger: WorkflowLogger;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-logger-test-'));
    logPath = path.join(tmpDir, 'workflow.log');
    logger = new WorkflowLogger(tmpDir);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior IRON_LAW_CHECK should be a valid WorkflowEvent type
   * @acceptance-criteria Type system should accept IRON_LAW_CHECK
   */
  it('WorkflowEvent should include IRON_LAW_CHECK', () => {
    // GIVEN - WorkflowEvent type is defined
    // WHEN - We assign IRON_LAW_CHECK to a WorkflowEvent variable
    const event: WorkflowEvent = 'IRON_LAW_CHECK';

    // THEN - TypeScript should accept this without error
    expect(event).toBe('IRON_LAW_CHECK');
  });

  /**
   * @behavior Logger should accept IRON_LAW_CHECK entries with violations data
   * @acceptance-criteria Entry is logged with violations array
   */
  it('should log IRON_LAW_CHECK entry with violations', async () => {
    // GIVEN - Logger is initialized
    // WHEN - We log an IRON_LAW_CHECK entry with violations
    await logger.log({
      cmd: 'build',
      event: 'IRON_LAW_CHECK',
      data: {
        passed: false,
        violations: [
          { law: 4, message: 'On main branch' }
        ]
      }
    });

    // THEN - Log file should contain the entry
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    // First line is JSON
    const jsonLine = JSON.parse(lines[0]);
    expect(jsonLine.event).toBe('IRON_LAW_CHECK');
    expect(jsonLine.data.passed).toBe(false);
    expect(jsonLine.data.violations).toHaveLength(1);
    expect(jsonLine.data.violations[0].law).toBe(4);
  });

  /**
   * @behavior Human summary should show PRE-CHECK FAILED status
   * @acceptance-criteria Summary line shows violation count
   */
  it('should format IRON_LAW_CHECK human summary with FAILED status', async () => {
    // GIVEN - Logger is initialized
    // WHEN - We log an IRON_LAW_CHECK entry with violations
    await logger.log({
      cmd: 'build',
      event: 'IRON_LAW_CHECK',
      data: {
        passed: false,
        violations: [
          { law: 4, message: 'On main branch' },
          { law: 6, message: 'Dev docs stale' }
        ]
      }
    });

    // THEN - Human summary should show FAILED with violation count
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    // Second line is human summary
    const humanLine = lines[1];
    expect(humanLine).toContain('BUILD:IRON_LAW_CHECK');
    expect(humanLine).toContain('PRE-CHECK FAILED');
    expect(humanLine).toContain('2 violation(s)');
  });

  /**
   * @behavior Human summary should show PRE-CHECK PASSED status
   * @acceptance-criteria Summary line shows PASSED when no violations
   */
  it('should format IRON_LAW_CHECK human summary with PASSED status', async () => {
    // GIVEN - Logger is initialized
    // WHEN - We log an IRON_LAW_CHECK entry with no violations
    await logger.log({
      cmd: 'build',
      event: 'IRON_LAW_CHECK',
      data: {
        passed: true,
        violations: []
      }
    });

    // THEN - Human summary should show PASSED
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    // Second line is human summary
    const humanLine = lines[1];
    expect(humanLine).toContain('BUILD:IRON_LAW_CHECK');
    expect(humanLine).toContain('PRE-CHECK PASSED');
    expect(humanLine).not.toContain('violation');
  });
});
