/**
 * @behavior Verify status line system is working
 * @acceptance-criteria HC-007
 * @business-rule HEALTH-007
 * @boundary Healthcheck
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkNotifications } from '../../src/healthchecks/notifications.js';
import { exec } from 'child_process';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

describe('StatusLineHealthCheck', () => {
  let home: string;
  let logPath: string;
  const savedHome = process.env.HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    // a real home of its own: ~/.oss, the status line script and the log are real files (or absent)
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-notifications-check-'));
    process.env.HOME = home;
    logPath = path.join(home, 'watcher.log');
  });

  afterEach(() => {
    process.env.HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** ~/.oss exists (workflow state can be written there). */
  function ossDir(): void {
    fs.mkdirSync(path.join(home, '.oss'), { recursive: true });
  }

  /** ~/.oss/oss-statusline.sh exists (and so does ~/.oss). */
  function statusLineScript(): void {
    ossDir();
    fs.writeFileSync(path.join(home, '.oss', 'oss-statusline.sh'), '#!/bin/bash\n');
  }

  /** The watcher log, with this text. */
  function writeLog(text: string): void {
    fs.writeFileSync(logPath, text);
  }

  it('should pass when workflow state updates were recent', async () => {
    // GIVEN - Status line script exists and log file shows recent workflow update
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const logContent = `[${fiveMinutesAgo}] [build] [start] {"totalTasks": 5}\n`;
    writeLog(logContent);
    statusLineScript();

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath,
    });

    // THEN - Should pass with recent state update
    expect(result.status).toBe('pass');
    expect(result.message).toContain('healthy');
    expect(result.details?.lastStateUpdateAge).toBeLessThan(10 * 60 * 1000);
  });

  it('should warn when no state updates in last 30 min during active work', async () => {
    // GIVEN - Log file shows old workflow update
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const logContent = `[${oneHourAgo}] [plan] [complete] {"taskCount": 10}\n`;
    writeLog(logContent);
    statusLineScript();

    // WHEN - Check status line during active session
    const result = await checkNotifications({
      logPath,
      sessionActive: true,
    });

    // THEN - Should warn about stale state
    expect(result.status).toBe('warn');
    expect(result.message).toContain('No workflow state updates recently');
    expect(result.details?.lastStateUpdateAge).toBeGreaterThan(30 * 60 * 1000);
  });

  it('should verify status line script is available', async () => {
    // GIVEN - Status line script exists
    writeLog('');
    statusLineScript();

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath,
    });

    // THEN - Should detect status line availability
    expect(result.details?.statusLineAvailable).toBe(true);
    expect(result.details?.statusLinePath).toContain('oss-statusline.sh');
    // Legacy compatibility
    expect(result.details?.notifierAvailable).toBe(true);
    expect(result.details?.notifierPath).toContain('oss-statusline.sh');
  });

  it('should test status line output with testStatusLine flag', async () => {
    // GIVEN - Status line script exists and can be executed
    writeLog('');
    statusLineScript();
    vi.mocked(exec).mockImplementation((cmd, callback: unknown) => {
      (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout: '[Claude] project | main | ✅',
        stderr: '',
      });
      return {} as ReturnType<typeof exec>;
    });

    // WHEN - Check status line with test flag
    const result = await checkNotifications({
      logPath,
      testStatusLine: true,
    });

    // THEN - Should verify status line output
    expect(result.details?.pingSuccess).toBe(true);
    expect(result.details?.statusLineOutput).toContain('[Claude]');
  });

  it('should fail when status line system is not available', async () => {
    // GIVEN - Status line script doesn't exist and .oss dir doesn't exist
    writeLog('');
    // (neither ~/.oss nor the script exists)

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath,
    });

    // THEN - Should fail with status line unavailable
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not available');
    expect(result.details?.notifierAvailable).toBe(false);
  });

  it('should pass when no recent updates but session is inactive', async () => {
    // GIVEN - Old workflow update but inactive session
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const logContent = `[${oneHourAgo}] [ship] [merged] {}\n`;
    writeLog(logContent);
    statusLineScript();

    // WHEN - Check status line with inactive session
    const result = await checkNotifications({
      logPath,
      sessionActive: false,
    });

    // THEN - Should pass (no expectation for inactive sessions)
    expect(result.status).toBe('pass');
  });

  it('should handle log read errors gracefully', async () => {
    // GIVEN - Log file cannot be read (it is not there)
    statusLineScript();

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath,
    });

    // THEN - Should warn about log read failure
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Could not read workflow logs');
  });

  it('should support legacy NOTIFICATION log format', async () => {
    // GIVEN - Log file has legacy notification format
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const logContent = `[${fiveMinutesAgo}] NOTIFICATION sent "Build started"\n`;
    writeLog(logContent);
    statusLineScript();

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath,
    });

    // THEN - Should parse legacy format and pass
    expect(result.status).toBe('pass');
    expect(result.details?.lastStateUpdateAge).toBeLessThan(10 * 60 * 1000);
    // Legacy field should also be set
    expect(result.details?.lastNotificationAge).toBeLessThan(10 * 60 * 1000);
  });

  it('should pass when only workflow state directory is available', async () => {
    // GIVEN - Status line script doesn't exist but .oss dir does
    writeLog('');
    ossDir();

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath,
    });

    // THEN - Should pass because workflow state can still be written
    expect(result.status).toBe('pass');
    expect(result.details?.workflowStateWritable).toBe(true);
  });
});
