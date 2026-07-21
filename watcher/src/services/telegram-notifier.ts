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
 * Maximum length for review body before truncation
 */
const MAX_REVIEW_BODY_LENGTH = 200;

/**
 * TelegramNotifier - Sends PR review notifications to Telegram
 */
export class TelegramNotifier {
  constructor(private telegramBridgeUrl: string) {}

  /**
   * Send a PR review notification via telegram-bridge service
   *
   * @param info PR review information
   * @throws Error if HTTP request fails
   */
  async sendPRReviewNotification(info: PRReviewInfo): Promise<void> {
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
   * Send a structured-error escalation notification via telegram-bridge service
   *
   * @param info escalation payload (code, severity, message, recovery steps)
   * @throws Error if HTTP request fails
   */
  async sendErrorEscalation(info: ErrorEscalationInfo): Promise<void> {
    const message = this.formatEscalationMessage(info);

    const response = await fetch(`${this.telegramBridgeUrl}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`Telegram escalation failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Format a structured-error escalation message for Telegram
   */
  formatEscalationMessage(info: ErrorEscalationInfo): string {
    const lines = [
      `\u{1F6A8} ${info.severity} escalation: ${info.code}`,
      '',
      info.message,
      '',
      'Recovery:',
      ...info.recovery.map((step) => `\u{2022} ${step}`),
    ];
    return lines.join('\n');
  }

  /**
   * Format a PR review message for Telegram
   *
   * @param info PR review information
   * @returns Formatted message string with emojis
   */
  formatReviewMessage(info: PRReviewInfo): string {
    const { prNumber, prTitle, reviewerName, reviewBody } = info;

    // Truncate review body if too long
    const truncatedBody =
      reviewBody.length > MAX_REVIEW_BODY_LENGTH
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
