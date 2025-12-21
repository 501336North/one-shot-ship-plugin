/**
 * @behavior Verify status line system is working
 * @acceptance-criteria HC-007
 * @business-rule HEALTH-007
 * @boundary Healthcheck
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkNotifications } from '../../src/healthchecks/notifications.js';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

describe('StatusLineHealthCheck', () => {
  const home = homedir();
  const statusLineScript = join(home, '.oss', 'oss-statusline.sh');
  const ossDir = join(home, '.oss');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass when workflow state updates were recent', async () => {
    // GIVEN - Status line script exists and log file shows recent workflow update
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const logContent = `[${fiveMinutesAgo}] [build] [start] {"totalTasks": 5}\n`;
    vi.mocked(fs.readFile).mockResolvedValue(logContent);
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
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
    vi.mocked(fs.readFile).mockResolvedValue(logContent);
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // WHEN - Check status line during active session
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
      sessionActive: true,
    });

    // THEN - Should warn about stale state
    expect(result.status).toBe('warn');
    expect(result.message).toContain('No workflow state updates recently');
    expect(result.details?.lastStateUpdateAge).toBeGreaterThan(30 * 60 * 1000);
  });

  it('should verify status line script is available', async () => {
    // GIVEN - Status line script exists
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
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
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(exec).mockImplementation((cmd, callback: unknown) => {
      (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout: '[Claude] project | main | ✅',
        stderr: '',
      });
      return {} as ReturnType<typeof exec>;
    });

    // WHEN - Check status line with test flag
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
      testStatusLine: true,
    });

    // THEN - Should verify status line output
    expect(result.details?.pingSuccess).toBe(true);
    expect(result.details?.statusLineOutput).toContain('[Claude]');
  });

  it('should fail when status line system is not available', async () => {
    // GIVEN - Status line script doesn't exist and .oss dir doesn't exist
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
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
    vi.mocked(fs.readFile).mockResolvedValue(logContent);
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // WHEN - Check status line with inactive session
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
      sessionActive: false,
    });

    // THEN - Should pass (no expectation for inactive sessions)
    expect(result.status).toBe('pass');
  });

  it('should handle log read errors gracefully', async () => {
    // GIVEN - Log file read throws error
    vi.mocked(fs.readFile).mockRejectedValue(new Error('Failed to read log'));
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
    });

    // THEN - Should warn about log read failure
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Could not read workflow logs');
  });

  it('should support legacy NOTIFICATION log format', async () => {
    // GIVEN - Log file has legacy notification format
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const logContent = `[${fiveMinutesAgo}] NOTIFICATION sent "Build started"\n`;
    vi.mocked(fs.readFile).mockResolvedValue(logContent);
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
    });

    // THEN - Should parse legacy format and pass
    expect(result.status).toBe('pass');
    expect(result.details?.lastStateUpdateAge).toBeLessThan(10 * 60 * 1000);
    // Legacy field should also be set
    expect(result.details?.lastNotificationAge).toBeLessThan(10 * 60 * 1000);
  });

  it('should pass when only workflow state directory is available', async () => {
    // GIVEN - Status line script doesn't exist but .oss dir does
    vi.mocked(fs.readFile).mockResolvedValue('');
    let accessCallCount = 0;
    vi.mocked(fs.access).mockImplementation(async (path) => {
      accessCallCount++;
      if (String(path).includes('oss-statusline.sh')) {
        throw new Error('ENOENT');
      }
      // .oss directory exists
      return undefined;
    });

    // WHEN - Check status line health
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
    });

    // THEN - Should pass because workflow state can still be written
    expect(result.status).toBe('pass');
    expect(result.details?.workflowStateWritable).toBe(true);
  });
});
