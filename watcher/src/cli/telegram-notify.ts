#!/usr/bin/env node
/**
 * Telegram Notify CLI
 *
 * Sends Telegram notifications from shell scripts.
 *
 * @behavior Telegram notification CLI sends messages when enabled and configured
 * @acceptance-criteria AC-TELEGRAM-NOTIFY.1 through AC-TELEGRAM-NOTIFY.5
 *
 * Usage:
 *   node telegram-notify.js --message "Build complete! 47/47 tests passing"
 *   node telegram-notify.js --message "How to proceed?" --buttons '[{"text":"Fix all","callbackData":"fix_all"}]'
 *   node telegram-notify.js --message "Choose option" --buttons '[...]' --wait
 *
 * Exit codes:
 *   0 - Success (or no-op when disabled/not configured)
 *   1 - Failure
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TelegramButton } from '../types/telegram.js';

export interface NotificationResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

/**
 * Load Telegram settings from ~/.oss/settings.json
 */
function loadTelegramSettings(): TelegramSettings | null {
  const configDir = path.join(os.homedir(), '.oss');
  const settingsPath = path.join(configDir, 'settings.json');

  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    const telegram = settings.telegram;
    if (!telegram || !telegram.botToken || !telegram.chatId) {
      return null;
    }

    return {
      enabled: telegram.enabled === true,
      botToken: telegram.botToken,
      chatId: telegram.chatId,
    };
  } catch {
    return null;
  }
}

/**
 * Parse buttons JSON string to TelegramButton array
 * Accepts flat array or nested array format
 */
export function parseButtons(json: string | undefined): TelegramButton[][] {
  if (!json) {
    return [];
  }

  try {
    const parsed = JSON.parse(json);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [];
    }

    // Check if it's already nested (2D array)
    if (Array.isArray(parsed[0]) && parsed[0].length > 0 && typeof parsed[0][0] === 'object') {
      return parsed as TelegramButton[][];
    }

    // Flat array - wrap in single row
    return [parsed as TelegramButton[]];
  } catch {
    return [];
  }
}

/**
 * Send a Telegram notification
 *
 * @param message Message text to send
 * @param buttons Optional inline keyboard buttons
 * @returns Result with success status and optional messageId
 */
export async function sendTelegramNotification(
  message: string,
  buttons?: TelegramButton[][]
): Promise<NotificationResult> {
  const settings = loadTelegramSettings();

  // If not configured or disabled, return success (no-op)
  if (!settings || !settings.enabled) {
    return { success: true };
  }

  const baseUrl = `https://api.telegram.org/bot${settings.botToken}`;

  try {
    const body: Record<string, unknown> = {
      chat_id: settings.chatId,
      text: message,
      parse_mode: 'Markdown',
    };

    if (buttons && buttons.length > 0) {
      body.reply_markup = {
        inline_keyboard: buttons.map(row =>
          row.map(btn => ({
            text: btn.text,
            callback_data: btn.callbackData,
          }))
        ),
      };
    }

    const response = await fetch(`${baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json() as { description?: string };
      return {
        success: false,
        error: `Telegram API error: ${error.description || response.status}`,
      };
    }

    const data = await response.json() as { result: { message_id: number } };
    return {
      success: true,
      messageId: data.result.message_id,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Wait for a callback response to a specific message
 *
 * @param messageId The message ID to wait for callback on
 * @param options Polling options
 * @returns The callback data, or null if timeout/disabled
 */
export async function waitForCallback(
  messageId: number,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<string | null> {
  const settings = loadTelegramSettings();

  // If not configured or disabled, return null
  if (!settings || !settings.enabled) {
    return null;
  }

  const baseUrl = `https://api.telegram.org/bot${settings.botToken}`;
  const { timeoutMs, pollIntervalMs = 1000 } = options;
  const startTime = Date.now();
  let lastUpdateId = 0;

  while (true) {
    // Check timeout
    if (timeoutMs && Date.now() - startTime > timeoutMs) {
      return null;
    }

    try {
      const response = await fetch(
        `${baseUrl}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`,
        { method: 'GET' }
      );

      if (!response.ok) continue;

      const data = await response.json() as { result?: Array<{ update_id: number; callback_query?: { id: string; message?: { message_id: number }; data?: string } }> };
      const updates = data.result || [];

      for (const update of updates) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);

        if (
          update.callback_query &&
          update.callback_query.message?.message_id === messageId
        ) {
          const callbackQuery = update.callback_query;

          // Answer the callback query (removes loading state)
          await fetch(`${baseUrl}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id }),
          });

          // Remove inline keyboard
          await fetch(`${baseUrl}/editMessageReplyMarkup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: settings.chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [] },
            }),
          });

          return callbackQuery.data ?? null;
        }
      }
    } catch {
      // Ignore errors and continue polling
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Main entry point for CLI
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let message = '';
  let buttonsJson = '';
  let wait = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--message' && args[i + 1]) {
      message = args[++i];
    } else if (args[i] === '--buttons' && args[i + 1]) {
      buttonsJson = args[++i];
    } else if (args[i] === '--wait') {
      wait = true;
    }
  }

  if (!message) {
    console.error('Error: --message is required');
    process.exit(1);
  }

  const buttons = parseButtons(buttonsJson);
  const result = await sendTelegramNotification(message, buttons.length > 0 ? buttons : undefined);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (wait && result.messageId) {
    const callbackData = await waitForCallback(result.messageId);
    if (callbackData) {
      console.log(callbackData);
    }
  } else if (result.messageId) {
    console.log(`Message sent: ${result.messageId}`);
  }

  process.exit(0);
}

// Main execution - only run when called directly (not when imported)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('telegram-notify.js');

if (isMainModule) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
