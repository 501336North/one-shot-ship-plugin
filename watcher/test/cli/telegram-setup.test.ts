/**
 * @behavior telegram-setup CLI guides users through Telegram bot configuration
 * @acceptance-criteria AC-TELEGRAM-SETUP.1 through AC-TELEGRAM-SETUP.8
 * @boundary CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

// Mock TelegramService - London TDD: mock all collaborators
// Use a class mock to allow proper constructor calls
const mockValidateConfig = vi.fn();
const mockFetchChatId = vi.fn();
const mockSendMessage = vi.fn();

vi.mock('../../src/services/telegram.js', () => ({
  TelegramService: vi.fn().mockImplementation(function () {
    return {
      validateConfig: mockValidateConfig,
      fetchChatId: mockFetchChatId,
      sendMessage: mockSendMessage,
    };
  }),
}));

// Now import the functions to test
import {
  setupTelegram,
  formatSetupOutput,
  SetupResult,
} from '../../src/cli/telegram-setup.js';
import { TelegramService } from '../../src/services/telegram.js';

describe('telegram-setup CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir to return a predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default fs mocks
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({}));
    (fs.writeFileSync as Mock).mockReturnValue(undefined);
    (fs.mkdirSync as Mock).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.1: Validate token via TelegramService.validateConfig()
   */
  describe('Step 1: Token validation', () => {
    it('should return error when bot token is invalid', async () => {
      mockValidateConfig.mockResolvedValue({
        valid: false,
        errors: ['Invalid bot token'],
        botUsername: undefined,
        canSendToChat: false,
      });

      const result = await setupTelegram('invalid-token');

      expect(result.success).toBe(false);
      expect(result.step).toBe('validate');
      expect(result.message).toContain('Invalid bot token');
    });

    it('should proceed to next step when token is valid', async () => {
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_oss_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '123456789',
        userName: 'JohnDoe',
      });
      mockSendMessage.mockResolvedValue(1);

      const result = await setupTelegram('valid-token:ABC');

      expect(result.success).toBe(true);
      expect(result.botUsername).toBe('my_oss_bot');
    });

    it('should include bot username in success result', async () => {
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'test_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '123456789',
        userName: 'TestUser',
      });
      mockSendMessage.mockResolvedValue(1);

      const result = await setupTelegram('123456:ABC-xyz');

      expect(result.botUsername).toBe('test_bot');
    });
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.2: Fetch chat ID via TelegramService.fetchChatId()
   */
  describe('Step 2: Chat ID fetch', () => {
    beforeEach(() => {
      // Valid token for all these tests
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_bot',
        canSendToChat: true,
      });
    });

    it('should return error when no messages found (user needs to message bot)', async () => {
      mockFetchChatId.mockResolvedValue(null);

      const result = await setupTelegram('valid-token:ABC');

      expect(result.success).toBe(false);
      expect(result.step).toBe('fetch_chat');
      expect(result.message).toContain('No messages found');
    });

    it('should return chat ID and user name when found', async () => {
      mockFetchChatId.mockResolvedValue({
        chatId: '987654321',
        userName: 'JohnDoe',
      });
      mockSendMessage.mockResolvedValue(1);

      const result = await setupTelegram('valid-token:ABC');

      expect(result.chatId).toBe('987654321');
      expect(result.userName).toBe('JohnDoe');
    });
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.3: Save configuration to settings
   */
  describe('Step 3: Save configuration', () => {
    beforeEach(() => {
      // Valid token and chat ID for all these tests
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '123456789',
        userName: 'TestUser',
      });
      mockSendMessage.mockResolvedValue(1);
    });

    it('should save configuration to settings.json', async () => {
      await setupTelegram('valid-token:ABC');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('settings.json'),
        expect.stringContaining('"botToken"'),
        expect.anything()
      );
    });

    it('should save botToken and chatId in telegram settings', async () => {
      await setupTelegram('valid-token:ABC');

      const writeCall = (fs.writeFileSync as Mock).mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('settings.json')
      );
      expect(writeCall).toBeDefined();

      const savedContent = JSON.parse(writeCall[1] as string);
      expect(savedContent.telegram.botToken).toBe('valid-token:ABC');
      expect(savedContent.telegram.chatId).toBe('123456789');
    });

    it('should set enabled to false initially (user enables with /oss:telegram on)', async () => {
      await setupTelegram('valid-token:ABC');

      const writeCall = (fs.writeFileSync as Mock).mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('settings.json')
      );
      const savedContent = JSON.parse(writeCall[1] as string);
      expect(savedContent.telegram.enabled).toBe(false);
    });

    it('should create config directory if it does not exist', async () => {
      (fs.existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('.oss')) return false;
        return true;
      });

      await setupTelegram('valid-token:ABC');

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.oss'),
        expect.objectContaining({ recursive: true })
      );
    });
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.4: Send test message to confirm
   */
  describe('Step 4: Send test message', () => {
    beforeEach(() => {
      // Valid token and chat ID for all these tests
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '123456789',
        userName: 'TestUser',
      });
    });

    it('should send test message on successful setup', async () => {
      mockSendMessage.mockResolvedValue(1);

      await setupTelegram('valid-token:ABC');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.stringContaining('connected successfully')
      );
    });

    it('should return success on complete setup', async () => {
      mockSendMessage.mockResolvedValue(1);

      const result = await setupTelegram('valid-token:ABC');

      expect(result.success).toBe(true);
      expect(result.step).toBe('test');
      expect(result.message).toContain('Setup complete');
    });

    it('should return error if test message fails', async () => {
      mockSendMessage.mockRejectedValue(
        new Error('Failed to send message')
      );

      const result = await setupTelegram('valid-token:ABC');

      expect(result.success).toBe(false);
      expect(result.step).toBe('test');
      expect(result.message).toContain('Failed to send test message');
    });
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.5: Network error handling
   */
  describe('Error handling', () => {
    it('should return error on network failure during validation', async () => {
      mockValidateConfig.mockRejectedValue(
        new Error('Network error')
      );

      const result = await setupTelegram('valid-token:ABC');

      expect(result.success).toBe(false);
      expect(result.step).toBe('validate');
      expect(result.message).toContain('Network error');
    });

    it('should return error on network failure during chat ID fetch', async () => {
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockRejectedValue(
        new Error('Network error')
      );

      const result = await setupTelegram('valid-token:ABC');

      expect(result.success).toBe(false);
      expect(result.step).toBe('fetch_chat');
      expect(result.message).toContain('Network error');
    });
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.6: Format output for display
   */
  describe('formatSetupOutput', () => {
    it('should format invalid token error', () => {
      const result: SetupResult = {
        success: false,
        step: 'validate',
        message: 'Invalid bot token.',
      };

      const output = formatSetupOutput(result);

      expect(output).toContain('Validating bot token...');
      expect(output).toContain('Invalid bot token');
    });

    it('should format no messages found error', () => {
      const result: SetupResult = {
        success: false,
        step: 'fetch_chat',
        message: 'No messages found.',
        botUsername: 'my_bot',
      };

      const output = formatSetupOutput(result);

      expect(output).toContain('Bot token valid: @my_bot');
      expect(output).toContain('Fetching your chat ID...');
      expect(output).toContain('No messages found');
      expect(output).toContain('Please send any message to your bot');
    });

    it('should format successful setup', () => {
      const result: SetupResult = {
        success: true,
        step: 'test',
        message: 'Setup complete!',
        botUsername: 'my_oss_bot',
        chatId: '987654321',
        userName: 'JohnDoe',
      };

      const output = formatSetupOutput(result);

      expect(output).toContain('Bot token valid: @my_oss_bot');
      expect(output).toContain('Found chat ID: 987654321');
      expect(output).toContain('from user: JohnDoe');
      expect(output).toContain('Configuration saved');
      expect(output).toContain('Test message sent');
      expect(output).toContain('Setup complete');
      expect(output).toContain('/oss:telegram on');
    });

    it('should format network error', () => {
      const result: SetupResult = {
        success: false,
        step: 'validate',
        message: 'Network error. Please check your connection.',
      };

      const output = formatSetupOutput(result);

      expect(output).toContain('Network error');
    });
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.7: Preserve existing settings when saving
   */
  describe('Preserving existing settings', () => {
    it('should preserve existing notification settings', async () => {
      const existingSettings = {
        notifications: { style: 'audio', verbosity: 'all' },
        supervisor: { mode: 'always' },
        version: 1,
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(existingSettings));

      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '123456789',
        userName: 'TestUser',
      });
      mockSendMessage.mockResolvedValue(1);

      await setupTelegram('valid-token:ABC');

      const writeCall = (fs.writeFileSync as Mock).mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('settings.json')
      );
      const savedContent = JSON.parse(writeCall[1] as string);

      expect(savedContent.notifications.style).toBe('audio');
      expect(savedContent.supervisor.mode).toBe('always');
      expect(savedContent.telegram.botToken).toBe('valid-token:ABC');
    });
  });

  /**
   * @behavior AC-TELEGRAM-SETUP.8: Create TelegramService with correct config
   */
  describe('TelegramService instantiation', () => {
    it('should create TelegramService with provided token for validation', async () => {
      mockValidateConfig.mockResolvedValue({
        valid: false,
        errors: ['Invalid bot token'],
        botUsername: undefined,
        canSendToChat: false,
      });

      await setupTelegram('my-test-token:XYZ');

      expect(TelegramService).toHaveBeenCalledWith(
        expect.objectContaining({
          botToken: 'my-test-token:XYZ',
        })
      );
    });

    it('should create second TelegramService with chatId for test message', async () => {
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '999888777',
        userName: 'TestUser',
      });
      mockSendMessage.mockResolvedValue(1);

      await setupTelegram('valid-token:ABC');

      // Second call should have chatId for sending test message
      expect(TelegramService).toHaveBeenLastCalledWith(
        expect.objectContaining({
          botToken: 'valid-token:ABC',
          chatId: '999888777',
          enabled: true,
        })
      );
    });
  });
});
