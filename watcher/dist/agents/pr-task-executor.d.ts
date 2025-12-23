/**
 * PR Task Executor
 *
 * Executes PR remediation tasks with TDD workflow.
 * Preserves context (stash/restore), follows TDD cycle, validates quality.
 */
/**
 * Execution context for context preservation
 */
export interface ExecutionContext {
    originalBranch: string | null;
    stashCreated: boolean;
}
/**
 * PR Task Executor
 *
 * Handles the execution of PR remediation tasks with context preservation.
 */
export declare class PRTaskExecutor {
    private context;
    /**
     * Execute a git command
     */
    private execGit;
    /**
     * Check if there are uncommitted changes
     */
    hasUncommittedChanges(): Promise<boolean>;
    /**
     * Save current context (branch and stash)
     */
    saveContext(): Promise<void>;
    /**
     * Restore saved context (checkout branch and pop stash)
     */
    restoreContext(): Promise<void>;
    /**
     * Get current context
     */
    getContext(): ExecutionContext;
    /**
     * Set context (for testing)
     */
    setContext(context: Partial<ExecutionContext>): void;
    /**
     * Checkout a branch, fetching if necessary
     */
    checkoutBranch(branch: string): Promise<void>;
    /**
     * Fetch a branch from remote
     */
    fetchBranch(branch: string): Promise<void>;
    /**
     * Pull latest changes for a branch
     */
    pullLatest(branch: string): Promise<void>;
    /**
     * Run test suite
     */
    runTests(): Promise<QualityResult>;
    /**
     * Run type check
     */
    runTypeCheck(): Promise<QualityResult>;
    /**
     * Run lint
     */
    runLint(): Promise<QualityResult>;
    /**
     * Validate all quality gates
     */
    validateQualityGates(): Promise<QualityGateResult>;
    /**
     * Stage all changes
     */
    stageChanges(): Promise<void>;
    /**
     * Create commit with message
     * Uses a temp file to avoid shell injection via commit message
     */
    createCommit(context: CommitContext): Promise<string>;
    /**
     * Push to branch
     */
    pushToBranch(branch: string): Promise<void>;
    /**
     * Get current commit SHA
     */
    getCommitSha(): Promise<string>;
    private _needsEscalation;
    /**
     * Execute with retry logic
     */
    executeWithRetry<T>(fn: () => T | Promise<T>, maxRetries?: number): Promise<T>;
    /**
     * Check if task needs human escalation
     */
    needsEscalation(): boolean;
}
/**
 * Quality check result
 */
export interface QualityResult {
    passed: boolean;
    errors: string[];
}
/**
 * Overall quality gate result
 */
export interface QualityGateResult {
    passed: boolean;
    errors: string[];
}
/**
 * Commit context
 */
export interface CommitContext {
    prNumber: number;
    commentId: string;
    summary: string;
}
//# sourceMappingURL=pr-task-executor.d.ts.map