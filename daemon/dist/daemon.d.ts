/**
 * OssDaemon - Supervisor daemon for process monitoring and health checks
 *
 * Runs as a standalone process (via launchd) to:
 * - Monitor for hung test processes (vitest, npm test)
 * - Kill processes that exceed timeout thresholds
 * - Track system resource usage
 * - Send notifications on issues
 */
export interface DaemonConfig {
    ossDir: string;
    checkIntervalMs: number;
    processTimeoutMs: number;
}
export declare class OssDaemon {
    private config;
    private pidFile;
    private logFile;
    private running;
    private pendingOperations;
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
     * Log activity to daemon.log
     */
    log(message: string): Promise<void>;
    /**
     * Check if another daemon instance is running
     */
    private isDaemonRunning;
}
//# sourceMappingURL=daemon.d.ts.map