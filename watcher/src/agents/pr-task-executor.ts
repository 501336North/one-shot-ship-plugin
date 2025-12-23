/**
 * PR Task Executor
 *
 * Executes PR remediation tasks with TDD workflow.
 * Preserves context (stash/restore), follows TDD cycle, validates quality.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
export class PRTaskExecutor {
  private context: ExecutionContext = {
    originalBranch: null,
    stashCreated: false,
  };

  /**
   * Execute a git command
   */
  private async execGit(command: string): Promise<string> {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    const output = await this.execGit('git status --porcelain');
    return output.length > 0;
  }

  /**
   * Save current context (branch and stash)
   */
  async saveContext(): Promise<void> {
    // Get current branch
    const branch = await this.execGit('git branch --show-current');
    this.context.originalBranch = branch;

    // Check for uncommitted changes and stash if needed
    if (await this.hasUncommittedChanges()) {
      await this.execGit('git stash push -m "pr-task-executor: auto-stash"');
      this.context.stashCreated = true;
    } else {
      this.context.stashCreated = false;
    }
  }

  /**
   * Restore saved context (checkout branch and pop stash)
   */
  async restoreContext(): Promise<void> {
    if (!this.context.originalBranch) {
      return;
    }

    // Checkout original branch
    await this.execGit(`git checkout ${this.context.originalBranch}`);

    // Pop stash if it was created
    if (this.context.stashCreated) {
      await this.execGit('git stash pop');
    }

    // Clear context
    this.context = {
      originalBranch: null,
      stashCreated: false,
    };
  }

  /**
   * Get current context
   */
  getContext(): ExecutionContext {
    return { ...this.context };
  }

  /**
   * Set context (for testing)
   */
  setContext(context: Partial<ExecutionContext>): void {
    this.context = {
      ...this.context,
      ...context,
    };
  }

  /**
   * Checkout a branch, fetching if necessary
   */
  async checkoutBranch(branch: string): Promise<void> {
    try {
      await this.execGit(`git checkout ${branch}`);
    } catch (error) {
      // If branch doesn't exist locally, try fetching
      if (error instanceof Error && error.message.includes('pathspec')) {
        await this.fetchBranch(branch);
        await this.execGit(`git checkout ${branch}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Fetch a branch from remote
   */
  async fetchBranch(branch: string): Promise<void> {
    await this.execGit(`git fetch origin ${branch}`);
  }

  /**
   * Pull latest changes for a branch
   */
  async pullLatest(branch: string): Promise<void> {
    await this.execGit(`git pull origin ${branch}`);
  }

  // ==========================================================================
  // Quality Gates
  // ==========================================================================

  /**
   * Run test suite
   */
  async runTests(): Promise<QualityResult> {
    try {
      await this.execGit('npm test');
      return { passed: true, errors: [] };
    } catch (error) {
      return {
        passed: false,
        errors: [error instanceof Error ? error.message : 'Tests failed'],
      };
    }
  }

  /**
   * Run type check
   */
  async runTypeCheck(): Promise<QualityResult> {
    try {
      await this.execGit('npx tsc --noEmit');
      return { passed: true, errors: [] };
    } catch (error) {
      return {
        passed: false,
        errors: [error instanceof Error ? error.message : 'Type check failed'],
      };
    }
  }

  /**
   * Run lint
   */
  async runLint(): Promise<QualityResult> {
    try {
      await this.execGit('npm run lint');
      return { passed: true, errors: [] };
    } catch (error) {
      return {
        passed: false,
        errors: [error instanceof Error ? error.message : 'Lint failed'],
      };
    }
  }

  /**
   * Validate all quality gates
   */
  async validateQualityGates(): Promise<QualityGateResult> {
    const results = await Promise.all([
      this.runTests(),
      this.runTypeCheck(),
      this.runLint(),
    ]);

    const errors = results.flatMap((r) => r.errors);
    return {
      passed: results.every((r) => r.passed),
      errors,
    };
  }

  // ==========================================================================
  // Commit and Push
  // ==========================================================================

  /**
   * Stage all changes
   */
  async stageChanges(): Promise<void> {
    await this.execGit('git add .');
  }

  /**
   * Create commit with message
   */
  async createCommit(context: CommitContext): Promise<string> {
    const message = `fix: Address PR #${context.prNumber} comment

${context.summary}

Addresses comment: ${context.commentId}

Co-Authored-By: Claude <noreply@anthropic.com>`;

    await this.execGit(`git commit -m "${message.replace(/"/g, '\\"')}"`);
    return this.getCommitSha();
  }

  /**
   * Push to branch
   */
  async pushToBranch(branch: string): Promise<void> {
    // Safety: Never push to main/master
    if (branch === 'main' || branch === 'master') {
      throw new Error('Cannot push directly to main/master branch');
    }
    await this.execGit(`git push origin ${branch}`);
  }

  /**
   * Get current commit SHA
   */
  async getCommitSha(): Promise<string> {
    return this.execGit('git rev-parse --short HEAD');
  }

  // ==========================================================================
  // Retry and Escalation
  // ==========================================================================

  private _needsEscalation = false;

  /**
   * Execute with retry logic
   */
  async executeWithRetry<T>(
    fn: () => T | Promise<T>,
    maxRetries = 2
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry permanent failures
        if ((lastError as Error & { permanent?: boolean }).permanent) {
          throw lastError;
        }

        // If last attempt, mark for escalation
        if (attempt === maxRetries) {
          this._needsEscalation = true;
          throw lastError;
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if task needs human escalation
   */
  needsEscalation(): boolean {
    return this._needsEscalation;
  }
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
