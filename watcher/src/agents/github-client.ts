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
    const escapedBody = body.replace(/'/g, "'\\''");
    await this.execGh(
      `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments/${commentId}/replies -f body='${escapedBody}'`
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
