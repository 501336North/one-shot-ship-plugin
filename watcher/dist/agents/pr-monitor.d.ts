/**
 * PR Monitor Agent
 *
 * Monitors GitHub PRs for review comments and queues remediation tasks.
 * Implements the BackgroundAgent interface for the agent registry.
 */
import type { BackgroundAgent, AgentMetadata, AgentStatus } from './types';
import type { PRMonitorState } from './pr-monitor-state';
import type { GitHubClient, Comment } from './github-client';
/**
 * Queued task for PR remediation
 */
export interface PRTask {
    prNumber: number;
    branch: string;
    path: string;
    line: number;
    commentId: string;
    commentBody: string;
    suggestedAgent: string;
}
export declare class PRMonitorAgent implements BackgroundAgent {
    private state;
    private githubClient;
    readonly metadata: AgentMetadata;
    private isRunning;
    private errorCount;
    private lastError;
    private queuedTasks;
    constructor(state: PRMonitorState, githubClient: GitHubClient);
    /**
     * Initialize the agent
     */
    initialize(): Promise<void>;
    /**
     * Start the agent
     */
    start(): Promise<void>;
    /**
     * Stop the agent
     */
    stop(): Promise<void>;
    /**
     * Poll for new comments
     */
    poll(): Promise<void>;
    /**
     * Process a change request comment
     */
    private processChangeRequest;
    /**
     * Check if a comment is a change request
     */
    isChangeRequest(comment: Comment): boolean;
    /**
     * Determine suggested agent based on comment content
     */
    determineSuggestedAgent(comment: Comment): string;
    /**
     * Get all queued tasks
     */
    getQueuedTasks(): PRTask[];
    /**
     * Dequeue a task (removes and returns first task in queue)
     */
    dequeueTask(): PRTask | undefined;
    /**
     * Clear all queued tasks
     */
    clearQueue(): void;
    /**
     * Get current agent status
     */
    getStatus(): AgentStatus;
}
//# sourceMappingURL=pr-monitor.d.ts.map