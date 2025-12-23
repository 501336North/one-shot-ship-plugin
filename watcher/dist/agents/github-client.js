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
 * Rate limit error
 */
export class RateLimitError extends Error {
    retryAfter;
    constructor(message, retryAfter) {
        super(message);
        this.retryAfter = retryAfter;
        this.name = 'RateLimitError';
    }
}
/**
 * Validate PR number is a positive integer
 */
export function validatePRNumber(prNumber) {
    if (!Number.isInteger(prNumber) || prNumber <= 0 || prNumber > 999999999) {
        throw new Error(`Invalid PR number: ${prNumber}`);
    }
}
/**
 * Validate comment ID is alphanumeric
 */
export function validateCommentId(commentId) {
    if (!/^[a-zA-Z0-9_-]+$/.test(commentId)) {
        throw new Error(`Invalid comment ID: ${commentId}`);
    }
}
/**
 * Validate branch name follows git naming rules
 */
export function validateBranchName(branch) {
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
    repoInfo = null;
    /**
     * Execute a gh CLI command
     */
    async execGh(command) {
        try {
            const { stdout } = await execAsync(command);
            return stdout.trim();
        }
        catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('rate limit') ||
                    error.code === 'RATE_LIMITED') {
                    throw new RateLimitError('GitHub API rate limit exceeded');
                }
            }
            throw error;
        }
    }
    /**
     * Get open PRs for the current repository
     */
    async getOpenPRs() {
        const output = await this.execGh('gh pr list --state open --json number,title,headRefName');
        const prs = JSON.parse(output);
        return prs.map((pr) => ({
            number: pr.number,
            title: pr.title,
            branch: pr.headRefName || pr.head?.ref || '',
        }));
    }
    /**
     * Get review comments for a PR
     */
    async getPRReviewComments(prNumber) {
        validatePRNumber(prNumber);
        const output = await this.execGh(`gh api repos/{owner}/{repo}/pulls/${prNumber}/comments`);
        const comments = JSON.parse(output);
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
    async replyToComment(prNumber, commentId, body) {
        validatePRNumber(prNumber);
        validateCommentId(commentId);
        // Use JSON encoding for body to safely handle special characters
        const jsonBody = JSON.stringify(body);
        // Use --raw-field with JSON to avoid shell escaping issues
        await this.execGh(`gh api repos/{owner}/{repo}/pulls/${prNumber}/comments/${commentId}/replies --raw-field body=${jsonBody}`);
    }
    /**
     * Get repository owner and name from git remote
     */
    async getRepoInfo() {
        if (this.repoInfo) {
            return this.repoInfo;
        }
        const output = await this.execGh('git remote get-url origin');
        // Parse SSH or HTTPS URL
        // git@github.com:owner/repo.git
        // https://github.com/owner/repo.git
        const match = output.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
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
//# sourceMappingURL=github-client.js.map