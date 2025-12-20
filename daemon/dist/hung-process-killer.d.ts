/**
 * HungProcessKiller - Kills processes that exceed timeout thresholds
 *
 * Manages timeout configurations per process type and handles safe
 * termination with logging.
 */
import { ProcessInfo, ProcessType } from './process-monitor.js';
export interface TimeoutConfig {
    timeoutMs: number;
}
export interface KillResult {
    success: boolean;
    pid: number;
    message: string;
    dryRun: boolean;
}
export interface HungProcessKillerConfig {
    logFile: string;
    timeouts?: {
        [key in ProcessType]?: number;
    };
}
export declare class HungProcessKiller {
    private config;
    private timeouts;
    constructor(config: HungProcessKillerConfig);
    /**
     * Get timeout configuration for a process type
     */
    getTimeoutConfig(type: ProcessType): TimeoutConfig;
    /**
     * Determine if a process should be killed based on its age
     */
    shouldKillProcess(process: ProcessInfo, type: ProcessType): boolean;
    /**
     * Log a kill action with full details
     */
    logKill(process: ProcessInfo, type: ProcessType, reason: string): Promise<void>;
    /**
     * Kill a process by PID
     * Uses SIGTERM first, then SIGKILL after grace period
     */
    killProcess(pid: number, dryRun?: boolean): Promise<KillResult>;
}
//# sourceMappingURL=hung-process-killer.d.ts.map