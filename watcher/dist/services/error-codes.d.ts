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
export type ErrorSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RetryCost = 'cheap' | 'expensive';
/**
 * Shared retry cap for structured OSS_ERROR events (ADR-004): once `attempt`
 * reaches this value the watcher stops retrying and escalates. The single source
 * of truth — both the analyzer classifier and the intervention generator import it.
 */
export declare const OSS_ERROR_MAX_RETRIES = 2;
/** The wire contract emitted in-band (stdout) and out-of-band (workflow.log). */
export interface WireError {
    code: string;
    severity: ErrorSeverity;
    source: string;
    message: string;
    retry_eligible: boolean;
    retry_hint?: string;
    retry_cost: RetryCost;
    attempt: number;
    context?: Record<string, unknown>;
}
interface OSSErrorOptions {
    code: string;
    category: ErrorCategory;
    message: string;
    cause: string;
    recovery: string[];
    learnMore: string;
    relatedCommands?: string[];
    severity?: ErrorSeverity;
    source?: string;
    retry_eligible?: boolean;
    retry_hint?: string;
    retry_cost?: RetryCost;
    attempt?: number;
    context?: Record<string, unknown>;
}
export declare class OSSError extends Error {
    code: string;
    category: ErrorCategory;
    cause: string;
    recovery: string[];
    learnMore: string;
    relatedCommands: string[];
    severity: ErrorSeverity;
    source: string;
    retry_eligible: boolean;
    retry_hint?: string;
    retry_cost: RetryCost;
    attempt: number;
    context?: Record<string, unknown>;
    constructor(options: OSSErrorOptions);
    /**
     * Serialize to the wire contract (in-band stdout / out-of-band workflow.log).
     */
    toWireJSON(): WireError;
    /**
     * Validating parse of a wire payload. Throws an Error naming the offending
     * field when a required field is missing or an enum value is invalid.
     */
    static fromWireJSON(value: unknown): OSSError;
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