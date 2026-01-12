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
    constructor(options) {
        super(options.message);
        this.name = 'OSSError';
        this.code = options.code;
        this.category = options.category;
        this.cause = options.cause;
        this.recovery = options.recovery;
        this.learnMore = options.learnMore;
        this.relatedCommands = options.relatedCommands ?? [];
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