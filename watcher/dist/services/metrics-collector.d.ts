/**
 * Metrics Collector Service
 *
 * Aggregates workflow telemetry to prove ROI and drive improvements.
 * Tracks session duration, command success rates, TDD phase timing.
 */
interface SessionMetrics {
    duration: number;
    commandCount: number;
    successCount: number;
    failureCount: number;
    successRate: number;
}
interface CommandMetrics {
    command: string;
    count: number;
    successCount: number;
    failureCount: number;
    averageDuration: number;
}
interface DailyMetrics {
    date: string;
    sessionCount: number;
    totalCommands: number;
    successRate: number;
}
interface AllTimeMetrics {
    totalSessions: number;
    totalCommands: number;
    totalSuccesses: number;
    totalFailures: number;
    averageSessionDuration: number;
    successRate: number;
}
interface TddMetrics {
    redPhaseTime: number;
    greenPhaseTime: number;
    refactorPhaseTime: number;
    cycleCount: number;
}
interface MetricsCollectorOptions {
    retentionDays?: number;
}
export declare class MetricsCollector {
    private metricsFile;
    private retentionDays;
    private currentSession;
    private currentCommand;
    private currentTddPhase;
    private data;
    constructor(options?: MetricsCollectorOptions);
    /**
     * Start a new session
     */
    startSession(): void;
    /**
     * End the current session
     */
    endSession(): void;
    /**
     * Record a command execution
     */
    recordCommand(command: string, status: 'success' | 'failure'): void;
    /**
     * Start timing a command
     */
    startCommand(command: string): void;
    /**
     * End timing a command
     */
    endCommand(command: string, status: 'success' | 'failure'): void;
    /**
     * Start a TDD phase
     */
    startTddPhase(phase: 'red' | 'green' | 'refactor'): void;
    /**
     * End a TDD phase
     */
    endTddPhase(phase: 'red' | 'green' | 'refactor'): void;
    /**
     * Get metrics for current session
     */
    getSessionMetrics(): SessionMetrics;
    /**
     * Get metrics for a specific command
     */
    getCommandMetrics(command: string): CommandMetrics;
    /**
     * Get top commands by usage
     */
    getTopCommands(limit: number): {
        command: string;
        count: number;
    }[];
    /**
     * Get daily metrics
     */
    getDailyMetrics(): DailyMetrics;
    /**
     * Get all-time metrics
     */
    getAllTimeMetrics(): AllTimeMetrics;
    /**
     * Get TDD metrics
     */
    getTddMetrics(): TddMetrics;
    /**
     * Get retention period in days
     */
    getRetentionDays(): number;
    /**
     * Save metrics to disk
     */
    save(): void;
    /**
     * Load metrics from disk and prune data older than retention period
     */
    load(): void;
    /**
     * Prune sessions and TDD phases older than retention period
     */
    private pruneOldData;
    /**
     * Clear all metrics
     */
    clear(): void;
}
export {};
//# sourceMappingURL=metrics-collector.d.ts.map