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
    private running;
    private entries;
    private state;
    private analyzeCallbacks;
    private interventionCallbacks;
    private notifyCallbacks;
    private ironLawCallbacks;
    private processedIssueSignatures;
    private ironLawInterval;
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
    private updateState;
    private loadState;
    private saveState;
    private getIssueSignature;
    private mapPriority;
    private mapIssueTypeToAnomaly;
}
export {};
//# sourceMappingURL=watcher-supervisor.d.ts.map