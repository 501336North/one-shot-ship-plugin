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
export interface WorkflowState {
    supervisor: SupervisorStatus;
    activeStep: ChainStep | null;
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
    tddPhase?: string;
    currentTask?: string;
    progress?: string;
    testsPass?: number;
    tddCycle?: number;
    currentFeature?: string;
    lastCompletedStep?: string;
    lastStepTimestamp?: string;
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
     * Marks step as done
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
     */
    private getDefaultState;
    /**
     * Writes state to file with updated timestamp
     */
    private writeState;
}
//# sourceMappingURL=workflow-state.d.ts.map