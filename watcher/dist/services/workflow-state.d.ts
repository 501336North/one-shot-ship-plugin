/**
 * WorkflowStateService - Manages workflow state for status line display
 *
 * @behavior Manages a JSON state file that the status line script reads to display workflow progress
 */
export type ChainStep = 'ideate' | 'requirements' | 'apiDesign' | 'dataModel' | 'adr' | 'plan' | 'acceptance' | 'red' | 'mock' | 'green' | 'refactor' | 'integration' | 'contract' | 'ship' | 'build';
export type SupervisorStatus = 'watching' | 'intervening' | 'idle';
export type StepStatus = 'pending' | 'active' | 'done';
export interface ActiveAgent {
    type: string;
    task: string;
    startedAt: string;
}
export interface Notification {
    message: string;
    expiresAt: string;
}
export interface QueueSummary {
    pendingCount: number;
    criticalCount: number;
    topTask?: string;
}
export interface HealthStatus {
    status: 'healthy' | 'violation';
    violatedLaw?: number;
}
export interface WorkflowState {
    version: number;
    supervisor: SupervisorStatus;
    activeStep: ChainStep | null;
    currentCommand?: string;
    nextCommand?: string | null;
    notification?: Notification;
    sessionId?: string;
    chainState: {
        ideate: StepStatus;
        requirements: StepStatus;
        apiDesign: StepStatus;
        dataModel: StepStatus;
        adr: StepStatus;
        plan: StepStatus;
        acceptance: StepStatus;
        red: StepStatus;
        mock: StepStatus;
        green: StepStatus;
        refactor: StepStatus;
        integration: StepStatus;
        contract: StepStatus;
        ship: StepStatus;
    };
    activeAgent?: ActiveAgent;
    queueSummary?: QueueSummary;
    health?: HealthStatus;
    tddPhase?: string;
    message?: string;
    currentTask?: string;
    progress?: string;
    testsPass?: number;
    tddCycle?: number;
    currentFeature?: string;
    lastCompletedStep?: string;
    lastStepTimestamp?: string;
    lastCommand?: string;
    workflowComplete?: boolean;
    lastUpdate: string;
}
export interface ProgressInfo {
    currentTask?: string;
    progress?: string;
    testsPass?: number;
}
export declare class WorkflowStateService {
    private stateFilePath;
    constructor(stateFilePath?: string);
    /**
     * Creates state file with default values if it doesn't exist
     */
    initialize(): Promise<void>;
    /**
     * Returns current state (or defaults if file corrupted)
     */
    getState(): Promise<WorkflowState>;
    /**
     * Sets active step, marks previous steps as done, future steps as pending
     */
    setActiveStep(step: ChainStep): Promise<void>;
    /**
     * Sets TDD phase within build (acceptance/red/green/refactor/integration)
     */
    setTddPhase(phase: ChainStep): Promise<void>;
    /**
     * Clears the TDD phase from workflow state (used when build completes)
     */
    clearTddPhase(): Promise<void>;
    /**
     * Marks step as done and sets nextCommand based on workflow progression
     */
    completeStep(step: ChainStep): Promise<void>;
    /**
     * Resets TDD loop phases (red/mock/green/refactor) for next iteration
     * Called when refactor completes and there are more tasks to do
     */
    resetTddCycle(): Promise<void>;
    /**
     * Marks all steps done, resets to idle
     */
    workflowComplete(): Promise<void>;
    /**
     * Updates supervisor status
     */
    setSupervisor(status: SupervisorStatus): Promise<void>;
    /**
     * Updates currentTask, progress, testsPass
     */
    setProgress(info: ProgressInfo): Promise<void>;
    /**
     * Resets to defaults
     */
    reset(): Promise<void>;
    /**
     * Sets active agent for status line display
     */
    setActiveAgent(info: {
        type: string;
        task: string;
    }): Promise<void>;
    /**
     * Clears active agent when agent completes
     */
    clearActiveAgent(): Promise<void>;
    /**
     * Sets message for status line display (workflow/session events)
     */
    setMessage(message: string): Promise<void>;
    /**
     * Clears message from status line
     */
    clearMessage(): Promise<void>;
    /**
     * Sets currentCommand for status line display
     */
    setCurrentCommand(command: string): Promise<void>;
    /**
     * Clears currentCommand from state
     */
    clearCurrentCommand(): Promise<void>;
    /**
     * Sets nextCommand for status line display
     */
    setNextCommand(command: string): Promise<void>;
    /**
     * Clears nextCommand (sets to null)
     */
    clearNextCommand(): Promise<void>;
    /**
     * Determines if we should warn about archive based on workflow state
     *
     * Returns true if:
     * - Last step is 'plan' AND >24h since completion (should have been archived)
     *
     * Returns false if:
     * - Last step is 'ship' (archiving expected on next plan)
     * - No completed step yet
     * - Step completed within last 24h
     */
    shouldWarnAboutArchive(): Promise<boolean>;
    /**
     * Returns default state
     * Note: version starts at 0 and gets incremented to 1 on first write
     */
    private getDefaultState;
    /**
     * Writes state to file with updated timestamp and incremented version
     */
    private writeState;
    /**
     * Sets notification with TTL (non-sticky, auto-expires)
     * @param message - Notification message
     * @param ttlSeconds - Time to live in seconds (default 10)
     */
    setNotification(message: string, ttlSeconds?: number): Promise<void>;
    /**
     * Clears notification immediately
     */
    clearNotification(): Promise<void>;
    /**
     * Checks if notification is expired or doesn't exist
     * @returns true if expired or no notification exists
     */
    isNotificationExpired(): Promise<boolean>;
    /**
     * Sets queue summary for status line display (consolidated from queue.json)
     */
    setQueueSummary(summary: QueueSummary): Promise<void>;
    /**
     * Clears queue summary from state
     */
    clearQueueSummary(): Promise<void>;
    /**
     * Sets health status for status line display (consolidated from iron-law-state.json)
     */
    setHealth(health: HealthStatus): Promise<void>;
    /**
     * Clears health status from state
     */
    clearHealth(): Promise<void>;
    /**
     * Clears progress, currentTask, and testsPass fields
     * Used to clear stale workflow progress on session start
     */
    clearProgress(): Promise<void>;
    /**
     * Prepares state for a new session by clearing stale workflow data
     * Preserves chainState for historical reference
     * Sets supervisor to 'watching' for active session
     */
    prepareForNewSession(): Promise<void>;
    /**
     * Sets session ID for staleness detection
     * @param sessionId - Unique session identifier (typically UUID)
     */
    setSessionId(sessionId: string): Promise<void>;
    /**
     * Checks if the provided session ID matches the current session
     * @param sessionId - Session ID to check
     * @returns true if session IDs match, false otherwise
     */
    isCurrentSession(sessionId: string): Promise<boolean>;
    /**
     * Sets lastCommand for status line display (last completed command)
     * @param command - The command name (e.g., 'plan', 'build', 'ship')
     */
    setLastCommand(command: string): Promise<void>;
    /**
     * Clears lastCommand from state
     */
    clearLastCommand(): Promise<void>;
    /**
     * Sets workflowComplete flag for status line display
     * When true, status line shows "→ DONE" instead of next command
     * @param complete - Whether the workflow is complete
     */
    setWorkflowComplete(complete: boolean): Promise<void>;
}
//# sourceMappingURL=workflow-state.d.ts.map