#!/usr/bin/env node
/**
 * Telegram Setup CLI
 *
 * Guides users through Telegram bot configuration.
 *
 * @behavior Telegram setup CLI validates token, fetches chat ID, saves config, sends test
 * @acceptance-criteria AC-TELEGRAM-SETUP.1 through AC-TELEGRAM-SETUP.8
 *
 * Usage:
 *   node telegram-setup.js --token "YOUR_BOT_TOKEN"
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error (invalid token, no messages, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TelegramService } from '../services/telegram.js';
import { TelegramConfig } from '../types/telegram.js';

export interface SetupResult {
  success: boolean;
  step: 'validate' | 'fetch_chat' | 'save' | 'test';
  message: string;
  botUsername?: string;
  chatId?: string;
  userName?: string;
}

interface Settings {
  telegram?: TelegramConfig;
  notifications?: Record<string, unknown>;
  supervisor?: Record<string, unknown>;
  version?: number;
}

/**
 * Load settings from settings.json
 */
function loadSettings(settingsPath: string): Settings {
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(content) as Settings;
    }
  } catch {
    // Return empty settings on any error
  }
  return {};
}

/**
 * Save settings to settings.json
 */
function saveSettings(
  configDir: string,
  settingsPath: string,
  settings: Settings
): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Main setup function
 *
 * @param botToken The Telegram bot token from BotFather
 * @returns SetupResult with success/failure info
 */
export async function setupTelegram(botToken: string): Promise<SetupResult> {
  const configDir = path.join(os.homedir(), '.oss');
  const settingsPath = path.join(configDir, 'settings.json');

  // Step 1: Create service with token and validate
  const tempConfig: TelegramConfig = { enabled: false, botToken, chatId: '' };
  const service = new TelegramService(tempConfig);

  let botUsername: string | undefined;

  try {
    const validation = await service.validateConfig();
    if (!validation.valid) {
      return {
        success: false,
        step: 'validate',
        message: 'Invalid bot token. Please check and try again.',
      };
    }
    botUsername = validation.botUsername;
  } catch (error) {
    return {
      success: false,
      step: 'validate',
      message: 'Network error. Please check your connection.',
    };
  }

  // Step 2: Fetch chat ID
  let chatInfo: { chatId: string; userName: string } | null;

  try {
    chatInfo = await service.fetchChatId();
    if (!chatInfo) {
      return {
        success: false,
        step: 'fetch_chat',
        message: 'No messages found.',
        botUsername,
      };
    }
  } catch (error) {
    return {
      success: false,
      step: 'fetch_chat',
      message: 'Network error. Please check your connection.',
      botUsername,
    };
  }

  // Step 3: Save config (preserve existing settings)
  const settings = loadSettings(settingsPath);
  settings.telegram = {
    enabled: false,
    botToken,
    chatId: chatInfo.chatId,
  };
  saveSettings(configDir, settingsPath, settings);

  // Step 4: Send test message
  const fullService = new TelegramService({
    enabled: true,
    botToken,
    chatId: chatInfo.chatId,
  });

  try {
    await fullService.sendMessage(
      'OSS Dev Workflow connected successfully!'
    );
  } catch (error) {
    return {
      success: false,
      step: 'test',
      message: 'Failed to send test message.',
      botUsername,
      chatId: chatInfo.chatId,
      userName: chatInfo.userName,
    };
  }

  return {
    success: true,
    step: 'test',
    message: 'Setup complete!',
    botUsername,
    chatId: chatInfo.chatId,
    userName: chatInfo.userName,
  };
}

/**
 * Format the setup result for display
 */
export function formatSetupOutput(result: SetupResult): string {
  const lines: string[] = [];

  // Step 1: Token validation
  lines.push('Validating bot token...');
  if (result.step === 'validate' && !result.success) {
    lines.push(`X ${result.message}`);
    return lines.join('\n');
  }
  lines.push(`OK Bot token valid: @${result.botUsername}`);
  lines.push('');

  // Step 2: Chat ID fetch
  lines.push('Fetching your chat ID...');
  if (result.step === 'fetch_chat' && !result.success) {
    lines.push(`X ${result.message}`);
    lines.push('');
    lines.push(
      'Please send any message to your bot in Telegram, then run this command again.'
    );
    return lines.join('\n');
  }
  lines.push(`OK Found chat ID: ${result.chatId} (from user: ${result.userName})`);
  lines.push('');

  // Step 3: Save config
  lines.push('Saving configuration...');
  lines.push('OK Configuration saved.');
  lines.push('');

  // Step 4: Test message
  lines.push('Sending test message...');
  if (result.step === 'test' && !result.success) {
    lines.push(`X ${result.message}`);
    return lines.join('\n');
  }
  lines.push('OK Test message sent! Check your Telegram.');
  lines.push('');

  // Success
  lines.push('Setup complete! Telegram notifications are now configured.');
  lines.push('To enable: /oss:telegram on');

  return lines.join('\n');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Parse --token argument
  const tokenIndex = process.argv.indexOf('--token');
  if (tokenIndex === -1 || !process.argv[tokenIndex + 1]) {
    console.log('Usage: telegram-setup --token "YOUR_BOT_TOKEN"');
    console.log('');
    console.log('Get your bot token from @BotFather in Telegram:');
    console.log('1. Open Telegram -> @BotFather -> /newbot');
    console.log('2. Follow the prompts to create your bot');
    console.log('3. Copy the bot token');
    console.log('4. Send any message to your new bot');
    console.log('5. Run this command with your token');
    process.exit(1);
  }

  const botToken = process.argv[tokenIndex + 1];
  const result = await setupTelegram(botToken);
  const output = formatSetupOutput(result);

  console.log(output);
  process.exit(result.success ? 0 : 1);
}

// Main execution - only run when called directly (not when imported)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('telegram-setup.js');

if (isMainModule) {
  main().catch(console.error);
}
