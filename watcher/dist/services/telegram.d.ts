/**
 * TelegramService - Send notifications and await responses via Telegram Bot API
 *
 * @behavior Telegram notifications are sent when enabled and configured
 * @acceptance-criteria AC-TELEGRAM.1 through AC-TELEGRAM.10
 */
import { TelegramConfig, TelegramButton } from '../types/telegram.js';
export declare class TelegramService {
    private config;
    private baseUrl;
    constructor(config: TelegramConfig);
    /**
     * Check if Telegram is configured (has token and chatId)
     */
    isConfigured(): boolean;
    /**
     * Check if Telegram is enabled AND configured
     */
    isEnabled(): boolean;
    /**
     * Send a message to the configured chat
     * @param text Message text
     * @param buttons Optional inline keyboard buttons
     * @returns Message ID on success, null if disabled
     */
    sendMessage(text: string, buttons?: TelegramButton[][]): Promise<number | null>;
    /**
     * Send a fire-and-forget notification (no buttons, swallows errors)
     * @param text Notification text
     */
    notify(text: string): Promise<void>;
    /**
     * Poll for a callback query response to a specific message
     * @param messageId The message ID to wait for callback on
     * @param options Polling options
     * @returns The callback data, or null if timeout/disabled
     */
    awaitCallback(messageId: number, options?: {
        timeoutMs?: number;
        pollIntervalMs?: number;
    }): Promise<string | null>;
    /**
     * Validate the Telegram configuration
     * @returns Validation result with errors if any
     */
    validateConfig(): Promise<{
        valid: boolean;
        errors: string[];
        botUsername?: string;
        canSendToChat?: boolean;
    }>;
    /**
     * Fetch the chat ID from recent updates (for setup)
     * @returns Chat ID and user name, or null if not found
     */
    fetchChatId(): Promise<{
        chatId: string;
        userName: string;
    } | null>;
}
//# sourceMappingURL=telegram.d.ts.map