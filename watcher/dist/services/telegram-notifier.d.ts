/**
 * TelegramNotifier - Sends PR review notifications to Telegram
 *
 * @behavior Formats and sends PR review notifications via telegram-bridge service
 * @acceptance-criteria AC-TELEGRAM-NOTIFIER.1 through AC-TELEGRAM-NOTIFIER.8
 */
/**
 * PR Review information for notification
 */
export interface PRReviewInfo {
    /** PR number */
    prNumber: number;
    /** PR title */
    prTitle: string;
    /** Name of the reviewer */
    reviewerName: string;
    /** Body of the review comment */
    reviewBody: string;
}
/**
 * Structured-error escalation information for notification (US-005)
 */
export interface ErrorEscalationInfo {
    /** OSS error code, e.g. OSS-AUTH-001 */
    code: string;
    /** Error severity */
    severity: string;
    /** Human-readable error message */
    message: string;
    /** Actionable recovery steps from the error registry */
    recovery: string[];
}
/**
 * TelegramNotifier - Sends PR review notifications to Telegram
 */
export declare class TelegramNotifier {
    private telegramBridgeUrl;
    constructor(telegramBridgeUrl: string);
    /**
     * Send a PR review notification via telegram-bridge service
     *
     * @param info PR review information
     * @throws Error if HTTP request fails
     */
    sendPRReviewNotification(info: PRReviewInfo): Promise<void>;
    /**
     * Send a structured-error escalation notification via telegram-bridge service
     *
     * @param info escalation payload (code, severity, message, recovery steps)
     * @throws Error if HTTP request fails
     */
    sendErrorEscalation(info: ErrorEscalationInfo): Promise<void>;
    /**
     * Format a structured-error escalation message for Telegram
     */
    formatEscalationMessage(info: ErrorEscalationInfo): string;
    /**
     * Format a PR review message for Telegram
     *
     * @param info PR review information
     * @returns Formatted message string with emojis
     */
    formatReviewMessage(info: PRReviewInfo): string;
}
//# sourceMappingURL=telegram-notifier.d.ts.map