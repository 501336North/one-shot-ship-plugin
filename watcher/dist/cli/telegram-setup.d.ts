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
export interface SetupResult {
    success: boolean;
    step: 'validate' | 'fetch_chat' | 'save' | 'test';
    message: string;
    botUsername?: string;
    chatId?: string;
    userName?: string;
}
/**
 * Main setup function
 *
 * @param botToken The Telegram bot token from BotFather
 * @returns SetupResult with success/failure info
 */
export declare function setupTelegram(botToken: string): Promise<SetupResult>;
/**
 * Format the setup result for display
 */
export declare function formatSetupOutput(result: SetupResult): string;
//# sourceMappingURL=telegram-setup.d.ts.map