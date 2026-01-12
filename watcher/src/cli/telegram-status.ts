#!/usr/bin/env node
/**
 * Telegram Status CLI
 *
 * Outputs the current Telegram notification status.
 *
 * @behavior Telegram status CLI outputs current configuration state
 * @acceptance-criteria AC-TELEGRAM-STATUS.1 through AC-TELEGRAM-STATUS.5
 *
 * Usage:
 *   node telegram-status.js
 *
 * Exit codes:
 *   0 - Success
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type TelegramStatusType = 'NOT_CONFIGURED' | 'OFF' | 'ON';

export interface TelegramStatusResult {
  status: TelegramStatusType;
  configured: boolean;
  enabled: boolean;
  botToken?: string;
  chatId?: string;
}

/**
 * Mask a bot token, showing only the last 3 characters
 */
export function maskToken(token: string): string {
  if (!token || token.length < 3) {
    return '***';
  }
  return `***${token.slice(-3)}`;
}

/**
 * Get the current Telegram status from settings
 */
export function getTelegramStatus(): TelegramStatusResult {
  const configDir = path.join(os.homedir(), '.oss');
  const settingsPath = path.join(configDir, 'settings.json');

  try {
    if (!fs.existsSync(settingsPath)) {
      return {
        status: 'NOT_CONFIGURED',
        configured: false,
        enabled: false,
      };
    }

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    const telegram = settings.telegram;

    // Check if telegram section exists and has required fields
    if (!telegram || !telegram.botToken || !telegram.chatId) {
      return {
        status: 'NOT_CONFIGURED',
        configured: false,
        enabled: false,
      };
    }

    // Telegram is configured, check if enabled
    if (!telegram.enabled) {
      return {
        status: 'OFF',
        configured: true,
        enabled: false,
        botToken: telegram.botToken,
        chatId: telegram.chatId,
      };
    }

    // Telegram is configured and enabled
    return {
      status: 'ON',
      configured: true,
      enabled: true,
      botToken: telegram.botToken,
      chatId: telegram.chatId,
    };
  } catch {
    // Handle JSON parse errors or file read errors
    return {
      status: 'NOT_CONFIGURED',
      configured: false,
      enabled: false,
    };
  }
}

/**
 * Format the Telegram status for display
 */
export function formatTelegramStatus(result: TelegramStatusResult): string {
  const lines: string[] = [];

  if (result.status === 'NOT_CONFIGURED') {
    lines.push('Telegram Notifications: NOT CONFIGURED');
    lines.push('');
    lines.push('Setup Instructions:');
    lines.push('1. Create a bot: Open Telegram -> @BotFather -> /newbot');
    lines.push('2. Copy the bot token');
    lines.push('3. Message your bot (any message)');
    lines.push('4. Run: /oss:telegram setup');
  } else if (result.status === 'OFF') {
    lines.push('Telegram Notifications: OFF');
    lines.push('');
    lines.push('Configuration:');
    lines.push(`  Bot Token: Configured (${maskToken(result.botToken || '')})`);
    lines.push(`  Chat ID:   ${result.chatId}`);
    lines.push('');
    lines.push('To enable: /oss:telegram on');
  } else {
    // ON
    lines.push('Telegram Notifications: ON');
    lines.push('');
    lines.push('Configuration:');
    lines.push(`  Bot Token: Configured (${maskToken(result.botToken || '')})`);
    lines.push(`  Chat ID:   ${result.chatId}`);
    lines.push(`  Status:    Ready to send`);
  }

  return lines.join('\n');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const result = getTelegramStatus();
  const output = formatTelegramStatus(result);
  console.log(output);
}

// Main execution - only run when called directly (not when imported)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('telegram-status.js');

if (isMainModule) {
  main().catch(console.error);
}
