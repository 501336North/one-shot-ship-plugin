/**
 * NotificationCopyService - World-class notification copy generation
 *
 * @behavior Generates branded, contextual notification messages
 * @acceptance-criteria AC-COPY.1 through AC-COPY.28
 */
export type SessionEvent = 'context_restored' | 'fresh_session' | 'fresh_start' | 'session_end' | 'context_saved';
export type WorkflowCommand = 'ideate' | 'plan' | 'build' | 'ship';
export type WorkflowEvent = 'start' | 'complete' | 'failed' | 'task_complete' | 'quality_passed' | 'pr_created' | 'merged';
export type IssueType = 'loop_detected' | 'tdd_violation' | 'regression' | 'phase_stuck' | 'chain_broken' | 'explicit_failure' | 'agent_failed';
export interface Copy {
    title: string;
    message: string;
    subtitle?: string;
}
export interface SessionContext {
    branch?: string;
    age?: string;
    project?: string;
    uncommitted?: number;
    saveDate?: string;
    currentDate?: string;
}
export interface WorkflowContext {
    idea?: string;
    requirementsCount?: number;
    reason?: string;
    taskCount?: number;
    phases?: number;
    totalTasks?: number;
    current?: number;
    total?: number;
    taskName?: string;
    testsPass?: number;
    duration?: string;
    failedTest?: string;
    checks?: string[];
    prNumber?: number;
    prTitle?: string;
    branch?: string;
    blocker?: string;
    chainState?: {
        ideate?: 'pending' | 'active' | 'done';
        plan?: 'pending' | 'active' | 'done';
        acceptance?: 'pending' | 'active' | 'done';
        red?: 'pending' | 'active' | 'done';
        green?: 'pending' | 'active' | 'done';
        refactor?: 'pending' | 'active' | 'done';
        integration?: 'pending' | 'active' | 'done';
        ship?: 'pending' | 'active' | 'done';
    };
    tddPhase?: 'red' | 'green' | 'refactor';
    supervisor?: 'watching' | 'intervening' | 'idle';
}
export interface IssueContext {
    toolName?: string;
    iterations?: number;
    violation?: string;
    failedTests?: number;
    previouslyPassing?: boolean;
    phase?: string;
    duration?: string;
    prereq?: string;
    error?: string;
    agent?: string;
}
export declare class NotificationCopyService {
    /**
     * Get copy for session lifecycle events
     */
    getSessionCopy(event: SessionEvent, context: SessionContext): Copy;
    /**
     * Get copy for workflow command events
     */
    getWorkflowCopy(command: WorkflowCommand, event: WorkflowEvent, context: WorkflowContext): Copy;
    /**
     * Generate subtitle showing full London TDD workflow chain
     * Full chain: ideate → plan → acceptance → red → green → refactor → integration → ship
     * With supervisor indicator: 👁 (watching) or ⚡ (intervening)
     */
    private generateChainSubtitle;
    /**
     * Derive full chain state from command, event, and TDD phase
     */
    private deriveFullChainState;
    /**
     * Get copy for issue/intervention events
     */
    getIssueCopy(issueType: IssueType, context: IssueContext): Copy;
    /**
     * Get all titles for validation
     */
    getAllTitles(): string[];
    /**
     * Get all messages for validation
     */
    getAllMessages(): string[];
    /**
     * Interpolate {placeholder} values in a template string
     */
    private interpolate;
}
//# sourceMappingURL=notification-copy.d.ts.map