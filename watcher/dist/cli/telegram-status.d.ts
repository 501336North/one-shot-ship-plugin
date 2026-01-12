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
export declare function maskToken(token: string): string;
/**
 * Get the current Telegram status from settings
 */
export declare function getTelegramStatus(): TelegramStatusResult;
/**
 * Format the Telegram status for display
 */
export declare function formatTelegramStatus(result: TelegramStatusResult): string;
//# sourceMappingURL=telegram-status.d.ts.map