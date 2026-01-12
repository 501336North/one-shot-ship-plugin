/**
 * @behavior telegram-toggle CLI enables or disables Telegram notifications
 * @acceptance-criteria AC-TELEGRAM-TOGGLE.1 through AC-TELEGRAM-TOGGLE.5
 * @boundary CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

// Import after mocks are set up
import { toggleTelegram, ToggleResult } from '../../src/cli/telegram-toggle.js';

describe('telegram-toggle CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;
  const mockSettingsPath = '/home/testuser/.oss/settings.json';

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir to return a predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default: settings directory exists
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.mkdirSync as Mock).mockReturnValue(undefined);
    (fs.writeFileSync as Mock).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior AC-TELEGRAM-TOGGLE.1: "on" when not configured returns error
   */
  describe('when action is "on" and Telegram is not configured', () => {
    it('should return error when settings.json does not exist', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const result = await toggleTelegram('on');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error: Telegram not configured.');
      expect(result.message).toContain('Run /oss:telegram setup first.');
    });

    it('should return error when telegram section is missing', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        notifications: { style: 'visual' },
      }));

      const result = await toggleTelegram('on');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error: Telegram not configured.');
    });

    it('should return error when botToken is empty', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: { enabled: false, botToken: '', chatId: '123456789' },
      }));

      const result = await toggleTelegram('on');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error: Telegram not configured.');
    });

    it('should return error when chatId is empty', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: { enabled: false, botToken: '123456:ABC-xyz', chatId: '' },
      }));

      const result = await toggleTelegram('on');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error: Telegram not configured.');
    });
  });

  /**
   * @behavior AC-TELEGRAM-TOGGLE.2: "on" when configured enables notifications
   */
  describe('when action is "on" and Telegram is configured', () => {
    it('should enable notifications and return success message', async () => {
      const settings = {
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(settings));

      const result = await toggleTelegram('on');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Telegram notifications enabled.');
      expect(result.message).toContain('You will receive Telegram messages when Claude needs input or completes tasks.');
      expect(result.message).toContain('To disable: /oss:telegram off');
    });

    it('should persist enabled state to settings.json', async () => {
      const settings = {
        notifications: { style: 'visual' },
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(settings));

      await toggleTelegram('on');

      // Verify writeFileSync was called with enabled: true
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = (fs.writeFileSync as Mock).mock.calls[0];
      const writtenSettings = JSON.parse(writeCall[1]);
      expect(writtenSettings.telegram.enabled).toBe(true);
    });
  });

  /**
   * @behavior AC-TELEGRAM-TOGGLE.3: "off" disables notifications
   */
  describe('when action is "off"', () => {
    it('should disable notifications and return success message', async () => {
      const settings = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(settings));

      const result = await toggleTelegram('off');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Telegram notifications disabled.');
      expect(result.message).toContain('To re-enable: /oss:telegram on');
    });

    it('should disable even if not previously configured', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const result = await toggleTelegram('off');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Telegram notifications disabled.');
    });

    it('should persist disabled state to settings.json', async () => {
      const settings = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(settings));

      await toggleTelegram('off');

      // Verify writeFileSync was called with enabled: false
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = (fs.writeFileSync as Mock).mock.calls[0];
      const writtenSettings = JSON.parse(writeCall[1]);
      expect(writtenSettings.telegram.enabled).toBe(false);
    });
  });

  /**
   * @behavior AC-TELEGRAM-TOGGLE.4: Exit code 0 on success, 1 on error
   */
  describe('exit codes', () => {
    it('should return success: true for successful enable', async () => {
      const settings = {
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(settings));

      const result = await toggleTelegram('on');

      expect(result.success).toBe(true);
    });

    it('should return success: false when enable fails due to no config', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const result = await toggleTelegram('on');

      expect(result.success).toBe(false);
    });

    it('should return success: true for successful disable', async () => {
      const settings = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(settings));

      const result = await toggleTelegram('off');

      expect(result.success).toBe(true);
    });
  });

  /**
   * @behavior Error handling for file system errors
   */
  describe('error handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue('not valid json {');

      const result = await toggleTelegram('on');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error: Telegram not configured.');
    });

    it('should create config directory if it does not exist on disable', async () => {
      (fs.existsSync as Mock).mockImplementation((path: string) => {
        // Settings file doesn't exist, but we need to create directory
        return !path.endsWith('settings.json');
      });

      await toggleTelegram('off');

      // Should still succeed in disabling
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });
});
