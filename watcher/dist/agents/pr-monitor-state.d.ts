/**
 * PR Monitor State
 *
 * Manages persistent state for the PR monitor agent.
 * Tracks processed comment IDs to avoid duplicate handling.
 */
/**
 * Stats tracked by the PR monitor
 */
export interface PRMonitorStats {
    commentsProcessed: number;
    tasksQueued: number;
    tasksCompleted: number;
    tasksFailed: number;
}
/**
 * Manages PR monitor state with persistence
 */
export declare class PRMonitorState {
    private processedCommentIds;
    private processedComments;
    private lastPollTime;
    private lastError;
    private stats;
    /**
     * Load state from file
     */
    load(): Promise<void>;
    /**
     * Remove comment entries older than TTL
     */
    private cleanupExpiredComments;
    /**
     * Save state to file
     */
    save(): Promise<void>;
    /**
     * Add a comment ID to the processed set
     */
    addProcessedComment(id: string): void;
    /**
     * Check if a comment has been processed
     */
    isProcessed(id: string): boolean;
    /**
     * Update the last poll time to now
     */
    updateLastPollTime(): void;
    /**
     * Get the last poll time
     */
    getLastPollTime(): string | null;
    /**
     * Set the last error
     */
    setLastError(error: string | null): void;
    /**
     * Increment a stat counter
     */
    incrementStat(stat: keyof PRMonitorStats): void;
    /**
     * Get all stats
     */
    getStats(): PRMonitorStats;
}
//# sourceMappingURL=pr-monitor-state.d.ts.map