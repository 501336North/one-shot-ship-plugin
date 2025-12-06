import { QueueManager } from '../queue/manager.js';
import { RuleEngine } from '../detectors/rules.js';
/**
 * Log Monitor - Monitors agent output for anomalies
 *
 * Implements AC-002.1 through AC-002.5 from REQUIREMENTS.md
 */
export declare class LogMonitor {
    private readonly queueManager;
    private readonly ruleEngine;
    private readonly logBuffer;
    private readonly maxBufferSize;
    private lastActivityTime;
    private stuckReported;
    constructor(queueManager: QueueManager, ruleEngine: RuleEngine, maxBufferSize?: number);
    /**
     * Process a single log line
     */
    processLine(line: string): Promise<void>;
    /**
     * Get recent logs as a single string
     */
    getRecentLogs(count: number): string;
    /**
     * Get the timestamp of last activity
     */
    getLastActivityTime(): number;
    /**
     * Check if agent appears stuck (no output for specified seconds)
     */
    checkIfStuck(timeoutSeconds: number): boolean;
    /**
     * Check if stuck and create task if so
     */
    checkAndReportStuck(timeoutSeconds: number): Promise<void>;
    /**
     * Analyze aggregated logs for patterns that span multiple lines
     */
    analyzeAggregated(): Promise<void>;
    /**
     * Reset monitor state
     */
    reset(): void;
    /**
     * Create a task from a rule match
     */
    private createTask;
}
//# sourceMappingURL=log-monitor.d.ts.map