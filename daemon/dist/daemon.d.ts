/**
 * OssDaemon - Supervisor daemon for process monitoring and health checks
 *
 * Runs as a standalone process (via launchd) to:
 * - Monitor for hung test processes (vitest, npm test)
 * - Kill processes that exceed timeout thresholds
 * - Track system resource usage
 * - Send notifications on issues
 */
import { Issue } from './state-manager.js';
export interface DaemonConfig {
    ossDir: string;
    checkIntervalMs: number;
    processTimeoutMs: number;
}
export declare class OssDaemon {
    private config;
    private pidFile;
    private logFile;
    private stateFile;
    private running;
    private pendingOperations;
    private interval;
    private tickCount;
    constructor(config: DaemonConfig);
    /**
     * Start the daemon
     */
    start(): Promise<void>;
    /**
     * Stop the daemon
     */
    stop(): Promise<void>;
    /**
     * Check if daemon is running
     */
    isRunning(): boolean;
    /**
     * Get the number of monitoring ticks that have occurred
     */
    getTickCount(): number;
    /**
     * Single tick of the monitoring loop
     */
    private tick;
    /**
     * Update heartbeat in workflow-state.json
     */
    private updateHeartbeat;
    /**
     * Log activity to daemon.log
     */
    log(message: string): Promise<void>;
    /**
     * Check if another daemon instance is running
     */
    private isDaemonRunning;
    /**
     * Prioritize issues by severity (error > warning > info)
     * Returns the highest priority issue, or null if empty
     */
    static prioritizeIssues(issues: Issue[]): Issue | null;
}
//# sourceMappingURL=daemon.d.ts.map