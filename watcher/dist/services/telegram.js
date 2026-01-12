/**
 * TelegramService - Send notifications and await responses via Telegram Bot API
 *
 * @behavior Telegram notifications are sent when enabled and configured
 * @acceptance-criteria AC-TELEGRAM.1 through AC-TELEGRAM.10
 */
export class TelegramService {
    config;
    baseUrl;
    constructor(config) {
        this.config = config;
        this.baseUrl = `https://api.telegram.org/bot${config.botToken}`;
    }
    /**
     * Check if Telegram is configured (has token and chatId)
     */
    isConfigured() {
        return !!(this.config.botToken && this.config.chatId);
    }
    /**
     * Check if Telegram is enabled AND configured
     */
    isEnabled() {
        return this.config.enabled && this.isConfigured();
    }
    /**
     * Send a message to the configured chat
     * @param text Message text
     * @param buttons Optional inline keyboard buttons
     * @returns Message ID on success, null if disabled
     */
    async sendMessage(text, buttons) {
        if (!this.isEnabled()) {
            return null;
        }
        const body = {
            chat_id: this.config.chatId,
            text,
            parse_mode: 'Markdown',
        };
        if (buttons && buttons.length > 0) {
            body.reply_markup = {
                inline_keyboard: buttons.map(row => row.map(btn => ({
                    text: btn.text,
                    callback_data: btn.callbackData,
                }))),
            };
        }
        const response = await fetch(`${this.baseUrl}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = (await response.json());
            throw new Error(`Telegram API error: ${error.description || response.status}`);
        }
        const data = (await response.json());
        const result = data.result;
        return result.message_id;
    }
    /**
     * Send a fire-and-forget notification (no buttons, swallows errors)
     * @param text Notification text
     */
    async notify(text) {
        if (!this.isEnabled()) {
            return;
        }
        try {
            await fetch(`${this.baseUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.config.chatId,
                    text,
                    parse_mode: 'Markdown',
                }),
            });
        }
        catch {
            // Fire-and-forget: silently ignore errors
        }
    }
    /**
     * Poll for a callback query response to a specific message
     * @param messageId The message ID to wait for callback on
     * @param options Polling options
     * @returns The callback data, or null if timeout/disabled
     */
    async awaitCallback(messageId, options = {}) {
        if (!this.isEnabled()) {
            return null;
        }
        const { timeoutMs, pollIntervalMs = 1000 } = options;
        const startTime = Date.now();
        let lastUpdateId = 0;
        while (true) {
            // Check timeout
            if (timeoutMs && Date.now() - startTime > timeoutMs) {
                return null;
            }
            try {
                const response = await fetch(`${this.baseUrl}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`, { method: 'GET' });
                if (!response.ok)
                    continue;
                const data = (await response.json());
                const updates = data.result || [];
                for (const update of updates) {
                    lastUpdateId = Math.max(lastUpdateId, update.update_id);
                    if (update.callback_query &&
                        update.callback_query.message?.message_id === messageId) {
                        const callbackQuery = update.callback_query;
                        // Answer the callback query (removes loading state)
                        await fetch(`${this.baseUrl}/answerCallbackQuery`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ callback_query_id: callbackQuery.id }),
                        });
                        // Remove inline keyboard
                        await fetch(`${this.baseUrl}/editMessageReplyMarkup`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: this.config.chatId,
                                message_id: messageId,
                                reply_markup: { inline_keyboard: [] },
                            }),
                        });
                        return callbackQuery.data;
                    }
                }
            }
            catch {
                // Ignore errors and continue polling
            }
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
    }
    /**
     * Validate the Telegram configuration
     * @returns Validation result with errors if any
     */
    async validateConfig() {
        const errors = [];
        let botUsername;
        let canSendToChat = false;
        // Check bot token via getMe
        try {
            const meResponse = await fetch(`${this.baseUrl}/getMe`, { method: 'GET' });
            if (!meResponse.ok) {
                errors.push('Invalid bot token');
                return { valid: false, errors, canSendToChat: false };
            }
            const meData = (await meResponse.json());
            const meResult = meData.result;
            botUsername = meResult?.username;
        }
        catch {
            errors.push('Invalid bot token');
            return { valid: false, errors, canSendToChat: false };
        }
        // Test sending to chat
        try {
            const testResponse = await fetch(`${this.baseUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.config.chatId,
                    text: '🔧 OSS Telegram setup test (this message will be deleted)',
                }),
            });
            if (!testResponse.ok) {
                errors.push('Cannot send to chat');
                return { valid: false, errors, botUsername, canSendToChat: false };
            }
            const testData = (await testResponse.json());
            const testResult = testData.result;
            canSendToChat = true;
            // Delete the test message
            await fetch(`${this.baseUrl}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.config.chatId,
                    message_id: testResult.message_id,
                }),
            });
        }
        catch {
            errors.push('Cannot send to chat');
            return { valid: false, errors, botUsername, canSendToChat: false };
        }
        return { valid: true, errors, botUsername, canSendToChat };
    }
    /**
     * Fetch the chat ID from recent updates (for setup)
     * @returns Chat ID and user name, or null if not found
     */
    async fetchChatId() {
        try {
            const response = await fetch(`${this.baseUrl}/getUpdates`, {
                method: 'GET',
            });
            if (!response.ok) {
                return null;
            }
            const data = (await response.json());
            const updates = data.result || [];
            // Find the most recent message
            for (const update of [...updates].reverse()) {
                if (update.message?.chat?.id) {
                    return {
                        chatId: String(update.message.chat.id),
                        userName: update.message.from?.first_name || 'Unknown',
                    };
                }
            }
            return null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=telegram.js.map