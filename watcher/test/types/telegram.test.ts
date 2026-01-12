import { describe, it, expect } from 'vitest';
import {
  TelegramConfig,
  TelegramButton,
  DEFAULT_TELEGRAM_CONFIG,
} from '../../src/types/telegram.js';

describe('Telegram Types', () => {
  it('should define TelegramConfig interface', () => {
    const config: TelegramConfig = {
      enabled: false,
      botToken: '123:ABC',
      chatId: '456',
    };
    expect(config.enabled).toBe(false);
    expect(config.botToken).toBe('123:ABC');
    expect(config.chatId).toBe('456');
  });

  it('should define TelegramButton interface', () => {
    const button: TelegramButton = {
      text: 'Click me',
      callbackData: 'action_1',
    };
    expect(button.text).toBe('Click me');
    expect(button.callbackData).toBe('action_1');
  });

  it('should define DEFAULT_TELEGRAM_CONFIG with enabled=false', () => {
    expect(DEFAULT_TELEGRAM_CONFIG.enabled).toBe(false);
    expect(DEFAULT_TELEGRAM_CONFIG.botToken).toBe('');
    expect(DEFAULT_TELEGRAM_CONFIG.chatId).toBe('');
  });
});
