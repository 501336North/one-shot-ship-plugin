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
import { TelegramButton } from '../types/telegram.js';
export interface NotificationResult {
    success: boolean;
    messageId?: number;
    error?: string;
}
/**
 * Parse buttons JSON string to TelegramButton array
 * Accepts flat array or nested array format
 */
export declare function parseButtons(json: string | undefined): TelegramButton[][];
/**
 * Send a Telegram notification
 *
 * @param message Message text to send
 * @param buttons Optional inline keyboard buttons
 * @returns Result with success status and optional messageId
 */
export declare function sendTelegramNotification(message: string, buttons?: TelegramButton[][]): Promise<NotificationResult>;
/**
 * Wait for a callback response to a specific message
 *
 * @param messageId The message ID to wait for callback on
 * @param options Polling options
 * @returns The callback data, or null if timeout/disabled
 */
export declare function waitForCallback(messageId: number, options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
}): Promise<string | null>;
//# sourceMappingURL=telegram-notify.d.ts.map