/**
 * Error Code System
 *
 * Provides structured, actionable error information following
 * Stripe's DevEx excellence model. Every error has:
 * - Unique code (OSS-CATEGORY-NNN)
 * - Human-readable message
 * - Technical cause
 * - Recovery steps
 * - Documentation link
 */
export declare enum ErrorCategory {
    AUTH = "auth",
    WORKFLOW = "workflow",
    TDD = "tdd",
    GIT = "git",
    CONFIG = "config",
    API = "api"
}
interface OSSErrorOptions {
    code: string;
    category: ErrorCategory;
    message: string;
    cause: string;
    recovery: string[];
    learnMore: string;
    relatedCommands?: string[];
}
export declare class OSSError extends Error {
    code: string;
    category: ErrorCategory;
    cause: string;
    recovery: string[];
    learnMore: string;
    relatedCommands: string[];
    constructor(options: OSSErrorOptions);
    /**
     * Format error for full display
     */
    format(): string;
    /**
     * Format error as compact single line
     */
    formatCompact(): string;
}
/**
 * Registry of all predefined OSS errors
 */
export declare class ErrorRegistry {
    private errors;
    constructor();
    private registerPredefinedErrors;
    /**
     * Register an error in the registry
     */
    register(error: OSSError): void;
    /**
     * Get error by code
     */
    getError(code: string): OSSError | undefined;
    /**
     * Get all errors by category
     */
    getByCategory(category: ErrorCategory): OSSError[];
    /**
     * Get all registered errors
     */
    getAllErrors(): OSSError[];
}
export {};
//# sourceMappingURL=error-codes.d.ts.map