/**
 * SettingsService Tests
 *
 * @behavior Settings are persisted to ~/.oss/settings.json
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SettingsService } from '../../src/services/settings.js';
import { NotificationSettings } from '../../src/types/notification.js';

describe('SettingsService', () => {
  // Track directories for cleanup
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  afterEach(() => {
    // Clean up all test directories
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
  });

  describe('file management', () => {
    it('should create settings.json if not exists', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const service = new SettingsService(testDir);
      service.save();

      expect(fs.existsSync(settingsPath)).toBe(true);
    });

    it('should read existing settings.json', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const settings: NotificationSettings = {
        notifications: {
          style: 'audio',
          voice: 'Daniel',
          sound: 'Purr',
          verbosity: 'all',
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('audio');
      expect(loaded.notifications.voice).toBe('Daniel');
    });

    it('should write updated settings', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const service = new SettingsService(testDir);
      service.setNotificationStyle('sound');
      service.save();

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const saved = JSON.parse(content);

      expect(saved.notifications.style).toBe('sound');
    });
  });

  describe('partial updates', () => {
    it('should merge partial updates with existing settings', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const settings: NotificationSettings = {
        notifications: {
          style: 'audio',
          voice: 'Daniel',
          sound: 'Purr',
          verbosity: 'all',
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      const service = new SettingsService(testDir);
      service.setNotificationStyle('visual');
      service.save();

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const saved = JSON.parse(content);

      // Changed field
      expect(saved.notifications.style).toBe('visual');
      // Preserved fields
      expect(saved.notifications.voice).toBe('Daniel');
      expect(saved.notifications.sound).toBe('Purr');
      expect(saved.notifications.verbosity).toBe('all');
    });
  });

  describe('validation', () => {
    it('should validate settings schema and fall back to defaults on invalid', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      // Write invalid JSON
      fs.writeFileSync(settingsPath, '{ invalid json }');

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      // Should use defaults
      expect(loaded.notifications.style).toBe('visual');
      expect(loaded.notifications.voice).toBe('Samantha');
    });

    it('should validate notification style values', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const settings = {
        notifications: {
          style: 'invalid-style', // Invalid
          voice: 'Daniel',
          sound: 'Purr',
          verbosity: 'all',
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      // Invalid style should fall back to default
      expect(loaded.notifications.style).toBe('visual');
    });
  });

  describe('migration', () => {
    it('should migrate from old audio-config format', () => {
      const testDir = createTestDir();

      // Create old-style audio-config file
      const audioConfigPath = path.join(testDir, 'audio-config');
      const oldConfig = `OSS_AUDIO_ENABLED=true
OSS_USE_VOICE=true
OSS_VOICE=Daniel
OSS_SOUND_SUCCESS=Glass
OSS_SOUND_ERROR=Basso`;
      fs.writeFileSync(audioConfigPath, oldConfig);

      const service = new SettingsService(testDir);
      service.migrateFromAudioConfig();
      service.save();

      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('audio');
      expect(loaded.notifications.voice).toBe('Daniel');
    });
  });

  describe('setter methods', () => {
    it('should set notification style', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setNotificationStyle('audio');
      expect(service.getSettings().notifications.style).toBe('audio');
    });

    it('should set verbosity', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setVerbosity('errors-only');
      expect(service.getSettings().notifications.verbosity).toBe('errors-only');
    });

    it('should set voice', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setVoice('Karen');
      expect(service.getSettings().notifications.voice).toBe('Karen');
    });

    it('should set sound', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setSound('Ping');
      expect(service.getSettings().notifications.sound).toBe('Ping');
    });
  });
});
