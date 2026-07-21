/**
 * WatcherSupervisor - Orchestrates workflow monitoring and interventions
 *
 * Combines LogReader, WorkflowAnalyzer, and InterventionGenerator to:
 * - Monitor workflow logs in real-time
 * - Detect issues and generate interventions
 * - Persist state for continuity
 */
import { ParsedLogEntry } from '../logger/log-reader.js';
import { WorkflowAnalysis } from '../analyzer/workflow-analyzer.js';
import { Intervention } from '../intervention/generator.js';
import { QueueManager } from '../queue/manager.js';
import { IronLawViolation } from '../services/iron-law-monitor.js';
import { HealthcheckService } from '../services/healthcheck.js';
/**
 * Perf bounds (Phase A-perf). Long-running watcher sessions must stay responsive
 * and memory-stable regardless of how many log lines have streamed through.
 *
 * ANALYSIS_WINDOW — max recent entries retained and handed to the analyzer per
 * cycle. Chosen well above every detector's real lookback: detectLoops reads the
 * last 10; regression/tdd/out-of-order/iron-law scan the array but their paired
 * events (PHASE_COMPLETE→FAILED, RED→GREEN, repeated violations) occur within a
 * single command's span, comfortably inside 500. Widen this — never break a
 * detector — if a test proves a real lookback needs more.
 *
 * DEDUP_CACHE_LIMIT — cap for the LRU dedup caches (processedIssueSignatures,
 * notifiedHealthcheckIssues). 1000 unique signatures/notifications far exceeds
 * any realistic single session, so an ACTIVE dedup entry is never evicted; only
 * ancient, no-longer-relevant signatures free their slot.
 *
 * STATE_SAVE_THRESHOLD — persist state at most once per this many entries
 * (instead of a synchronous writeFileSync on EVERY line). A leading write on the
 * first entry keeps the state file fresh from the start, and stop() always
 * flushes the latest state so nothing is lost on shutdown.
 *
 * Note: milestone_timestamps needs no separate cap — it is derived from the
 * windowed entries, so it is already bounded by ANALYSIS_WINDOW.
 */
export declare const ANALYSIS_WINDOW = 500;
export declare const DEDUP_CACHE_LIMIT = 1000;
export declare const STATE_SAVE_THRESHOLD = 20;
export interface SupervisorState {
    current_command?: string;
    current_phase?: string;
    chain_progress: {
        ideate: string;
        plan: string;
        build: string;
        ship: string;
    };
    milestone_timestamps: string[];
    last_activity_time?: string;
}
type AnalyzeCallback = (analysis: WorkflowAnalysis, entries: ParsedLogEntry[]) => void;
type InterventionCallback = (intervention: Intervention) => void;
type NotifyCallback = (title: string, message: string, sound?: string) => void;
type IronLawCallback = (violations: IronLawViolation[]) => void;
export interface WatcherSupervisorOptions {
    ossDir: string;
    projectDir?: string;
    configDir?: string;
    healthcheckService?: HealthcheckService;
    healthcheckIntervalMs?: number;
}
export declare class WatcherSupervisor {
    private readonly ossDir;
    private readonly statePath;
    private readonly logReader;
    private readonly analyzer;
    private readonly interventionGenerator;
    private readonly queueManager;
    private readonly ironLawMonitor;
    private readonly settingsService;
    private readonly healthcheckService?;
    private readonly healthcheckIntervalMs;
    private running;
    private entries;
    private state;
    private windowDropNotified;
    private entriesSinceSave;
    private hasPersistedOnce;
    private analyzeCallbacks;
    private interventionCallbacks;
    private notifyCallbacks;
    private ironLawCallbacks;
    private processedIssueSignatures;
    private ironLawInterval;
    private healthcheckInterval;
    private notifiedHealthcheckIssues;
    constructor(ossDir: string, queueManager: QueueManager, options?: Partial<WatcherSupervisorOptions>);
    /**
     * Start monitoring workflow logs
     */
    start(): Promise<void>;
    /**
     * Start IRON LAW monitoring on interval
     */
    private startIronLawMonitoring;
    /**
     * Start healthcheck monitoring on interval
     */
    private startHealthcheckMonitoring;
    /**
     * Run healthchecks and handle issues
     */
    private runHealthchecks;
    /**
     * Handle healthcheck failure (critical issue)
     */
    private handleHealthcheckFailure;
    /**
     * Handle healthcheck warning
     */
    private handleHealthcheckWarning;
    /**
     * Format check name for display
     */
    private formatCheckName;
    /**
     * Run IRON LAW checks and handle violations
     */
    private runIronLawChecks;
    /**
     * Stop monitoring
     */
    stop(): Promise<void>;
    /**
     * Check if supervisor is running
     */
    isRunning(): boolean;
    /**
     * Get current state
     */
    getState(): SupervisorState;
    /**
     * Register callback for analysis events
     */
    onAnalyze(callback: AnalyzeCallback): void;
    /**
     * Register callback for intervention events
     */
    onIntervention(callback: InterventionCallback): void;
    /**
     * Register callback for notification events
     */
    onNotify(callback: NotifyCallback): void;
    /**
     * Register callback for IRON LAW violation events
     */
    onIronLawViolation(callback: IronLawCallback): void;
    /**
     * Manually trigger IRON LAW check (for testing or on-demand)
     */
    checkIronLaws(): Promise<IronLawViolation[]>;
    /**
     * Track file change for TDD monitoring
     */
    trackFileChange(filePath: string, action: 'created' | 'modified' | 'deleted'): void;
    /**
     * Track tool call for TDD order verification
     */
    trackToolCall(tool: string, filePath: string): void;
    /**
     * Set active feature for dev docs monitoring
     */
    setActiveFeature(featureName: string): void;
    private handleEntry;
    /**
     * Throttle state persistence: write on the very first entry (so the state file
     * is fresh immediately) and then at most once per STATE_SAVE_THRESHOLD entries.
     * stop() calls saveState() directly to flush the latest state on shutdown.
     */
    private maybePersistState;
    /**
     * Bound the retained entry history to ANALYSIS_WINDOW. Drops the oldest
     * entries beyond the window and logs the truncation exactly once per session.
     * The notice goes to console (not workflow.log) on purpose: the LogReader is
     * actively tailing workflow.log, so writing there would re-ingest the notice.
     */
    private retainWindow;
    private updateState;
    private loadState;
    private saveState;
    private getIssueSignature;
    private mapPriority;
    private mapIssueTypeToAnomaly;
}
export {};
//# sourceMappingURL=watcher-supervisor.d.ts.map