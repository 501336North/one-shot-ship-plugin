/**
 * WorkflowStateService - Track workflow step progression
 *
 * Tracks the current workflow state to enable smarter health checks:
 * - Current feature being worked on
 * - Last completed workflow step (ideate → plan → build → ship)
 * - Timestamp of last step completion
 *
 * State is persisted to ~/.oss/workflow-state.json
 */
export type WorkflowStep = 'ideate' | 'plan' | 'build' | 'ship';
export interface WorkflowState {
    currentFeature: string | null;
    lastCompletedStep: WorkflowStep | null;
    lastStepTimestamp: string | null;
}
export declare class WorkflowStateService {
    private ossDir;
    private stateFile;
    private state;
    constructor(ossDir?: string);
    /**
     * Initialize service by loading existing state (if any)
     */
    initialize(): Promise<void>;
    /**
     * Get current workflow state
     */
    getState(): Promise<WorkflowState>;
    /**
     * Set the current feature being worked on
     * Clears previous step state (starting fresh on new feature)
     */
    setCurrentFeature(featureName: string): Promise<void>;
    /**
     * Record completion of a workflow step
     */
    completeStep(step: WorkflowStep): Promise<void>;
    /**
     * Clear all workflow state
     */
    clearState(): Promise<void>;
    /**
     * Get age of last completed step in hours
     * Returns null if no step has been completed
     */
    getStepAgeHours(): Promise<number | null>;
    /**
     * Determine if archive check should warn about unarchived features
     *
     * Logic:
     * - If last step is 'ship' → don't warn (archiving expected on next plan)
     * - If last step is 'plan' and >24h old → warn (plan should have archived)
     * - Otherwise → don't warn
     */
    shouldWarnAboutArchive(): Promise<boolean>;
    /**
     * Persist state to file
     */
    private persist;
}
//# sourceMappingURL=workflow-state.d.ts.map