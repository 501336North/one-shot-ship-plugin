/**
 * Error Messages Service
 *
 * Stripe-quality error messages that are:
 * - Clear: What happened
 * - Actionable: How to fix it
 * - Helpful: Links to docs
 */
export declare const ERROR_CODES: {
    readonly AUTH_FAILED: "AUTH_FAILED";
    readonly SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED";
    readonly NETWORK_ERROR: "NETWORK_ERROR";
    readonly PROMPT_NOT_FOUND: "PROMPT_NOT_FOUND";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly SERVER_ERROR: "SERVER_ERROR";
    readonly INVALID_INPUT: "INVALID_INPUT";
    readonly CONFIG_ERROR: "CONFIG_ERROR";
};
type ErrorCode = keyof typeof ERROR_CODES;
interface FormattedError {
    code: string;
    message: string;
    reason?: string;
    fix: string;
    docsUrl?: string;
}
/**
 * Format an error with helpful context
 */
export declare function formatError(code: ErrorCode | string, context?: Record<string, unknown>): FormattedError;
/**
 * Map HTTP status codes to error codes
 */
export declare function httpStatusToErrorCode(status: number): ErrorCode;
/**
 * Format error for terminal display
 */
export declare function formatErrorForTerminal(code: ErrorCode | string, context?: Record<string, unknown>): string;
export {};
//# sourceMappingURL=error-messages.d.ts.map