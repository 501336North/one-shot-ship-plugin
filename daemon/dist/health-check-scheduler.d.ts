/**
 * HealthCheckScheduler - Runs health checks on a configurable schedule
 *
 * Executes health check commands periodically and logs results.
 */
export interface SchedulerConfig {
    ossDir: string;
    intervalMs?: number;
    healthCheckCommand?: string;
}
export interface HealthCheckResult {
    success: boolean;
    timestamp: Date;
    duration: number;
    output: string;
    error?: string;
}
export declare class HealthCheckScheduler {
    private config;
    private intervalId;
    private lastResult;
    constructor(config: SchedulerConfig);
    /**
     * Get current configuration
     */
    getConfig(): Required<SchedulerConfig>;
    /**
     * Run a health check and return the result
     */
    runHealthCheck(): Promise<HealthCheckResult>;
    /**
     * Log health check result to file
     */
    private logResult;
    /**
     * Start the scheduler
     */
    start(): void;
    /**
     * Stop the scheduler
     */
    stop(): void;
    /**
     * Check if scheduler is running
     */
    isRunning(): boolean;
    /**
     * Get the last health check result
     */
    getLastResult(): HealthCheckResult | null;
}
//# sourceMappingURL=health-check-scheduler.d.ts.map