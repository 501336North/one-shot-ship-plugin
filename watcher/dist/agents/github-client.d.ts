/**
 * GitHub API Client
 *
 * Fetches PRs and comments from GitHub using the gh CLI.
 * Provides a type-safe interface for GitHub operations.
 */
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
export declare class RateLimitError extends Error {
    retryAfter?: number | undefined;
    constructor(message: string, retryAfter?: number | undefined);
}
/**
 * Validate PR number is a positive integer
 */
export declare function validatePRNumber(prNumber: number): void;
/**
 * Validate comment ID is alphanumeric
 */
export declare function validateCommentId(commentId: string): void;
/**
 * Validate branch name follows git naming rules
 */
export declare function validateBranchName(branch: string): void;
/**
 * GitHub API client using gh CLI
 */
export declare class GitHubClient {
    private repoInfo;
    /**
     * Execute a gh CLI command
     */
    private execGh;
    /**
     * Get open PRs for the current repository
     */
    getOpenPRs(): Promise<PR[]>;
    /**
     * Get review comments for a PR
     */
    getPRReviewComments(prNumber: number): Promise<Comment[]>;
    /**
     * Reply to a review comment
     */
    replyToComment(prNumber: number, commentId: string, body: string): Promise<void>;
    /**
     * Get repository owner and name from git remote
     */
    getRepoInfo(): Promise<RepoInfo>;
}
//# sourceMappingURL=github-client.d.ts.map