/**
 * NotificationService Tests
 *
 * @behavior Notifications are dispatched based on user settings
 * @acceptance-criteria AC-NOTIF.1 through AC-NOTIF.12
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NotificationService } from '../../src/services/notification.js';
import {
  NotificationEvent,
  NotificationSettings,
  NotificationStyle,
  Verbosity,
  Priority,
} from '../../src/types/notification.js';

describe('NotificationService', () => {
  let testDir: string;
  let settingsPath: string;
  let service: NotificationService;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-test-'));
    settingsPath = path.join(testDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('settings loading', () => {
    it('should load settings from settings.json', () => {
      const settings: NotificationSettings = {
        notifications: {
          style: 'audio',
          voice: 'Daniel',
          sound: 'Ping',
          verbosity: 'all',
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      service = new NotificationService(testDir);
      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('audio');
      expect(loaded.notifications.voice).toBe('Daniel');
      expect(loaded.notifications.sound).toBe('Ping');
      expect(loaded.notifications.verbosity).toBe('all');
    });

    it('should fall back to defaults when no settings file', () => {
      service = new NotificationService(testDir);
      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('visual');
      expect(loaded.notifications.voice).toBe('Samantha');
      expect(loaded.notifications.sound).toBe('Glass');
      expect(loaded.notifications.verbosity).toBe('important');
    });

    it('should fall back to defaults for missing fields', () => {
      fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { style: 'sound' } }));

      service = new NotificationService(testDir);
      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('sound');
      expect(loaded.notifications.voice).toBe('Samantha'); // default
      expect(loaded.notifications.verbosity).toBe('important'); // default
    });
  });

  describe('verbosity filtering', () => {
    it('should allow all events when verbosity is "all"', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'visual', verbosity: 'all' } })
      );
      service = new NotificationService(testDir);

      const lowEvent: NotificationEvent = {
        type: 'COMMAND_START',
        title: 'Test',
        message: 'Test message',
        priority: 'low',
      };

      expect(service.shouldNotify(lowEvent)).toBe(true);
    });

    it('should filter low priority when verbosity is "important"', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'visual', verbosity: 'important' } })
      );
      service = new NotificationService(testDir);

      const lowEvent: NotificationEvent = {
        type: 'COMMAND_START',
        title: 'Test',
        message: 'Test message',
        priority: 'low',
      };
      const highEvent: NotificationEvent = {
        type: 'COMMAND_COMPLETE',
        title: 'Test',
        message: 'Test message',
        priority: 'high',
      };

      expect(service.shouldNotify(lowEvent)).toBe(false);
      expect(service.shouldNotify(highEvent)).toBe(true);
    });

    it('should only allow critical when verbosity is "errors-only"', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'visual', verbosity: 'errors-only' } })
      );
      service = new NotificationService(testDir);

      const highEvent: NotificationEvent = {
        type: 'COMMAND_COMPLETE',
        title: 'Test',
        message: 'Test message',
        priority: 'high',
      };
      const criticalEvent: NotificationEvent = {
        type: 'COMMAND_FAILED',
        title: 'Test',
        message: 'Test message',
        priority: 'critical',
      };

      expect(service.shouldNotify(highEvent)).toBe(false);
      expect(service.shouldNotify(criticalEvent)).toBe(true);
    });

    it('should skip all notifications when style is "none"', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'none', verbosity: 'all' } })
      );
      service = new NotificationService(testDir);

      const criticalEvent: NotificationEvent = {
        type: 'COMMAND_FAILED',
        title: 'Test',
        message: 'Test message',
        priority: 'critical',
      };

      expect(service.shouldNotify(criticalEvent)).toBe(false);
    });
  });

  describe('notification dispatch', () => {
    it('should generate visual notification command using setMessage', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'visual', verbosity: 'all' } })
      );
      service = new NotificationService(testDir);

      const event: NotificationEvent = {
        type: 'COMMAND_COMPLETE',
        title: '✅ Build Complete',
        message: '24 tests passing',
        priority: 'high',
      };

      const command = service.getNotifyCommand(event);
      // Visual notifications now use setMessage for status line
      expect(command).toContain('setMessage');
      expect(command).toContain('24 tests passing');
    });

    it('should generate audio notification command', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'audio', voice: 'Daniel', verbosity: 'all' } })
      );
      service = new NotificationService(testDir);

      const event: NotificationEvent = {
        type: 'COMMAND_COMPLETE',
        title: 'Build Complete',
        message: '24 tests passing',
        priority: 'high',
      };

      const command = service.getNotifyCommand(event);
      expect(command).toContain('say');
      expect(command).toContain('-v Daniel');
      expect(command).toContain('24 tests passing');
    });

    it('should generate sound notification command', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'sound', sound: 'Ping', verbosity: 'all' } })
      );
      service = new NotificationService(testDir);

      const event: NotificationEvent = {
        type: 'COMMAND_COMPLETE',
        title: 'Build Complete',
        message: '24 tests passing',
        priority: 'high',
      };

      const command = service.getNotifyCommand(event);
      expect(command).toContain('afplay');
      expect(command).toContain('Ping.aiff');
    });

    it('should return empty command when style is "none"', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ notifications: { style: 'none', verbosity: 'all' } })
      );
      service = new NotificationService(testDir);

      const event: NotificationEvent = {
        type: 'COMMAND_COMPLETE',
        title: 'Build Complete',
        message: '24 tests passing',
        priority: 'high',
      };

      const command = service.getNotifyCommand(event);
      expect(command).toBe('');
    });
  });

  describe('event type categorization', () => {
    beforeEach(() => {
      service = new NotificationService(testDir);
    });

    it('should categorize COMMAND_START as low priority', () => {
      expect(NotificationService.getDefaultPriority('COMMAND_START')).toBe('low');
    });

    it('should categorize COMMAND_COMPLETE as high priority', () => {
      expect(NotificationService.getDefaultPriority('COMMAND_COMPLETE')).toBe('high');
    });

    it('should categorize COMMAND_FAILED as critical priority', () => {
      expect(NotificationService.getDefaultPriority('COMMAND_FAILED')).toBe('critical');
    });

    it('should categorize LOOP_DETECTED as critical priority', () => {
      expect(NotificationService.getDefaultPriority('LOOP_DETECTED')).toBe('critical');
    });

    it('should categorize AGENT_SPAWN as low priority', () => {
      expect(NotificationService.getDefaultPriority('AGENT_SPAWN')).toBe('low');
    });

    it('should categorize PR_MERGED as high priority', () => {
      expect(NotificationService.getDefaultPriority('PR_MERGED')).toBe('high');
    });
  });
});
