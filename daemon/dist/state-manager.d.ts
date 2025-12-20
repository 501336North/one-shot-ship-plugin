/**
 * StateManager - Manage workflow state for status line display
 *
 * Reads and writes issues to workflow-state.json for daemon/status line
 * communication.
 */
export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueType = 'hung_process' | 'branch_violation' | 'stale_tdd_phase' | 'test_failure' | string;
export interface Issue {
    type: IssueType;
    message: string;
    severity: IssueSeverity;
}
export interface StateManagerConfig {
    ossDir: string;
}
export interface WorkflowState {
    issue?: Issue | null;
    daemonHeartbeat?: string;
    tddPhase?: string;
    [key: string]: unknown;
}
export declare class StateManager {
    private stateFile;
    constructor(config: StateManagerConfig);
    /**
     * Read current workflow state
     */
    private readState;
    /**
     * Write workflow state
     */
    private writeState;
    /**
     * Report an issue to workflow state
     */
    reportIssue(issue: Issue): Promise<void>;
    /**
     * Clear current issue
     */
    clearIssue(): Promise<void>;
    /**
     * Get current issue if any
     */
    getCurrentIssue(): Promise<Issue | null>;
}
//# sourceMappingURL=state-manager.d.ts.map