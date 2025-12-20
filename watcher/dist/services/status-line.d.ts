/**
 * StatusLineService - Track TDD phase and workflow progress for status line display
 *
 * Tracks:
 * - Current TDD phase (RED/GREEN/REFACTOR)
 * - Task progress (current/total)
 * - Supervisor status (watching/intervening/idle)
 *
 * State is persisted to ~/.oss/status-line.json for SwiftBar/Claude Code status line
 */
export type TDDPhase = 'RED' | 'GREEN' | 'REFACTOR';
export type SupervisorStatus = 'watching' | 'intervening' | 'idle';
export interface StatusLineState {
    phase: TDDPhase | null;
    task: string | null;
    supervisor: SupervisorStatus | null;
}
export declare class StatusLineService {
    private ossDir;
    private stateFile;
    private state;
    constructor(ossDir?: string);
    /**
     * Initialize service by loading existing state (if any)
     */
    initialize(): Promise<void>;
    /**
     * Get current status line state
     */
    getState(): Promise<StatusLineState>;
    /**
     * Set the current TDD phase
     */
    setTDDPhase(phase: TDDPhase): Promise<void>;
    /**
     * Set task progress
     */
    setTaskProgress(current: number, total: number): Promise<void>;
    /**
     * Set supervisor status
     */
    setSupervisorStatus(status: SupervisorStatus): Promise<void>;
    /**
     * Clear all state
     */
    clearState(): Promise<void>;
    /**
     * Persist state to file
     */
    private persist;
}
//# sourceMappingURL=status-line.d.ts.map