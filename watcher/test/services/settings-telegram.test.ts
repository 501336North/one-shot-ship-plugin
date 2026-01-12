import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SettingsService } from '../../src/services/settings.js';
import { DEFAULT_TELEGRAM_CONFIG } from '../../src/types/telegram.js';

describe('SettingsService - Telegram', () => {
  let configDir: string;
  let settingsService: SettingsService;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-test-'));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('should return default telegram config when not configured', () => {
    settingsService = new SettingsService(configDir);
    const telegram = settingsService.getTelegram();

    expect(telegram).toEqual(DEFAULT_TELEGRAM_CONFIG);
    expect(telegram.enabled).toBe(false);
    expect(telegram.botToken).toBe('');
    expect(telegram.chatId).toBe('');
  });

  it('should save and load telegram config', () => {
    settingsService = new SettingsService(configDir);

    settingsService.setTelegram({
      enabled: true,
      botToken: '123:ABC',
      chatId: '456',
    });

    // Reload to verify persistence
    const reloaded = new SettingsService(configDir);
    const telegram = reloaded.getTelegram();

    expect(telegram.enabled).toBe(true);
    expect(telegram.botToken).toBe('123:ABC');
    expect(telegram.chatId).toBe('456');
  });

  it('should toggle telegram enabled state', () => {
    settingsService = new SettingsService(configDir);

    // First set up a valid config
    settingsService.setTelegram({
      enabled: false,
      botToken: '123:ABC',
      chatId: '456',
    });

    // Toggle on
    settingsService.setTelegramEnabled(true);
    expect(settingsService.getTelegram().enabled).toBe(true);

    // Toggle off
    settingsService.setTelegramEnabled(false);
    expect(settingsService.getTelegram().enabled).toBe(false);
  });

  it('should preserve other telegram fields when toggling', () => {
    settingsService = new SettingsService(configDir);

    settingsService.setTelegram({
      enabled: false,
      botToken: 'my-token',
      chatId: 'my-chat',
    });

    settingsService.setTelegramEnabled(true);

    const telegram = settingsService.getTelegram();
    expect(telegram.botToken).toBe('my-token');
    expect(telegram.chatId).toBe('my-chat');
  });
});
