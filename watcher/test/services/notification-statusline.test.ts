/**
 * @behavior Visual notifications update status line message, not terminal-notifier
 * @acceptance-criteria getNotifyCommand returns setMessage command, not terminal-notifier
 * @business-rule Status line is the primary visual notification mechanism
 * @boundary NotificationService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NotificationService, NotificationEvent } from '../../src/services/notification.js';

describe('NotificationService - Status Line Visual Notifications', () => {
  const testDir = path.join(os.tmpdir(), `oss-notification-statusline-${Date.now()}`);
  const settingsPath = path.join(testDir, 'settings.json');  // NotificationService expects settings.json directly in configDir
  let service: NotificationService;

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  /**
   * @behavior Visual style uses setMessage instead of terminal-notifier
   * @acceptance-criteria getNotifyCommand returns command with 'setMessage'
   */
  it('should use setMessage for visual notifications', () => {
    // GIVEN: Settings configured for visual style
    fs.writeFileSync(settingsPath, JSON.stringify({
      notifications: { style: 'visual', verbosity: 'all' }
    }));
    service = new NotificationService(testDir);

    // AND: A notification event
    const event: NotificationEvent = {
      type: 'COMMAND_COMPLETE',
      title: 'Build Complete',
      message: '24 tests passing',
      priority: 'high'
    };

    // WHEN: Getting notify command
    const command = service.getNotifyCommand(event);

    // THEN: Command should use setMessage, not terminal-notifier
    expect(command).toContain('setMessage');
    expect(command).not.toContain('terminal-notifier');
  });

  /**
   * @behavior setMessage command includes the notification message
   * @acceptance-criteria Command contains the event message
   */
  it('should include event message in setMessage command', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      notifications: { style: 'visual', verbosity: 'all' }
    }));
    service = new NotificationService(testDir);

    const event: NotificationEvent = {
      type: 'BUILD_PROGRESS',
      title: 'Building',
      message: 'Task 3/10: Auth module',
      priority: 'normal'
    };

    const command = service.getNotifyCommand(event);

    // Message should be in the command
    expect(command).toContain('Task 3/10: Auth module');
  });

  /**
   * @behavior Sound style still uses terminal-notifier (or system sound)
   * @acceptance-criteria Sound style does not use setMessage
   */
  it('should not use setMessage for sound-only notifications', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      notifications: { style: 'sound', verbosity: 'all' }
    }));
    service = new NotificationService(testDir);

    const event: NotificationEvent = {
      type: 'ERROR',
      title: 'Build Failed',
      message: 'TypeScript error',
      priority: 'critical'
    };

    const command = service.getNotifyCommand(event);

    // Sound notifications should not use setMessage
    expect(command).not.toContain('setMessage');
  });

  /**
   * @behavior Muted style returns empty command
   * @acceptance-criteria Muted style returns empty or null command
   */
  it('should return empty command for muted style', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      notifications: { style: 'muted', verbosity: 'all' }
    }));
    service = new NotificationService(testDir);

    const event: NotificationEvent = {
      type: 'INFO',
      title: 'Info',
      message: 'Something happened',
      priority: 'low'
    };

    const command = service.getNotifyCommand(event);

    // Muted should return empty or null
    expect(command === '' || command === null).toBe(true);
  });
});
