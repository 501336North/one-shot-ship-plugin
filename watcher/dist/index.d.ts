import { QueueManager } from './queue/manager.js';
import { LogMonitor } from './monitors/log-monitor.js';
import { TestMonitor } from './monitors/test-monitor.js';
import { GitMonitor } from './monitors/git-monitor.js';
import { WatcherConfig } from './types.js';
/**
 * Watcher state enum
 */
export declare enum WatcherState {
    Idle = "idle",
    Running = "running",
    Stopped = "stopped"
}
/**
 * Main Watcher Process
 *
 * Implements US-001 from REQUIREMENTS.md
 */
export declare class Watcher {
    private readonly ossDir;
    private readonly apiKey;
    private readonly pidPath;
    private readonly logPath;
    private readonly configPath;
    private state;
    private queueManager;
    private ruleEngine;
    private logMonitor;
    private testMonitor;
    private gitMonitor;
    private llmAnalyzer;
    private config;
    constructor(ossDir: string, apiKey: string);
    /**
     * Start the watcher process
     * @returns true if started, false if another watcher already running
     */
    start(): Promise<boolean>;
    /**
     * Stop the watcher process
     */
    stop(): Promise<void>;
    /**
     * Get current watcher state
     */
    getState(): WatcherState;
    /**
     * Check if another watcher process is running
     */
    isAnotherWatcherRunning(): Promise<boolean>;
    /**
     * Clean up stale PID file if process not running
     */
    cleanupStalePidFile(): Promise<void>;
    /**
     * Load configuration from file or use defaults
     */
    loadConfig(): Promise<WatcherConfig>;
    /**
     * Process a log line (for integration with Claude Code hooks)
     */
    processLog(line: string): Promise<void>;
    /**
     * Get the queue manager (for hooks)
     */
    getQueueManager(): QueueManager | null;
    /**
     * Get the log monitor (for hooks)
     */
    getLogMonitor(): LogMonitor | null;
    /**
     * Get the test monitor (for hooks)
     */
    getTestMonitor(): TestMonitor | null;
    /**
     * Get the git monitor (for hooks)
     */
    getGitMonitor(): GitMonitor | null;
    /**
     * Run health check - execute npm test and queue any failures
     * This should be called on session start to catch pre-existing issues
     */
    runHealthCheck(): Promise<{
        passed: boolean;
        failureCount: number;
        message: string;
    }>;
    /**
     * Send a notification via oss-notify.sh or status line CLI
     * All runtime notifications use the status line as the visual notification mechanism
     */
    private sendNotification;
    /**
     * Write to log file with timestamp
     */
    private log;
}
export { QueueManager } from './queue/manager.js';
export { RuleEngine, RuleMatch } from './detectors/rules.js';
export { LogMonitor } from './monitors/log-monitor.js';
export { TestMonitor, TestResult } from './monitors/test-monitor.js';
export { GitMonitor, CIStatus, PRCheckResult } from './monitors/git-monitor.js';
export { LLMAnalyzer, LLMAnalysisResult } from './detectors/llm-analyzer.js';
export * from './types.js';
//# sourceMappingURL=index.d.ts.map