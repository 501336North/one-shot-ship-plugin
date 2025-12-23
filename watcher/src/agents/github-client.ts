/**
 * GitHub API Client
 *
 * Fetches PRs and comments from GitHub using the gh CLI.
 * Provides a type-safe interface for GitHub operations.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Pull Request data
 */
export interface PR {
  number: number;
  title: string;
  branch: string;
}

/**
 * Review comment data
 */
export interface Comment {
  id: string;
  body: string;
  path: string;
  line: number;
}

/**
 * Repository info
 */
export interface RepoInfo {
  owner: string;
  repo: string;
}

/**
 * Rate limit error
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Validate PR number is a positive integer
 */
export function validatePRNumber(prNumber: number): void {
  if (!Number.isInteger(prNumber) || prNumber <= 0 || prNumber > 999999999) {
    throw new Error(`Invalid PR number: ${prNumber}`);
  }
}

/**
 * Validate comment ID is alphanumeric
 */
export function validateCommentId(commentId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(commentId)) {
    throw new Error(`Invalid comment ID: ${commentId}`);
  }
}

/**
 * Validate branch name follows git naming rules
 */
export function validateBranchName(branch: string): void {
  // Git branch names: alphanumeric, hyphens, underscores, slashes, dots
  // Cannot start/end with dot or slash, no double dots
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*[a-zA-Z0-9]$/.test(branch) && branch.length > 1) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  if (branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
}

/**
 * GitHub API client using gh CLI
 */
export class GitHubClient {
  private repoInfo: RepoInfo | null = null;

  /**
   * Execute a gh CLI command
   */
  private async execGh(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command);
      return stdout.trim();
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes('rate limit') ||
          (error as NodeJS.ErrnoException).code === 'RATE_LIMITED'
        ) {
          throw new RateLimitError('GitHub API rate limit exceeded');
        }
      }
      throw error;
    }
  }

  /**
   * Get open PRs for the current repository
   */
  async getOpenPRs(): Promise<PR[]> {
    const output = await this.execGh(
      'gh pr list --state open --json number,title,headRefName'
    );

    const prs = JSON.parse(output) as Array<{
      number: number;
      title: string;
      headRefName?: string;
      head?: { ref: string };
    }>;

    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName || pr.head?.ref || '',
    }));
  }

  /**
   * Get review comments for a PR
   */
  async getPRReviewComments(prNumber: number): Promise<Comment[]> {
    validatePRNumber(prNumber);
    const output = await this.execGh(
      `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments`
    );

    const comments = JSON.parse(output) as Array<{
      id: number;
      body: string;
      path: string;
      line: number;
    }>;

    return comments.map((c) => ({
      id: String(c.id),
      body: c.body,
      path: c.path,
      line: c.line,
    }));
  }

  /**
   * Reply to a review comment
   */
  async replyToComment(
    prNumber: number,
    commentId: string,
    body: string
  ): Promise<void> {
    validatePRNumber(prNumber);
    validateCommentId(commentId);

    // Use JSON encoding for body to safely handle special characters
    const jsonBody = JSON.stringify(body);
    // Use --raw-field with JSON to avoid shell escaping issues
    await this.execGh(
      `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments/${commentId}/replies --raw-field body=${jsonBody}`
    );
  }

  /**
   * Get repository owner and name from git remote
   */
  async getRepoInfo(): Promise<RepoInfo> {
    if (this.repoInfo) {
      return this.repoInfo;
    }

    const output = await this.execGh('git remote get-url origin');

    // Parse SSH or HTTPS URL
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo.git
    const match = output.match(
      /github\.com[:/]([^/]+)\/([^/.]+)/
    );

    if (!match) {
      throw new Error(`Cannot parse GitHub remote: ${output}`);
    }

    this.repoInfo = {
      owner: match[1],
      repo: match[2],
    };

    return this.repoInfo;
  }
}
