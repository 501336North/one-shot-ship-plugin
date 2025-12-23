/**
 * PR Monitor Agent
 *
 * Monitors GitHub PRs for review comments and queues remediation tasks.
 * Implements the BackgroundAgent interface for the agent registry.
 */
/**
 * Agent metadata
 */
const METADATA = {
    name: 'pr-monitor',
    description: 'Monitors PRs for review comments and queues remediation tasks',
    version: '1.0.0',
};
/**
 * PR Monitor Agent
 *
 * Polls GitHub for open PRs, fetches review comments,
 * and queues tasks for change request comments.
 */
/**
 * Maximum number of tasks that can be queued
 */
const MAX_QUEUE_SIZE = 100;
/**
 * Maximum comment body length to process (prevents DoS)
 */
const MAX_COMMENT_LENGTH = 10000;
export class PRMonitorAgent {
    state;
    githubClient;
    metadata = METADATA;
    isRunning = false;
    errorCount = 0;
    lastError = null;
    queuedTasks = [];
    constructor(state, githubClient) {
        this.state = state;
        this.githubClient = githubClient;
    }
    /**
     * Initialize the agent
     */
    async initialize() {
        await this.state.load();
    }
    /**
     * Start the agent
     */
    async start() {
        this.isRunning = true;
    }
    /**
     * Stop the agent
     */
    async stop() {
        this.isRunning = false;
        await this.state.save();
    }
    /**
     * Poll for new comments
     */
    async poll() {
        // Fetch all open PRs
        const prs = await this.githubClient.getOpenPRs();
        // Fetch comments for all PRs in parallel (fixes N+1 pattern)
        const commentsPerPR = await Promise.all(prs.map((pr) => this.githubClient.getPRReviewComments(pr.number)));
        // Process comments from all PRs
        for (let i = 0; i < prs.length; i++) {
            const pr = prs[i];
            const comments = commentsPerPR[i];
            for (const comment of comments) {
                // Skip already processed comments
                if (this.state.isProcessed(comment.id)) {
                    continue;
                }
                // Check if this is a change request
                if (this.isChangeRequest(comment)) {
                    await this.processChangeRequest(pr, comment);
                }
            }
        }
        // Update last poll time
        this.state.updateLastPollTime();
    }
    /**
     * Process a change request comment
     */
    async processChangeRequest(pr, comment) {
        // Reply with acknowledgment
        await this.githubClient.replyToComment(pr.number, comment.id, '🤖 Addressing this comment. Will push a fix shortly.');
        // Queue the task (with size limit to prevent unbounded growth)
        const task = {
            prNumber: pr.number,
            branch: pr.branch,
            path: comment.path,
            line: comment.line,
            commentId: comment.id,
            commentBody: comment.body,
            suggestedAgent: this.determineSuggestedAgent(comment),
        };
        // Evict oldest task if queue is full (FIFO)
        if (this.queuedTasks.length >= MAX_QUEUE_SIZE) {
            this.queuedTasks.shift();
        }
        this.queuedTasks.push(task);
        // Mark comment as processed
        this.state.addProcessedComment(comment.id);
        // Increment stats
        this.state.incrementStat('tasksQueued');
    }
    /**
     * Check if a comment is a change request
     */
    isChangeRequest(comment) {
        // Reject overly long comments (prevents DoS)
        if (comment.body.length > MAX_COMMENT_LENGTH) {
            return false;
        }
        const body = comment.body.toLowerCase();
        // Approval patterns - not change requests
        const approvalPatterns = ['lgtm', 'looks good', 'approved', '👍', ':+1:'];
        for (const pattern of approvalPatterns) {
            if (body.includes(pattern)) {
                return false;
            }
        }
        // Change request patterns
        const changePatterns = ['fix', 'please', 'could you', 'should', 'refactor', 'change', 'update'];
        for (const pattern of changePatterns) {
            if (body.includes(pattern)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Determine suggested agent based on comment content
     */
    determineSuggestedAgent(comment) {
        const body = comment.body.toLowerCase();
        // TypeScript-related
        if (body.includes('typescript') || body.includes('type') || body.includes('types')) {
            return 'typescript-pro';
        }
        // Testing-related
        if (body.includes('test') || body.includes('coverage') || body.includes('mock')) {
            return 'test-engineer';
        }
        // Performance-related
        if (body.includes('performance') || body.includes('optimize') || body.includes('slow')) {
            return 'performance-engineer';
        }
        // Security-related
        if (body.includes('security') || body.includes('vulnerability') || body.includes('xss')) {
            return 'security-auditor';
        }
        // Refactoring-related
        if (body.includes('refactor') || body.includes('clean up') || body.includes('simplify')) {
            return 'refactoring-specialist';
        }
        // Default to debugger for generic fixes
        return 'debugger';
    }
    /**
     * Get all queued tasks
     */
    getQueuedTasks() {
        return [...this.queuedTasks];
    }
    /**
     * Dequeue a task (removes and returns first task in queue)
     */
    dequeueTask() {
        return this.queuedTasks.shift();
    }
    /**
     * Clear all queued tasks
     */
    clearQueue() {
        this.queuedTasks = [];
    }
    /**
     * Get current agent status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastPollTime: this.state.getLastPollTime(),
            errorCount: this.errorCount,
            lastError: this.lastError,
        };
    }
}
//# sourceMappingURL=pr-monitor.js.map