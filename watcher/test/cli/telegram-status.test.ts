/**
 * @behavior telegram-status CLI outputs current Telegram notification status
 * @acceptance-criteria AC-TELEGRAM-STATUS.1 through AC-TELEGRAM-STATUS.5
 * @boundary CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

// Now import the functions to test
import {
  getTelegramStatus,
  formatTelegramStatus,
  maskToken,
  TelegramStatusResult,
} from '../../src/cli/telegram-status.js';

describe('telegram-status CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir to return a predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default: settings.json does not exist
    (fs.existsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockReturnValue('{}');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior AC-TELEGRAM-STATUS.1: Output "NOT_CONFIGURED" when no botToken or chatId
   */
  describe('when Telegram is not configured', () => {
    it('should return NOT_CONFIGURED when settings.json does not exist', () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const result = getTelegramStatus();

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.configured).toBe(false);
      expect(result.enabled).toBe(false);
    });

    it('should return NOT_CONFIGURED when telegram section is missing', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        notifications: { style: 'visual' },
      }));

      const result = getTelegramStatus();

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.configured).toBe(false);
    });

    it('should return NOT_CONFIGURED when botToken is empty', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: { enabled: true, botToken: '', chatId: '123456789' },
      }));

      const result = getTelegramStatus();

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.configured).toBe(false);
    });

    it('should return NOT_CONFIGURED when chatId is empty', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: { enabled: true, botToken: '123456:ABC-xyz', chatId: '' },
      }));

      const result = getTelegramStatus();

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.configured).toBe(false);
    });
  });

  /**
   * @behavior AC-TELEGRAM-STATUS.2: Output "OFF" when configured but disabled
   */
  describe('when Telegram is configured but disabled', () => {
    it('should return OFF when enabled is false', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      const result = getTelegramStatus();

      expect(result.status).toBe('OFF');
      expect(result.configured).toBe(true);
      expect(result.enabled).toBe(false);
      expect(result.chatId).toBe('987654321');
    });
  });

  /**
   * @behavior AC-TELEGRAM-STATUS.3: Output "ON" when configured and enabled
   */
  describe('when Telegram is configured and enabled', () => {
    it('should return ON when enabled is true and credentials exist', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      const result = getTelegramStatus();

      expect(result.status).toBe('ON');
      expect(result.configured).toBe(true);
      expect(result.enabled).toBe(true);
      expect(result.chatId).toBe('987654321');
    });
  });

  /**
   * @behavior AC-TELEGRAM-STATUS.4: Include configuration details (masked token, chat ID)
   */
  describe('maskToken helper', () => {
    it('should mask token showing only last 3 characters', () => {
      const token = '123456789:ABC-DEF-GHI-xyz';
      const masked = maskToken(token);

      expect(masked).toBe('***xyz');
    });

    it('should return *** for tokens shorter than 3 characters', () => {
      const token = 'ab';
      const masked = maskToken(token);

      expect(masked).toBe('***');
    });

    it('should return *** for empty token', () => {
      const masked = maskToken('');

      expect(masked).toBe('***');
    });
  });

  /**
   * @behavior AC-TELEGRAM-STATUS.5: Format output for NOT_CONFIGURED state
   */
  describe('formatTelegramStatus for NOT_CONFIGURED', () => {
    it('should display setup instructions when not configured', () => {
      const result: TelegramStatusResult = {
        status: 'NOT_CONFIGURED',
        configured: false,
        enabled: false,
      };

      const output = formatTelegramStatus(result);

      expect(output).toContain('Telegram Notifications: NOT CONFIGURED');
      expect(output).toContain('Setup Instructions:');
      expect(output).toContain('@BotFather');
      expect(output).toContain('/oss:telegram setup');
    });
  });

  /**
   * @behavior AC-TELEGRAM-STATUS.5: Format output for OFF state
   */
  describe('formatTelegramStatus for OFF', () => {
    it('should display configuration and enable instructions when off', () => {
      const result: TelegramStatusResult = {
        status: 'OFF',
        configured: true,
        enabled: false,
        botToken: '123456:ABC-DEF-xyz',
        chatId: '987654321',
      };

      const output = formatTelegramStatus(result);

      expect(output).toContain('Telegram Notifications: OFF');
      expect(output).toContain('Configuration:');
      expect(output).toContain('Bot Token:');
      expect(output).toContain('Configured (***xyz)');
      expect(output).toContain('Chat ID:');
      expect(output).toContain('987654321');
      expect(output).toContain('To enable: /oss:telegram on');
    });
  });

  /**
   * @behavior AC-TELEGRAM-STATUS.5: Format output for ON state
   */
  describe('formatTelegramStatus for ON', () => {
    it('should display configuration and ready status when on', () => {
      const result: TelegramStatusResult = {
        status: 'ON',
        configured: true,
        enabled: true,
        botToken: '123456:ABC-DEF-xyz',
        chatId: '987654321',
      };

      const output = formatTelegramStatus(result);

      expect(output).toContain('Telegram Notifications: ON');
      expect(output).toContain('Configuration:');
      expect(output).toContain('Bot Token:');
      expect(output).toContain('Configured (***xyz)');
      expect(output).toContain('Chat ID:');
      expect(output).toContain('987654321');
      expect(output).toContain('Status:');
      expect(output).toContain('Ready to send');
    });
  });

  /**
   * @behavior Handles malformed JSON gracefully
   */
  describe('error handling', () => {
    it('should return NOT_CONFIGURED when settings.json is malformed', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue('not valid json {');

      const result = getTelegramStatus();

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.configured).toBe(false);
    });

    it('should return NOT_CONFIGURED when fs.readFileSync throws', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = getTelegramStatus();

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.configured).toBe(false);
    });
  });
});
