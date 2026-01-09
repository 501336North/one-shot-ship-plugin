/**
 * @behavior telegram-notify CLI sends notifications via Telegram from shell scripts
 * @acceptance-criteria AC-TELEGRAM-NOTIFY.1 through AC-TELEGRAM-NOTIFY.5
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
  sendTelegramNotification,
  waitForCallback,
  parseButtons,
  NotificationResult,
} from '../../src/cli/telegram-notify.js';

describe('telegram-notify CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockFetch: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir to return a predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default: settings.json does not exist
    (fs.existsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockReturnValue('{}');

    // Mock fetch globally
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  /**
   * @behavior AC-TELEGRAM-NOTIFY.1: Send notification when Telegram is enabled
   * @business-rule Notifications only sent when Telegram is properly configured and enabled
   */
  describe('sendTelegramNotification when enabled', () => {
    it('should send notification and return success with messageId', async () => {
      // GIVEN: Telegram is enabled and configured
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // Mock successful API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 42 } }),
      });

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Build complete! 47/47 tests passing');

      // THEN: Returns success with messageId
      expect(result.success).toBe(true);
      expect(result.messageId).toBe(42);

      // AND: API was called with correct payload
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
        })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Build complete! 47/47 tests passing');
      expect(body.chat_id).toBe('987654321');
    });
  });

  /**
   * @behavior AC-TELEGRAM-NOTIFY.2: Skip when Telegram is disabled
   * @business-rule When disabled, return success (no-op) without calling API
   */
  describe('sendTelegramNotification when disabled', () => {
    it('should return success without calling API when disabled', async () => {
      // GIVEN: Telegram is configured but disabled
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns success (no-op)
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  /**
   * @behavior AC-TELEGRAM-NOTIFY.3: Skip when Telegram is not configured
   * @business-rule When not configured (missing token/chatId), return success (no-op)
   */
  describe('sendTelegramNotification when not configured', () => {
    it('should return success without calling API when settings.json does not exist', async () => {
      // GIVEN: Settings file does not exist
      (fs.existsSync as Mock).mockReturnValue(false);

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns success (no-op)
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return success without calling API when botToken is empty', async () => {
      // GIVEN: botToken is empty
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '',
          chatId: '987654321',
        },
      }));

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns success (no-op)
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return success without calling API when chatId is empty', async () => {
      // GIVEN: chatId is empty
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '',
        },
      }));

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns success (no-op)
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  /**
   * @behavior AC-TELEGRAM-NOTIFY.4: Send with inline keyboard buttons
   * @business-rule Buttons create interactive messages for user input
   */
  describe('sendTelegramNotification with buttons', () => {
    it('should send message with inline keyboard and return messageId', async () => {
      // GIVEN: Telegram is enabled and configured
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // Mock successful API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 99 } }),
      });

      const buttons = [[
        { text: 'Fix all', callbackData: 'fix_all' },
        { text: 'Skip', callbackData: 'skip' },
      ]];

      // WHEN: sendTelegramNotification is called with buttons
      const result = await sendTelegramNotification('How to proceed?', buttons);

      // THEN: Returns success with messageId
      expect(result.success).toBe(true);
      expect(result.messageId).toBe(99);

      // AND: API was called with inline keyboard
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reply_markup).toBeDefined();
      expect(body.reply_markup.inline_keyboard).toBeDefined();
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
      expect(body.reply_markup.inline_keyboard[0][0].text).toBe('Fix all');
      expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('fix_all');
    });
  });

  /**
   * @behavior AC-TELEGRAM-NOTIFY.5: Wait for callback response
   * @business-rule Polling for user button selection returns the callback data
   */
  describe('waitForCallback', () => {
    it('should poll and return callback data when user clicks button', async () => {
      // GIVEN: Telegram is enabled and configured
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // Mock getUpdates returning callback
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/getUpdates')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: [{
                update_id: 1,
                callback_query: {
                  id: 'cb1',
                  message: { message_id: 99 },
                  data: 'fix_all',
                },
              }],
            }),
          });
        }
        // answerCallbackQuery and editMessageReplyMarkup
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      // WHEN: waitForCallback is called
      const callbackData = await waitForCallback(99);

      // THEN: Returns the callback data
      expect(callbackData).toBe('fix_all');
    });

    it('should return null when Telegram is disabled', async () => {
      // GIVEN: Telegram is disabled
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // WHEN: waitForCallback is called
      const callbackData = await waitForCallback(99);

      // THEN: Returns null
      expect(callbackData).toBeNull();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when Telegram is not configured', async () => {
      // GIVEN: Settings file does not exist
      (fs.existsSync as Mock).mockReturnValue(false);

      // WHEN: waitForCallback is called
      const callbackData = await waitForCallback(99);

      // THEN: Returns null
      expect(callbackData).toBeNull();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should timeout and return null after specified duration', async () => {
      // GIVEN: Telegram is enabled but no callback received
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // Mock getUpdates returning no callbacks
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      });

      // WHEN: waitForCallback is called with short timeout
      const callbackData = await waitForCallback(99, { timeoutMs: 50, pollIntervalMs: 10 });

      // THEN: Returns null (timeout)
      expect(callbackData).toBeNull();
    });
  });

  /**
   * @behavior parseButtons parses JSON string to TelegramButton array
   * @business-rule CLI accepts JSON string for buttons, needs parsing
   */
  describe('parseButtons helper', () => {
    it('should parse valid JSON array of buttons', () => {
      const json = '[{"text":"Fix all","callbackData":"fix_all"},{"text":"Skip","callbackData":"skip"}]';

      const buttons = parseButtons(json);

      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveLength(2);
      expect(buttons[0][0].text).toBe('Fix all');
      expect(buttons[0][0].callbackData).toBe('fix_all');
    });

    it('should return empty array for invalid JSON', () => {
      const json = 'not valid json';

      const buttons = parseButtons(json);

      expect(buttons).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      const buttons = parseButtons('');

      expect(buttons).toEqual([]);
    });

    it('should return empty array for undefined', () => {
      const buttons = parseButtons(undefined);

      expect(buttons).toEqual([]);
    });

    it('should handle nested array format (multiple rows)', () => {
      const json = '[[{"text":"A","callbackData":"a"}],[{"text":"B","callbackData":"b"}]]';

      const buttons = parseButtons(json);

      expect(buttons).toHaveLength(2);
      expect(buttons[0][0].text).toBe('A');
      expect(buttons[1][0].text).toBe('B');
    });
  });

  /**
   * @behavior Error handling when API fails
   * @business-rule API errors should return failure result
   */
  describe('error handling', () => {
    it('should return failure when API returns error', async () => {
      // GIVEN: Telegram is enabled
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // Mock API error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ description: 'Unauthorized' }),
      });

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns failure
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return failure when fetch throws', async () => {
      // GIVEN: Telegram is enabled
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      }));

      // Mock network error
      mockFetch.mockRejectedValue(new Error('Network error'));

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns failure
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle malformed settings.json gracefully', async () => {
      // GIVEN: Settings file has invalid JSON
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue('not valid json {');

      // WHEN: sendTelegramNotification is called
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns success (no-op, treated as not configured)
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
