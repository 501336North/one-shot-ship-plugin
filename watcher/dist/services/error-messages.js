/**
 * Error Messages Service
 *
 * Stripe-quality error messages that are:
 * - Clear: What happened
 * - Actionable: How to fix it
 * - Helpful: Links to docs
 */
export const ERROR_CODES = {
    AUTH_FAILED: 'AUTH_FAILED',
    SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    PROMPT_NOT_FOUND: 'PROMPT_NOT_FOUND',
    RATE_LIMITED: 'RATE_LIMITED',
    SERVER_ERROR: 'SERVER_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    CONFIG_ERROR: 'CONFIG_ERROR',
};
const ERROR_MESSAGES = {
    AUTH_FAILED: {
        message: 'Authentication failed',
        reason: 'Your API key is invalid or has expired',
        fix: 'Run /oss:login to authenticate with a valid API key',
        docsUrl: 'https://www.oneshotship.com/docs/authentication',
    },
    SUBSCRIPTION_EXPIRED: {
        message: 'Subscription expired',
        reason: 'Your subscription has ended or payment failed',
        fix: 'Visit https://www.oneshotship.com/pricing to renew',
        docsUrl: 'https://www.oneshotship.com/pricing',
    },
    NETWORK_ERROR: {
        message: 'Network connection failed',
        reason: 'Unable to reach the OSS API server',
        fix: 'Check your internet connection and try again',
        docsUrl: 'https://www.oneshotship.com/docs/troubleshooting',
    },
    PROMPT_NOT_FOUND: {
        message: 'Prompt not found',
        reason: 'The requested command or agent does not exist',
        fix: 'Check the command name and try again. Run /oss:help for available commands',
        docsUrl: 'https://www.oneshotship.com/docs/commands',
    },
    RATE_LIMITED: {
        message: 'Rate limit exceeded',
        reason: 'Too many requests in a short period',
        fix: 'Wait a moment and try again. Consider upgrading for higher limits',
        docsUrl: 'https://www.oneshotship.com/docs/rate-limits',
    },
    SERVER_ERROR: {
        message: 'Server error',
        reason: 'The OSS API encountered an unexpected error',
        fix: 'Try again in a few minutes. If the issue persists, contact support@oneshotship.com',
        docsUrl: 'https://www.oneshotship.com/docs/support',
    },
    INVALID_INPUT: {
        message: 'Invalid input',
        reason: 'The provided input is malformed or missing required fields',
        fix: 'Check the command syntax and try again',
        docsUrl: 'https://www.oneshotship.com/docs/commands',
    },
    CONFIG_ERROR: {
        message: 'Configuration error',
        reason: 'Your OSS configuration is invalid or missing',
        fix: 'Run /oss:login to reconfigure',
        docsUrl: 'https://www.oneshotship.com/docs/setup',
    },
};
const SENSITIVE_KEYS = ['apiKey', 'password', 'secret', 'token', 'key', 'credential'];
/**
 * Sanitize context to remove sensitive data
 */
function sanitizeContext(context) {
    const sanitized = {};
    for (const [key, value] of Object.entries(context)) {
        const lowerKey = key.toLowerCase();
        const isSensitive = SENSITIVE_KEYS.some(sk => lowerKey.includes(sk));
        if (isSensitive) {
            sanitized[key] = '[REDACTED]';
        }
        else if (typeof value === 'string' && value.startsWith('ak_')) {
            sanitized[key] = '[REDACTED]';
        }
        else if (key === 'stack') {
            // Don't include stack traces
            continue;
        }
        else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}
/**
 * Format an error with helpful context
 */
export function formatError(code, context = {}) {
    const errorCode = code;
    const template = ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.SERVER_ERROR;
    const safeContext = sanitizeContext(context);
    // Build reason with context if available
    let reason = template.reason;
    if (safeContext.reason && typeof safeContext.reason === 'string') {
        reason = safeContext.reason;
    }
    return {
        code: errorCode,
        message: template.message,
        reason,
        fix: template.fix,
        docsUrl: template.docsUrl,
    };
}
/**
 * Map HTTP status codes to error codes
 */
export function httpStatusToErrorCode(status) {
    switch (status) {
        case 401:
            return 'AUTH_FAILED';
        case 403:
            return 'SUBSCRIPTION_EXPIRED';
        case 404:
            return 'PROMPT_NOT_FOUND';
        case 429:
            return 'RATE_LIMITED';
        case 500:
        case 502:
        case 503:
        case 504:
            return 'SERVER_ERROR';
        default:
            return 'SERVER_ERROR';
    }
}
/**
 * Format error for terminal display
 */
export function formatErrorForTerminal(code, context = {}) {
    const error = formatError(code, context);
    const lines = [
        `\x1b[31mError:\x1b[0m ${error.message}`,
        ``,
        `\x1b[33mWhy:\x1b[0m ${error.reason}`,
        ``,
        `\x1b[32mFix:\x1b[0m ${error.fix}`,
    ];
    if (error.docsUrl) {
        lines.push(``, `\x1b[34mDocs:\x1b[0m ${error.docsUrl}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=error-messages.js.map