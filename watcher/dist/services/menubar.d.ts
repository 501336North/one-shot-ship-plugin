/**
 * MenuBarService - Manages workflow state for SwiftBar menu bar display
 *
 * @behavior Manages a JSON state file that SwiftBar reads to display workflow progress
 */
export type ChainStep = 'ideate' | 'plan' | 'acceptance' | 'red' | 'green' | 'refactor' | 'integration' | 'ship' | 'build';
export type SupervisorStatus = 'watching' | 'intervening' | 'idle';
export type StepStatus = 'pending' | 'active' | 'done';
export interface WorkflowState {
    supervisor: SupervisorStatus;
    activeStep: ChainStep | null;
    chainState: {
        ideate: StepStatus;
        plan: StepStatus;
        acceptance: StepStatus;
        red: StepStatus;
        green: StepStatus;
        refactor: StepStatus;
        integration: StepStatus;
        ship: StepStatus;
    };
    currentTask?: string;
    progress?: string;
    testsPass?: number;
    lastUpdate: string;
}
export interface ProgressInfo {
    currentTask?: string;
    progress?: string;
    testsPass?: number;
}
export declare class MenuBarService {
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
     * Sets active step, marks previous steps as done
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
     * Returns default state
     */
    private getDefaultState;
    /**
     * Writes state to file with updated timestamp
     */
    private writeState;
}
//# sourceMappingURL=menubar.d.ts.map