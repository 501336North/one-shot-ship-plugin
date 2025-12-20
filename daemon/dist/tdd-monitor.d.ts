/**
 * TddMonitor - Monitor TDD phase for staleness
 *
 * Detects when a TDD phase has been stuck for too long, which may
 * indicate a process is hung or the developer is stuck.
 */
import { Issue } from './state-manager.js';
export interface TddMonitorConfig {
    ossDir: string;
    staleThresholdMs: number;
}
export declare class TddMonitor {
    private stateFile;
    private staleThresholdMs;
    constructor(config: TddMonitorConfig);
    /**
     * Check if the current TDD phase has been stuck for too long
     */
    checkStaleTddPhase(): Promise<Issue | null>;
}
//# sourceMappingURL=tdd-monitor.d.ts.map