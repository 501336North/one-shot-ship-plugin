import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramService } from '../../src/services/telegram.js';
import { TelegramConfig } from '../../src/types/telegram.js';

describe('TelegramService', () => {
  const validConfig: TelegramConfig = {
    enabled: true,
    botToken: '123456:ABC-DEF',
    chatId: '987654321',
  };

  describe('isConfigured', () => {
    it('should return false when botToken is empty', () => {
      const service = new TelegramService({ ...validConfig, botToken: '' });
      expect(service.isConfigured()).toBe(false);
    });

    it('should return false when chatId is empty', () => {
      const service = new TelegramService({ ...validConfig, chatId: '' });
      expect(service.isConfigured()).toBe(false);
    });

    it('should return true when both botToken and chatId are set', () => {
      const service = new TelegramService(validConfig);
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return false when enabled=false', () => {
      const service = new TelegramService({ ...validConfig, enabled: false });
      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when not configured even if enabled=true', () => {
      const service = new TelegramService({ enabled: true, botToken: '', chatId: '' });
      expect(service.isEnabled()).toBe(false);
    });

    it('should return true when enabled AND configured', () => {
      const service = new TelegramService({ ...validConfig, enabled: true });
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('sendMessage', () => {
    it('should send message via Telegram API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 123 } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      const msgId = await service.sendMessage('Hello');

      expect(msgId).toBe(123);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Hello');
      expect(body.chat_id).toBe('987654321');

      vi.unstubAllGlobals();
    });

    it('should include inline keyboard when buttons provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 123 } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      await service.sendMessage('Choose:', [[
        { text: 'Yes', callbackData: 'yes' },
        { text: 'No', callbackData: 'no' },
      ]]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reply_markup).toBeDefined();
      expect(body.reply_markup.inline_keyboard).toBeDefined();
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
      expect(body.reply_markup.inline_keyboard[0][0].text).toBe('Yes');
      expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('yes');

      vi.unstubAllGlobals();
    });

    it('should throw when API returns error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ description: 'Unauthorized' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      await expect(service.sendMessage('Hello')).rejects.toThrow('Telegram API error');

      vi.unstubAllGlobals();
    });

    it('should return null and not call API when disabled', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService({ ...validConfig, enabled: false });
      const result = await service.sendMessage('Hello');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe('notify', () => {
    it('should send notification without buttons', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 123 } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      await service.notify('Task complete!');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Task complete!');
      expect(body.reply_markup).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('should not throw on API error (fire-and-forget)', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      // Should not throw
      await expect(service.notify('Hello')).resolves.toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('should silently return when disabled', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService({ ...validConfig, enabled: false });
      await service.notify('Hello');

      expect(mockFetch).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe('awaitCallback', () => {
    it('should poll getUpdates until callback received', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes('/getUpdates')) {
          if (callCount === 1) {
            // First call: no updates
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ result: [] }),
            });
          } else {
            // Second call: callback received
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                result: [{
                  update_id: 1,
                  callback_query: {
                    id: 'cb1',
                    message: { message_id: 123 },
                    data: 'user_choice',
                  },
                }],
              }),
            });
          }
        }
        // answerCallbackQuery and editMessageReplyMarkup
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      const result = await service.awaitCallback(123, { pollIntervalMs: 10 });

      expect(result).toBe('user_choice');

      vi.unstubAllGlobals();
    });

    it('should answer callback query after receiving', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/getUpdates')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: [{
                update_id: 1,
                callback_query: {
                  id: 'cb123',
                  message: { message_id: 123 },
                  data: 'choice',
                },
              }],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      await service.awaitCallback(123);

      // Should have called answerCallbackQuery
      const answerCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('/answerCallbackQuery')
      );
      expect(answerCall).toBeDefined();

      vi.unstubAllGlobals();
    });

    it('should timeout and return null when specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      const result = await service.awaitCallback(123, {
        timeoutMs: 50,
        pollIntervalMs: 10,
      });

      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it('should remove inline keyboard after selection', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/getUpdates')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: [{
                update_id: 1,
                callback_query: {
                  id: 'cb1',
                  message: { message_id: 123, text: 'Choose:' },
                  data: 'yes',
                },
              }],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      await service.awaitCallback(123);

      // Should have called editMessageReplyMarkup to remove buttons
      const editCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('/editMessageReplyMarkup')
      );
      expect(editCall).toBeDefined();

      vi.unstubAllGlobals();
    });

    it('should return null when disabled', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService({ ...validConfig, enabled: false });
      const result = await service.awaitCallback(123);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe('validateConfig', () => {
    it('should return valid=true when bot responds', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/getMe')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ result: { username: 'my_test_bot' } }),
          });
        }
        if (url.includes('/sendMessage')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ result: { message_id: 999 } }),
          });
        }
        if (url.includes('/deleteMessage')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      const result = await service.validateConfig();

      expect(result.valid).toBe(true);
      expect(result.botUsername).toBe('my_test_bot');
      expect(result.errors).toHaveLength(0);

      vi.unstubAllGlobals();
    });

    it('should return valid=false when token is invalid', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ description: 'Unauthorized' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      const result = await service.validateConfig();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid bot token');

      vi.unstubAllGlobals();
    });

    it('should test send permission to chatId', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/getMe')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ result: { username: 'bot' } }),
          });
        }
        if (url.includes('/sendMessage')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ result: { message_id: 1 } }),
          });
        }
        if (url.includes('/deleteMessage')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      const result = await service.validateConfig();

      expect(result.valid).toBe(true);
      expect(result.canSendToChat).toBe(true);

      vi.unstubAllGlobals();
    });

    it('should return canSendToChat=false when chat not accessible', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/getMe')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ result: { username: 'bot' } }),
          });
        }
        if (url.includes('/sendMessage')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: () => Promise.resolve({ description: 'Chat not found' }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService(validConfig);
      const result = await service.validateConfig();

      expect(result.valid).toBe(false);
      expect(result.canSendToChat).toBe(false);
      expect(result.errors).toContain('Cannot send to chat');

      vi.unstubAllGlobals();
    });
  });

  describe('fetchChatId', () => {
    it('should get chatId from recent message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          result: [{
            update_id: 1,
            message: {
              chat: { id: 12345 },
              from: { first_name: 'John' },
            },
          }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      // Service with empty chatId (setup scenario)
      const service = new TelegramService({
        enabled: false,
        botToken: '123:ABC',
        chatId: ''
      });
      const result = await service.fetchChatId();

      expect(result).not.toBeNull();
      expect(result?.chatId).toBe('12345');
      expect(result?.userName).toBe('John');

      vi.unstubAllGlobals();
    });

    it('should return null when no messages found', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService({
        enabled: false,
        botToken: '123:ABC',
        chatId: ''
      });
      const result = await service.fetchChatId();

      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it('should handle API errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const service = new TelegramService({
        enabled: false,
        botToken: '123:ABC',
        chatId: ''
      });
      const result = await service.fetchChatId();

      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });
  });
});
