/**
 * TelegramNotifier - Sends PR review notifications to Telegram
 *
 * @behavior Formats and sends PR review notifications via telegram-bridge service
 * @acceptance-criteria AC-TELEGRAM-NOTIFIER.1 through AC-TELEGRAM-NOTIFIER.8
 */
/**
 * Maximum length for review body before truncation
 */
const MAX_REVIEW_BODY_LENGTH = 200;
/**
 * TelegramNotifier - Sends PR review notifications to Telegram
 */
export class TelegramNotifier {
    telegramBridgeUrl;
    constructor(telegramBridgeUrl) {
        this.telegramBridgeUrl = telegramBridgeUrl;
    }
    /**
     * Send a PR review notification via telegram-bridge service
     *
     * @param info PR review information
     * @throws Error if HTTP request fails
     */
    async sendPRReviewNotification(info) {
        const message = this.formatReviewMessage(info);
        const response = await fetch(`${this.telegramBridgeUrl}/api/notify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });
        if (!response.ok) {
            throw new Error(`Telegram notification failed: ${response.status} ${response.statusText}`);
        }
    }
    /**
     * Format a PR review message for Telegram
     *
     * @param info PR review information
     * @returns Formatted message string with emojis
     */
    formatReviewMessage(info) {
        const { prNumber, prTitle, reviewerName, reviewBody } = info;
        // Truncate review body if too long
        const truncatedBody = reviewBody.length > MAX_REVIEW_BODY_LENGTH
            ? reviewBody.substring(0, MAX_REVIEW_BODY_LENGTH) + '...'
            : reviewBody;
        // Format with emojis for visual distinction
        const lines = [
            `\u{1F534} Changes Requested on PR #${prNumber}`,
            '',
            `\u{1F4DD} ${prTitle}`,
            '',
            `\u{1F464} Reviewer: ${reviewerName}`,
        ];
        // Only add review body section if not empty
        if (truncatedBody) {
            lines.push('', `\u{1F4AC} ${truncatedBody}`);
        }
        return lines.join('\n');
    }
}
//# sourceMappingURL=telegram-notifier.js.map