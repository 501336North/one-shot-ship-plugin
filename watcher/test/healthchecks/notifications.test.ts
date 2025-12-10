/**
 * @behavior Verify notification system is working
 * @acceptance-criteria HC-007
 * @business-rule HEALTH-007
 * @boundary Healthcheck
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkNotifications } from '../../src/healthchecks/notifications.js';
import { exec } from 'child_process';
import { promises as fs } from 'fs';

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
    },
  };
});

describe('NotificationsHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass when notifications were sent recently', async () => {
    // GIVEN - Mock log file returns recent notification
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const logContent = `[${fiveMinutesAgo}] NOTIFICATION sent "Build started"\n`;
    vi.mocked(fs.readFile).mockResolvedValue(logContent);

    vi.mocked(exec).mockImplementation((cmd, callback: any) => {
      callback(null, { stdout: '/usr/local/bin/terminal-notifier', stderr: '' });
      return {} as any;
    });

    // WHEN - Check notifications health
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
    });

    // THEN - Should pass with recent notification
    expect(result.status).toBe('pass');
    expect(result.message).toContain('healthy');
    expect(result.details?.lastNotificationAge).toBeLessThan(10 * 60 * 1000);
  });

  it('should warn when no notifications in last 30 min during active work', async () => {
    // GIVEN - Mock log file returns old notification
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const logContent = `[${oneHourAgo}] NOTIFICATION sent "Old notification"\n`;
    vi.mocked(fs.readFile).mockResolvedValue(logContent);

    vi.mocked(exec).mockImplementation((cmd, callback: any) => {
      callback(null, { stdout: '/usr/local/bin/terminal-notifier', stderr: '' });
      return {} as any;
    });

    // WHEN - Check notifications during active session
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
      sessionActive: true,
    });

    // THEN - Should warn about stale notifications
    expect(result.status).toBe('warn');
    expect(result.message).toContain('No notifications sent recently');
    expect(result.details?.lastNotificationAge).toBeGreaterThan(30 * 60 * 1000);
  });

  it('should verify notification app is available', async () => {
    // GIVEN - Mock which command returns notifier path
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(exec).mockImplementation((cmd, callback: any) => {
      callback(null, { stdout: '/usr/local/bin/terminal-notifier', stderr: '' });
      return {} as any;
    });

    // WHEN - Check notifications
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
    });

    // THEN - Should detect notifier availability
    expect(result.details?.notifierAvailable).toBe(true);
    expect(result.details?.notifierPath).toContain('terminal-notifier');
  });

  it('should test notification pathway with silent ping', async () => {
    // GIVEN - Mock successful notification send
    vi.mocked(fs.readFile).mockResolvedValue('');
    let execCallCount = 0;
    vi.mocked(exec).mockImplementation((cmd, callback: any) => {
      execCallCount++;
      if (execCallCount === 1) {
        // First call: which terminal-notifier
        callback(null, { stdout: '/usr/local/bin/terminal-notifier', stderr: '' });
      } else {
        // Second call: send test notification
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as any;
    });

    // WHEN - Check notifications with test ping
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
      testPing: true,
    });

    // THEN - Should verify ping success
    expect(result.details?.pingSuccess).toBe(true);
  });

  it('should fail when notification app is not installed', async () => {
    // GIVEN - Mock which command fails (notifier not found)
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(exec).mockImplementation((cmd, callback: any) => {
      callback(new Error('Command not found'), { stdout: '', stderr: 'not found' });
      return {} as any;
    });

    // WHEN - Check notifications
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
    });

    // THEN - Should fail with notifier unavailable
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not available');
    expect(result.details?.notifierAvailable).toBe(false);
  });

  it('should pass when no recent notifications but session is inactive', async () => {
    // GIVEN - Mock old notification but inactive session
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const logContent = `[${oneHourAgo}] NOTIFICATION sent "Old notification"\n`;
    vi.mocked(fs.readFile).mockResolvedValue(logContent);

    vi.mocked(exec).mockImplementation((cmd, callback: any) => {
      callback(null, { stdout: '/usr/local/bin/terminal-notifier', stderr: '' });
      return {} as any;
    });

    // WHEN - Check notifications with inactive session
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
      sessionActive: false,
    });

    // THEN - Should pass (no expectation for inactive sessions)
    expect(result.status).toBe('pass');
  });

  it('should handle log read errors gracefully', async () => {
    // GIVEN - Mock log file read throws error
    vi.mocked(fs.readFile).mockRejectedValue(new Error('Failed to read log'));

    vi.mocked(exec).mockImplementation((cmd, callback: any) => {
      callback(null, { stdout: '/usr/local/bin/terminal-notifier', stderr: '' });
      return {} as any;
    });

    // WHEN - Check notifications
    const result = await checkNotifications({
      logPath: '/path/to/watcher.log',
    });

    // THEN - Should warn about log read failure
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Could not read notification logs');
  });
});
