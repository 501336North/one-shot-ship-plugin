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
export var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["AUTH"] = "auth";
    ErrorCategory["WORKFLOW"] = "workflow";
    ErrorCategory["TDD"] = "tdd";
    ErrorCategory["GIT"] = "git";
    ErrorCategory["CONFIG"] = "config";
    ErrorCategory["API"] = "api";
})(ErrorCategory || (ErrorCategory = {}));
/**
 * Shared retry cap for structured OSS_ERROR events (ADR-004): once `attempt`
 * reaches this value the watcher stops retrying and escalates. The single source
 * of truth — both the analyzer classifier and the intervention generator import it.
 */
export const OSS_ERROR_MAX_RETRIES = 2;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const RETRY_COSTS = ['cheap', 'expensive'];
function isErrorSeverity(value) {
    return typeof value === 'string' && SEVERITIES.includes(value);
}
function isRetryCost(value) {
    return typeof value === 'string' && RETRY_COSTS.includes(value);
}
function isErrorCategory(value) {
    return Object.values(ErrorCategory).includes(value);
}
// ANSI color codes
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};
export class OSSError extends Error {
    code;
    category;
    cause;
    recovery;
    learnMore;
    relatedCommands;
    severity;
    source;
    retry_eligible;
    retry_hint;
    retry_cost;
    attempt;
    context;
    constructor(options) {
        super(options.message);
        this.name = 'OSSError';
        this.code = options.code;
        this.category = options.category;
        this.cause = options.cause;
        this.recovery = options.recovery;
        this.learnMore = options.learnMore;
        this.relatedCommands = options.relatedCommands ?? [];
        this.severity = options.severity ?? 'MEDIUM';
        this.source = options.source ?? 'unknown';
        this.retry_eligible = options.retry_eligible ?? false;
        this.retry_hint = options.retry_hint;
        this.retry_cost = options.retry_cost ?? 'cheap';
        this.attempt = options.attempt ?? 0;
        this.context = options.context;
    }
    /**
     * Serialize to the wire contract (in-band stdout / out-of-band workflow.log).
     */
    toWireJSON() {
        const wire = {
            code: this.code,
            severity: this.severity,
            source: this.source,
            message: this.message,
            retry_eligible: this.retry_eligible,
            retry_cost: this.retry_cost,
            attempt: this.attempt,
        };
        if (this.retry_hint !== undefined) {
            wire.retry_hint = this.retry_hint;
        }
        if (this.context !== undefined) {
            wire.context = this.context;
        }
        return wire;
    }
    /**
     * Validating parse of a wire payload. Throws an Error naming the offending
     * field when a required field is missing or an enum value is invalid.
     */
    static fromWireJSON(value) {
        if (typeof value !== 'object' || value === null) {
            throw new Error('OSSError.fromWireJSON: payload must be an object');
        }
        const obj = value;
        const requireField = (field, check, expected) => {
            if (!(field in obj)) {
                throw new Error(`OSSError.fromWireJSON: missing required field "${field}"`);
            }
            if (!check(obj[field])) {
                throw new Error(`OSSError.fromWireJSON: invalid value for "${field}" (expected ${expected}): ${String(obj[field])}`);
            }
        };
        requireField('code', (v) => typeof v === 'string' && v.length > 0, 'non-empty string');
        requireField('severity', isErrorSeverity, SEVERITIES.join('|'));
        requireField('source', (v) => typeof v === 'string', 'string');
        requireField('message', (v) => typeof v === 'string' && v.length > 0, 'non-empty string');
        requireField('retry_eligible', (v) => typeof v === 'boolean', 'boolean');
        requireField('retry_cost', isRetryCost, RETRY_COSTS.join('|'));
        requireField('attempt', (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0, 'non-negative integer');
        if ('retry_hint' in obj && obj.retry_hint !== undefined && typeof obj.retry_hint !== 'string') {
            throw new Error('OSSError.fromWireJSON: invalid value for "retry_hint" (expected string)');
        }
        if ('context' in obj &&
            obj.context !== undefined &&
            (typeof obj.context !== 'object' || obj.context === null || Array.isArray(obj.context))) {
            throw new Error('OSSError.fromWireJSON: invalid value for "context" (expected object)');
        }
        const code = obj.code;
        const categorySegment = (code.split('-')[1] ?? '').toLowerCase();
        const category = isErrorCategory(categorySegment) ? categorySegment : ErrorCategory.WORKFLOW;
        const message = obj.message;
        return new OSSError({
            code,
            category,
            message,
            cause: message,
            recovery: [],
            learnMore: '',
            severity: obj.severity,
            source: obj.source,
            retry_eligible: obj.retry_eligible,
            retry_hint: obj.retry_hint,
            retry_cost: obj.retry_cost,
            attempt: obj.attempt,
            context: obj.context,
        });
    }
    /**
     * Format error for full display
     */
    format() {
        const lines = [
            `${COLORS.red}${COLORS.bold}Error: ${this.code}${COLORS.reset}`,
            `${COLORS.red}${this.message}${COLORS.reset}`,
            '',
            `${COLORS.yellow}Cause:${COLORS.reset} ${this.cause}`,
            '',
            `${COLORS.cyan}Recovery:${COLORS.reset}`,
        ];
        for (const step of this.recovery) {
            lines.push(`  • ${step}`);
        }
        if (this.relatedCommands.length > 0) {
            lines.push('');
            lines.push(`${COLORS.blue}Related Commands:${COLORS.reset} ${this.relatedCommands.join(', ')}`);
        }
        lines.push('');
        lines.push(`${COLORS.dim}Learn more: ${this.learnMore}${COLORS.reset}`);
        return lines.join('\n');
    }
    /**
     * Format error as compact single line
     */
    formatCompact() {
        return `${COLORS.red}[${this.code}]${COLORS.reset} ${this.message}`;
    }
}
/**
 * Registry of all predefined OSS errors
 */
export class ErrorRegistry {
    errors;
    constructor() {
        this.errors = new Map();
        this.registerPredefinedErrors();
    }
    registerPredefinedErrors() {
        // AUTH errors
        this.register(new OSSError({
            code: 'OSS-AUTH-001',
            category: ErrorCategory.AUTH,
            message: 'Invalid or expired API key',
            cause: 'The API key provided is not valid or has expired',
            recovery: [
                'Run /oss:login to re-authenticate',
                'Check your API key at https://www.oneshotship.com/dashboard',
                'Generate a new API key if needed',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/auth/001',
            relatedCommands: ['/oss:login', '/oss:status'],
            severity: 'HIGH',
            retry_eligible: false,
            retry_cost: 'cheap',
        }));
        this.register(new OSSError({
            code: 'OSS-AUTH-002',
            category: ErrorCategory.AUTH,
            message: 'Subscription expired',
            cause: 'Your OSS subscription has expired or been cancelled',
            recovery: [
                'Renew your subscription at https://www.oneshotship.com/pricing',
                'Check subscription status with /oss:status',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/auth/002',
            relatedCommands: ['/oss:status'],
            severity: 'HIGH',
            retry_eligible: false,
            retry_cost: 'cheap',
        }));
        this.register(new OSSError({
            code: 'OSS-AUTH-003',
            category: ErrorCategory.AUTH,
            message: 'Not authenticated',
            cause: 'No API key found in configuration',
            recovery: [
                'Run /oss:login to authenticate',
                'Register at https://www.oneshotship.com if you don\'t have an account',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/auth/003',
            relatedCommands: ['/oss:login'],
        }));
        // TDD errors
        this.register(new OSSError({
            code: 'OSS-TDD-001',
            category: ErrorCategory.TDD,
            message: 'Tests are failing',
            cause: 'One or more test assertions did not pass',
            recovery: [
                'Run /oss:debug to investigate the failing tests',
                'Check the test output for specific assertion errors',
                'Fix the failing tests before proceeding',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/tdd/001',
            relatedCommands: ['/oss:debug', '/oss:red', '/oss:green'],
        }));
        this.register(new OSSError({
            code: 'OSS-TDD-002',
            category: ErrorCategory.TDD,
            message: 'Code written before test',
            cause: 'Production code was detected without a corresponding failing test',
            recovery: [
                'Delete the untested code',
                'Write a failing test first using /oss:red',
                'Then implement the minimal code to pass using /oss:green',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/tdd/002',
            relatedCommands: ['/oss:red', '/oss:green', '/oss:refactor'],
        }));
        this.register(new OSSError({
            code: 'OSS-TDD-003',
            category: ErrorCategory.TDD,
            message: 'Flaky test detected',
            cause: 'Test passes sometimes and fails other times',
            recovery: [
                'Fix the root cause of the flakiness',
                'Check for shared state, timing issues, or external dependencies',
                'If unfixable, delete the test (deleted test > flaky test)',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/tdd/003',
            relatedCommands: ['/oss:debug', '/oss:test'],
        }));
        // GIT errors
        this.register(new OSSError({
            code: 'OSS-GIT-001',
            category: ErrorCategory.GIT,
            message: 'On protected branch (main/master)',
            cause: 'IRON LAW #4 violation: agents must never work on main branch',
            recovery: [
                'Create a feature branch: git checkout -b feat/agent-<feature>',
                'Move any uncommitted changes: git stash && git stash pop',
                'Continue work on the feature branch',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/git/001',
            relatedCommands: ['/oss:ship'],
        }));
        this.register(new OSSError({
            code: 'OSS-GIT-002',
            category: ErrorCategory.GIT,
            message: 'Uncommitted changes detected',
            cause: 'There are modified files that have not been committed',
            recovery: [
                'Run /oss:ship to commit and create PR',
                'Or stash changes: git stash',
                'Or discard changes: git checkout -- .',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/git/002',
            relatedCommands: ['/oss:ship'],
        }));
        this.register(new OSSError({
            code: 'OSS-GIT-003',
            category: ErrorCategory.GIT,
            message: 'Push failed',
            cause: 'Could not push changes to remote repository',
            recovery: [
                'Check your network connection',
                'Verify you have push access to the repository',
                'Pull latest changes: git pull --rebase',
                'Resolve any conflicts and try again',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/git/003',
            relatedCommands: ['/oss:ship'],
        }));
        // WORKFLOW errors
        this.register(new OSSError({
            code: 'OSS-WORKFLOW-001',
            category: ErrorCategory.WORKFLOW,
            message: 'Context limit exceeded',
            cause: 'Conversation history exceeds 20 turns',
            recovery: [
                'Run /clear to reset context',
                'Or use --force flag to bypass: /oss:command --force',
                'State is preserved in .oss/dev/active/',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/workflow/001',
        }));
        // API errors
        this.register(new OSSError({
            code: 'OSS-API-001',
            category: ErrorCategory.API,
            message: 'API temporarily unavailable',
            cause: 'The OSS API server is not responding',
            recovery: [
                'Wait a few minutes and try again',
                'Check status at https://status.oneshotship.com',
                'Contact support@oneshotship.com if issue persists',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/api/001',
        }));
        this.register(new OSSError({
            code: 'OSS-API-002',
            category: ErrorCategory.API,
            message: 'Prompt decrypt failed',
            cause: 'The oss-decrypt CLI could not decrypt the fetched prompt payload',
            recovery: [
                'Re-run the command to re-fetch the decrypt CLI',
                'Run /oss:trust to verify prompt integrity',
                'Contact support@oneshotship.com if the issue persists',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/api/002',
            relatedCommands: ['/oss:trust'],
            severity: 'HIGH',
            retry_eligible: true,
            retry_cost: 'cheap',
        }));
        this.register(new OSSError({
            code: 'OSS-API-003',
            category: ErrorCategory.API,
            message: 'API unreachable (network error)',
            cause: 'Could not reach the OSS API server (DNS or connection failure)',
            recovery: [
                'Check your network connection',
                'Retry the command after a few seconds',
                'Check status at https://status.oneshotship.com',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/api/003',
            severity: 'HIGH',
            retry_eligible: true,
            retry_cost: 'cheap',
        }));
        // CONFIG errors
        this.register(new OSSError({
            code: 'OSS-CONFIG-001',
            category: ErrorCategory.CONFIG,
            message: 'Configuration file corrupted',
            cause: 'The ~/.oss/config.json file is invalid or corrupted',
            recovery: [
                'Backup current config: cp ~/.oss/config.json ~/.oss/config.json.bak',
                'Run /oss:login to reconfigure',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/config/001',
            relatedCommands: ['/oss:login'],
        }));
        this.register(new OSSError({
            code: 'OSS-CONFIG-002',
            category: ErrorCategory.CONFIG,
            message: 'Configuration missing or invalid',
            cause: 'The ~/.oss/config.json file is missing or failed validation',
            recovery: [
                'Run /oss:login to create a fresh configuration',
                'Verify ~/.oss/config.json contains a valid apiKey entry',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/config/002',
            relatedCommands: ['/oss:login'],
            severity: 'MEDIUM',
            retry_eligible: false,
            retry_cost: 'cheap',
        }));
        this.register(new OSSError({
            code: 'OSS-WORKFLOW-002',
            category: ErrorCategory.WORKFLOW,
            message: 'workflow.log is not writable',
            cause: 'The project-local .oss/workflow.log could not be appended to',
            recovery: [
                'Check permissions on the project .oss directory',
                'Remove any directory occupying the .oss/workflow.log path',
                'Re-run the command',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/workflow/002',
            severity: 'MEDIUM',
            retry_eligible: false,
            retry_cost: 'cheap',
        }));
        this.register(new OSSError({
            code: 'OSS-WORKFLOW-902',
            category: ErrorCategory.WORKFLOW,
            message: 'Command reported an error',
            cause: 'A command failure path reported an error with no more specific classification',
            recovery: [
                'Review the error message and the command output for the root cause',
                'Re-run the command once the underlying problem is resolved',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/workflow/902',
            severity: 'MEDIUM',
            retry_eligible: false,
            retry_cost: 'cheap',
        }));
        this.register(new OSSError({
            code: 'OSS-WORKFLOW-901',
            category: ErrorCategory.WORKFLOW,
            message: 'Nonconforming error output wrapped',
            cause: 'A failure path emitted output that does not conform to the OSSError wire contract',
            recovery: [
                'Inspect the original output preserved in the error context',
                'Migrate the emitting script or prompt to the oss-error CLI',
            ],
            learnMore: 'https://docs.oneshotship.com/errors/workflow/901',
            severity: 'MEDIUM',
            retry_eligible: false,
            retry_cost: 'cheap',
        }));
    }
    /**
     * Register an error in the registry
     */
    register(error) {
        this.errors.set(error.code, error);
    }
    /**
     * Get error by code
     */
    getError(code) {
        return this.errors.get(code);
    }
    /**
     * Get all errors by category
     */
    getByCategory(category) {
        return Array.from(this.errors.values()).filter(e => e.category === category);
    }
    /**
     * Get all registered errors
     */
    getAllErrors() {
        return Array.from(this.errors.values());
    }
}
//# sourceMappingURL=error-codes.js.map