/**
 * E2E Tests for Telegram Notifications
 *
 * Tests the full integration flow across all Telegram CLI modules:
 * - Status: getTelegramStatus, formatTelegramStatus
 * - Toggle: toggleTelegram
 * - Setup: setupTelegram
 * - Notify: sendTelegramNotification
 *
 * @behavior Telegram notification system works end-to-end
 * @acceptance-criteria AC-TELEGRAM-E2E.1 through AC-TELEGRAM-E2E.4
 * @boundary E2E
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock dependencies BEFORE importing modules under test
vi.mock('fs');
vi.mock('os');

// Mock TelegramService for setup flow
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

// Now import the CLI modules
import {
  getTelegramStatus,
  formatTelegramStatus,
  TelegramStatusResult,
} from '../../src/cli/telegram-status.js';
import { toggleTelegram } from '../../src/cli/telegram-toggle.js';
import { setupTelegram, formatSetupOutput } from '../../src/cli/telegram-setup.js';
import { sendTelegramNotification, parseButtons } from '../../src/cli/telegram-notify.js';

describe('Telegram E2E Flow', () => {
  let mockFetch: Mock;
  let settingsStore: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock os.homedir to return predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Simulate settings file state
    settingsStore = {};

    // Mock fs operations to use in-memory settings store
    (fs.existsSync as Mock).mockImplementation((filePath: string) => {
      if (filePath === '/home/testuser/.oss/settings.json') {
        return Object.keys(settingsStore).length > 0;
      }
      if (filePath === '/home/testuser/.oss') {
        return true;
      }
      return false;
    });

    (fs.readFileSync as Mock).mockImplementation((filePath: string) => {
      if (filePath === '/home/testuser/.oss/settings.json') {
        return JSON.stringify(settingsStore);
      }
      return '{}';
    });

    (fs.writeFileSync as Mock).mockImplementation(
      (filePath: string, content: string) => {
        if (filePath === '/home/testuser/.oss/settings.json') {
          settingsStore = JSON.parse(content);
        }
      }
    );

    (fs.mkdirSync as Mock).mockReturnValue(undefined);

    // Mock global fetch for notification tests
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * E2E Scenario 1: Status Flow
   *
   * Tests the status command output in different configuration states:
   * - NOT_CONFIGURED: No settings or missing credentials
   * - OFF: Configured but disabled
   * - ON: Configured and enabled
   */
  describe('Status Flow', () => {
    /**
     * @behavior AC-TELEGRAM-E2E.1.1: When not configured, shows NOT_CONFIGURED with setup instructions
     */
    it('should show NOT_CONFIGURED with setup instructions when no settings exist', () => {
      // GIVEN: No settings.json exists (empty settingsStore)
      settingsStore = {};
      (fs.existsSync as Mock).mockReturnValue(false);

      // WHEN: Getting telegram status
      const result = getTelegramStatus();
      const output = formatTelegramStatus(result);

      // THEN: Status is NOT_CONFIGURED
      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.configured).toBe(false);
      expect(result.enabled).toBe(false);

      // AND: Output contains setup instructions
      expect(output).toContain('Telegram Notifications: NOT CONFIGURED');
      expect(output).toContain('Setup Instructions:');
      expect(output).toContain('@BotFather');
      expect(output).toContain('/oss:telegram setup');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.1.2: When configured but disabled, shows OFF with enable instructions
     */
    it('should show OFF with enable instructions when configured but disabled', () => {
      // GIVEN: Telegram is configured but disabled
      settingsStore = {
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // WHEN: Getting telegram status
      const result = getTelegramStatus();
      const output = formatTelegramStatus(result);

      // THEN: Status is OFF
      expect(result.status).toBe('OFF');
      expect(result.configured).toBe(true);
      expect(result.enabled).toBe(false);

      // AND: Output shows configuration and enable instructions
      expect(output).toContain('Telegram Notifications: OFF');
      expect(output).toContain('Configuration:');
      expect(output).toContain('Configured (***xyz)');
      expect(output).toContain('Chat ID:   987654321');
      expect(output).toContain('To enable: /oss:telegram on');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.1.3: When configured and enabled, shows ON with ready status
     */
    it('should show ON with ready status when configured and enabled', () => {
      // GIVEN: Telegram is configured and enabled
      settingsStore = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // WHEN: Getting telegram status
      const result = getTelegramStatus();
      const output = formatTelegramStatus(result);

      // THEN: Status is ON
      expect(result.status).toBe('ON');
      expect(result.configured).toBe(true);
      expect(result.enabled).toBe(true);

      // AND: Output shows configuration and ready status
      expect(output).toContain('Telegram Notifications: ON');
      expect(output).toContain('Configuration:');
      expect(output).toContain('Configured (***xyz)');
      expect(output).toContain('Chat ID:   987654321');
      expect(output).toContain('Status:    Ready to send');
    });
  });

  /**
   * E2E Scenario 2: Toggle Flow
   *
   * Tests enabling and disabling notifications:
   * - Cannot enable when not configured
   * - Can enable when configured
   * - Can disable anytime
   * - Settings persist between calls
   */
  describe('Toggle Flow', () => {
    /**
     * @behavior AC-TELEGRAM-E2E.2.1: /oss:telegram on when not configured returns error
     */
    it('should return error when trying to enable unconfigured Telegram', async () => {
      // GIVEN: Telegram is not configured
      settingsStore = {};
      (fs.existsSync as Mock).mockReturnValue(false);

      // WHEN: Trying to enable
      const result = await toggleTelegram('on');

      // THEN: Returns error
      expect(result.success).toBe(false);
      expect(result.message).toContain('Error: Telegram not configured.');
      expect(result.message).toContain('Run /oss:telegram setup first.');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.2.2: /oss:telegram on when configured enables notifications
     */
    it('should enable notifications when Telegram is configured', async () => {
      // GIVEN: Telegram is configured but disabled
      settingsStore = {
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // WHEN: Enabling
      const result = await toggleTelegram('on');

      // THEN: Returns success
      expect(result.success).toBe(true);
      expect(result.message).toContain('Telegram notifications enabled.');

      // AND: Settings are persisted with enabled: true
      expect(settingsStore.telegram).toBeDefined();
      expect((settingsStore.telegram as Record<string, unknown>).enabled).toBe(true);
    });

    /**
     * @behavior AC-TELEGRAM-E2E.2.3: /oss:telegram off disables notifications
     */
    it('should disable notifications when turning off', async () => {
      // GIVEN: Telegram is configured and enabled
      settingsStore = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // WHEN: Disabling
      const result = await toggleTelegram('off');

      // THEN: Returns success
      expect(result.success).toBe(true);
      expect(result.message).toContain('Telegram notifications disabled.');
      expect(result.message).toContain('To re-enable: /oss:telegram on');

      // AND: Settings are persisted with enabled: false
      expect((settingsStore.telegram as Record<string, unknown>).enabled).toBe(false);
    });

    /**
     * @behavior AC-TELEGRAM-E2E.2.4: Settings persist between toggle calls
     */
    it('should persist settings between multiple toggle calls', async () => {
      // GIVEN: Telegram is configured
      settingsStore = {
        notifications: { style: 'visual' },
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // WHEN: Toggle on then off
      await toggleTelegram('on');
      expect((settingsStore.telegram as Record<string, unknown>).enabled).toBe(true);

      await toggleTelegram('off');
      expect((settingsStore.telegram as Record<string, unknown>).enabled).toBe(false);

      await toggleTelegram('on');
      expect((settingsStore.telegram as Record<string, unknown>).enabled).toBe(true);

      // THEN: Other settings are preserved
      expect(settingsStore.notifications).toEqual({ style: 'visual' });

      // AND: Telegram credentials are preserved
      expect((settingsStore.telegram as Record<string, unknown>).botToken).toBe('123456:ABC-DEF-xyz');
      expect((settingsStore.telegram as Record<string, unknown>).chatId).toBe('987654321');
    });
  });

  /**
   * E2E Scenario 3: Setup Flow
   *
   * Tests the setup process:
   * - Invalid token returns error
   * - Valid token but no messages prompts user to message bot
   * - Valid token + messages saves config and sends test
   */
  describe('Setup Flow', () => {
    /**
     * @behavior AC-TELEGRAM-E2E.3.1: Invalid token returns error message
     */
    it('should return error when bot token is invalid', async () => {
      // GIVEN: TelegramService returns invalid token
      mockValidateConfig.mockResolvedValue({
        valid: false,
        errors: ['Invalid bot token'],
        botUsername: undefined,
        canSendToChat: false,
      });

      // WHEN: Running setup with invalid token
      const result = await setupTelegram('invalid-token');
      const output = formatSetupOutput(result);

      // THEN: Returns error at validate step
      expect(result.success).toBe(false);
      expect(result.step).toBe('validate');
      expect(result.message).toContain('Invalid bot token');

      // AND: Output shows validation failure
      expect(output).toContain('Validating bot token...');
      expect(output).toContain('Invalid bot token');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.3.2: Valid token but no messages prompts user
     */
    it('should prompt user to message bot when no messages found', async () => {
      // GIVEN: Token is valid but no messages from user
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_oss_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue(null);

      // WHEN: Running setup
      const result = await setupTelegram('valid-token:ABC');
      const output = formatSetupOutput(result);

      // THEN: Returns error at fetch_chat step
      expect(result.success).toBe(false);
      expect(result.step).toBe('fetch_chat');
      expect(result.botUsername).toBe('my_oss_bot');

      // AND: Output prompts user to message the bot
      expect(output).toContain('Bot token valid: @my_oss_bot');
      expect(output).toContain('No messages found');
      expect(output).toContain('Please send any message to your bot');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.3.3: Valid token + messages saves config and sends test
     */
    it('should complete setup when token is valid and messages exist', async () => {
      // GIVEN: Token is valid and user has messaged the bot
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'my_oss_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '987654321',
        userName: 'JohnDoe',
      });
      mockSendMessage.mockResolvedValue(42);

      // WHEN: Running setup
      const result = await setupTelegram('valid-token:ABC');
      const output = formatSetupOutput(result);

      // THEN: Returns success
      expect(result.success).toBe(true);
      expect(result.step).toBe('test');
      expect(result.botUsername).toBe('my_oss_bot');
      expect(result.chatId).toBe('987654321');
      expect(result.userName).toBe('JohnDoe');

      // AND: Settings are saved with credentials (disabled by default)
      expect(settingsStore.telegram).toBeDefined();
      expect((settingsStore.telegram as Record<string, unknown>).botToken).toBe('valid-token:ABC');
      expect((settingsStore.telegram as Record<string, unknown>).chatId).toBe('987654321');
      expect((settingsStore.telegram as Record<string, unknown>).enabled).toBe(false);

      // AND: Test message was sent
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.stringContaining('connected successfully')
      );

      // AND: Output shows complete flow
      expect(output).toContain('Bot token valid: @my_oss_bot');
      expect(output).toContain('Found chat ID: 987654321');
      expect(output).toContain('from user: JohnDoe');
      expect(output).toContain('Configuration saved');
      expect(output).toContain('Test message sent');
      expect(output).toContain('Setup complete');
      expect(output).toContain('/oss:telegram on');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.3.4: Setup preserves existing settings
     */
    it('should preserve existing settings when saving telegram config', async () => {
      // GIVEN: Existing settings with notifications configured
      settingsStore = {
        notifications: { style: 'audio', verbosity: 'all' },
        supervisor: { mode: 'always' },
        version: 1,
      };

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

      // WHEN: Running setup
      await setupTelegram('new-token:XYZ');

      // THEN: Existing settings are preserved
      expect(settingsStore.notifications).toEqual({ style: 'audio', verbosity: 'all' });
      expect(settingsStore.supervisor).toEqual({ mode: 'always' });
      expect(settingsStore.version).toBe(1);

      // AND: Telegram settings are added
      expect((settingsStore.telegram as Record<string, unknown>).botToken).toBe('new-token:XYZ');
    });
  });

  /**
   * E2E Scenario 4: Notification Flow
   *
   * Tests sending notifications (with mocked Telegram API):
   * - When OFF, notifications are not sent
   * - When ON, workflow complete sends notification
   * - When ON, failed workflow sends notification with blocker info
   */
  describe('Notification Flow', () => {
    /**
     * @behavior AC-TELEGRAM-E2E.4.1: When OFF, notifications are not sent
     */
    it('should not send notifications when Telegram is disabled', async () => {
      // GIVEN: Telegram is configured but disabled
      settingsStore = {
        telegram: {
          enabled: false,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // WHEN: Sending a notification
      const result = await sendTelegramNotification('Build complete!');

      // THEN: Returns success (no-op)
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /**
     * @behavior AC-TELEGRAM-E2E.4.2: When ON, workflow complete sends notification
     */
    it('should send notification when Telegram is enabled', async () => {
      // GIVEN: Telegram is configured and enabled
      settingsStore = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // Mock successful API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 42 } }),
      });

      // WHEN: Sending a workflow complete notification
      const result = await sendTelegramNotification(
        'Build complete! 47/47 tests passing'
      );

      // THEN: Returns success with messageId
      expect(result.success).toBe(true);
      expect(result.messageId).toBe(42);

      // AND: API was called with correct payload
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Build complete! 47/47 tests passing');
      expect(body.chat_id).toBe('987654321');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.4.3: When ON, failed workflow sends notification with blocker
     */
    it('should send notification with blocker info on failed workflow', async () => {
      // GIVEN: Telegram is configured and enabled
      settingsStore = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // Mock successful API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 99 } }),
      });

      // WHEN: Sending a failed workflow notification
      const result = await sendTelegramNotification(
        'Workflow blocked!\n\nBlocker: Test failure in auth.test.ts\nTests: 46/47 passing\n\nRun /oss:debug to investigate'
      );

      // THEN: Returns success with messageId
      expect(result.success).toBe(true);
      expect(result.messageId).toBe(99);

      // AND: Message contains blocker information
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Workflow blocked!');
      expect(body.text).toContain('Blocker:');
      expect(body.text).toContain('auth.test.ts');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.4.4: When ON, notifications with buttons create interactive messages
     */
    it('should send notification with inline keyboard buttons', async () => {
      // GIVEN: Telegram is configured and enabled
      settingsStore = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // Mock successful API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 123 } }),
      });

      // Prepare buttons
      const buttons = [
        [
          { text: 'Fix all', callbackData: 'fix_all' },
          { text: 'Skip', callbackData: 'skip' },
        ],
      ];

      // WHEN: Sending notification with buttons
      const result = await sendTelegramNotification(
        'How would you like to proceed?',
        buttons
      );

      // THEN: Returns success with messageId
      expect(result.success).toBe(true);
      expect(result.messageId).toBe(123);

      // AND: API was called with inline keyboard
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reply_markup).toBeDefined();
      expect(body.reply_markup.inline_keyboard).toHaveLength(1);
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
      expect(body.reply_markup.inline_keyboard[0][0].text).toBe('Fix all');
      expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('fix_all');
    });

    /**
     * @behavior AC-TELEGRAM-E2E.4.5: When not configured, notifications are silently skipped
     */
    it('should silently skip notifications when not configured', async () => {
      // GIVEN: No telegram configuration
      settingsStore = {};
      (fs.existsSync as Mock).mockReturnValue(false);

      // WHEN: Sending a notification
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns success (no-op)
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();

      // AND: API was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /**
     * @behavior AC-TELEGRAM-E2E.4.6: API errors return failure result
     */
    it('should return failure when Telegram API returns error', async () => {
      // GIVEN: Telegram is configured and enabled
      settingsStore = {
        telegram: {
          enabled: true,
          botToken: '123456:ABC-DEF-xyz',
          chatId: '987654321',
        },
      };

      // Mock API error response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ description: 'Unauthorized' }),
      });

      // WHEN: Sending a notification
      const result = await sendTelegramNotification('Test message');

      // THEN: Returns failure with error
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unauthorized');
    });
  });

  /**
   * E2E Scenario 5: Full User Journey
   *
   * Tests the complete flow a user would experience:
   * 1. Check status (NOT_CONFIGURED)
   * 2. Run setup (success)
   * 3. Check status (OFF)
   * 4. Enable notifications
   * 5. Check status (ON)
   * 6. Send notification (success)
   * 7. Disable notifications
   * 8. Send notification (no-op)
   */
  describe('Full User Journey', () => {
    /**
     * @behavior AC-TELEGRAM-E2E.5.1: Complete user journey from setup to notification
     */
    it('should support complete user journey from setup to notification', async () => {
      // Step 1: Initial status is NOT_CONFIGURED
      settingsStore = {};
      (fs.existsSync as Mock).mockImplementation((filePath: string) => {
        if (filePath === '/home/testuser/.oss/settings.json') {
          return Object.keys(settingsStore).length > 0;
        }
        return true;
      });

      let status = getTelegramStatus();
      expect(status.status).toBe('NOT_CONFIGURED');

      // Step 2: Run setup (mock successful setup)
      mockValidateConfig.mockResolvedValue({
        valid: true,
        errors: [],
        botUsername: 'oss_workflow_bot',
        canSendToChat: true,
      });
      mockFetchChatId.mockResolvedValue({
        chatId: '123456789',
        userName: 'DevUser',
      });
      mockSendMessage.mockResolvedValue(1);

      const setupResult = await setupTelegram('valid-token:ABC123');
      expect(setupResult.success).toBe(true);

      // Step 3: Status is now OFF (configured but not enabled)
      status = getTelegramStatus();
      expect(status.status).toBe('OFF');
      expect(status.configured).toBe(true);
      expect(status.enabled).toBe(false);

      // Step 4: Enable notifications
      const enableResult = await toggleTelegram('on');
      expect(enableResult.success).toBe(true);

      // Step 5: Status is now ON
      status = getTelegramStatus();
      expect(status.status).toBe('ON');
      expect(status.enabled).toBe(true);

      // Step 6: Send notification (should succeed)
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 42 } }),
      });

      const notifyResult = await sendTelegramNotification('Workflow complete!');
      expect(notifyResult.success).toBe(true);
      expect(notifyResult.messageId).toBe(42);
      expect(mockFetch).toHaveBeenCalled();

      // Step 7: Disable notifications
      mockFetch.mockClear();
      const disableResult = await toggleTelegram('off');
      expect(disableResult.success).toBe(true);

      // Step 8: Send notification (should be no-op)
      const silentResult = await sendTelegramNotification('This should not be sent');
      expect(silentResult.success).toBe(true);
      expect(silentResult.messageId).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  /**
   * E2E Scenario 6: Button Parsing
   *
   * Tests the parseButtons helper function for CLI input handling
   */
  describe('Button Parsing', () => {
    it('should parse flat array format to nested format', () => {
      const json =
        '[{"text":"Fix all","callbackData":"fix_all"},{"text":"Skip","callbackData":"skip"}]';

      const buttons = parseButtons(json);

      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveLength(2);
      expect(buttons[0][0].text).toBe('Fix all');
      expect(buttons[0][1].callbackData).toBe('skip');
    });

    it('should handle already nested array format', () => {
      const json =
        '[[{"text":"Row1","callbackData":"r1"}],[{"text":"Row2","callbackData":"r2"}]]';

      const buttons = parseButtons(json);

      expect(buttons).toHaveLength(2);
      expect(buttons[0][0].text).toBe('Row1');
      expect(buttons[1][0].text).toBe('Row2');
    });

    it('should return empty array for invalid input', () => {
      expect(parseButtons('not json')).toEqual([]);
      expect(parseButtons('')).toEqual([]);
      expect(parseButtons(undefined)).toEqual([]);
    });
  });
});
