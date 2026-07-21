/**
 * WatcherSupervisor - Orchestrates workflow monitoring and interventions
 *
 * Combines LogReader, WorkflowAnalyzer, and InterventionGenerator to:
 * - Monitor workflow logs in real-time
 * - Detect issues and generate interventions
 * - Persist state for continuity
 */
import * as fs from 'fs';
import * as path from 'path';
import { LogReader } from '../logger/log-reader.js';
import { WorkflowAnalyzer } from '../analyzer/workflow-analyzer.js';
import { InterventionGenerator } from '../intervention/generator.js';
import { WorkflowLogger } from '../logger/workflow-logger.js';
import { StatusLineService } from '../services/status-line.js';
import { TelegramNotifier } from '../services/telegram-notifier.js';
import { IronLawMonitor } from '../services/iron-law-monitor.js';
import { SettingsService } from '../services/settings.js';
import { BoundedLruSet } from './lru-set.js';
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
export const ANALYSIS_WINDOW = 500;
export const DEDUP_CACHE_LIMIT = 1000;
export const STATE_SAVE_THRESHOLD = 20;
/** A fresh, empty anchor accumulator (nothing seen yet this session). */
function emptyAnchors() {
    return {
        firstCommand: undefined,
        chainProgress: { ideate: 'pending', plan: 'pending', build: 'pending', ship: 'pending' },
        seenPhases: [],
        completedPhases: [],
    };
}
export class WatcherSupervisor {
    ossDir;
    statePath;
    logReader;
    analyzer;
    interventionGenerator;
    queueManager;
    ironLawMonitor;
    settingsService;
    healthcheckService;
    healthcheckIntervalMs;
    running = false;
    entries = [];
    state;
    // Session-lifetime anchor facts — accumulated on EVERY entry BEFORE windowing,
    // so eviction of old entries can never starve the session-lifetime detectors.
    anchors = emptyAnchors();
    // Emit the window-drop notice exactly once per session (observability, not spam)
    windowDropNotified = false;
    // Throttled state persistence: count entries since the last disk write.
    entriesSinceSave = 0;
    hasPersistedOnce = false;
    analyzeCallbacks = [];
    interventionCallbacks = [];
    notifyCallbacks = [];
    ironLawCallbacks = [];
    // Track which issues we've already generated interventions for.
    // Bounded LRU (not an unbounded Set) so a long session cannot leak memory.
    processedIssueSignatures = new BoundedLruSet(DEDUP_CACHE_LIMIT);
    // IRON LAW monitoring interval
    ironLawInterval = null;
    // Healthcheck monitoring interval
    healthcheckInterval = null;
    // Track notified healthcheck issues to deduplicate (bounded LRU, see above).
    notifiedHealthcheckIssues = new BoundedLruSet(DEDUP_CACHE_LIMIT);
    constructor(ossDir, queueManager, options) {
        this.ossDir = ossDir;
        this.statePath = path.join(ossDir, 'workflow-state.json');
        this.logReader = new LogReader(ossDir);
        this.analyzer = new WorkflowAnalyzer();
        // Wire the structured-error healing ports (US-005/US-006) into the generator
        // so escalation, retry-status-line visibility, and RECOVERY logging fire in
        // production — not just in the E2E test. Telegram is optional: when no bridge
        // URL is configured, escalation simply no-ops (generator swallows absence).
        const bridgeUrl = process.env.OSS_TELEGRAM_BRIDGE_URL;
        this.interventionGenerator = new InterventionGenerator({
            recoveryLogger: new WorkflowLogger(ossDir),
            statusLine: new StatusLineService(ossDir),
            notifier: bridgeUrl ? new TelegramNotifier(bridgeUrl) : undefined,
        });
        this.queueManager = queueManager;
        // Initialize IRON LAW monitor
        const projectDir = options?.projectDir || process.cwd();
        const configDir = options?.configDir || path.join(process.env.HOME || '~', '.oss');
        this.settingsService = new SettingsService(configDir);
        this.ironLawMonitor = new IronLawMonitor({
            projectDir,
            stateFile: path.join(configDir, 'iron-law-state.json'),
        });
        // Initialize healthcheck service
        this.healthcheckService = options?.healthcheckService;
        this.healthcheckIntervalMs = options?.healthcheckIntervalMs || 60000; // Default 1 minute
        // Initialize state
        this.state = {
            chain_progress: {
                ideate: 'pending',
                plan: 'pending',
                build: 'pending',
                ship: 'pending',
            },
            milestone_timestamps: [],
        };
    }
    /**
     * Start monitoring workflow logs
     */
    async start() {
        if (this.running)
            return;
        this.running = true;
        // Load existing state or rebuild from log
        await this.loadState();
        // Start tailing the log
        this.logReader.startTailing((entry) => this.handleEntry(entry));
        // Start IRON LAW monitoring if mode is "always"
        const supervisorSettings = this.settingsService.getSupervisorSettings();
        if (supervisorSettings.mode === 'always') {
            this.startIronLawMonitoring(supervisorSettings.checkIntervalMs);
        }
        // Start healthcheck monitoring if service provided
        if (this.healthcheckService) {
            this.startHealthcheckMonitoring();
        }
    }
    /**
     * Start IRON LAW monitoring on interval
     */
    startIronLawMonitoring(intervalMs) {
        if (this.ironLawInterval)
            return;
        this.ironLawInterval = setInterval(async () => {
            await this.runIronLawChecks();
        }, intervalMs);
        // Run immediately on start
        void this.runIronLawChecks();
    }
    /**
     * Start healthcheck monitoring on interval
     */
    startHealthcheckMonitoring() {
        if (this.healthcheckInterval)
            return;
        this.healthcheckInterval = setInterval(async () => {
            await this.runHealthchecks();
        }, this.healthcheckIntervalMs);
        // Run immediately on start
        void this.runHealthchecks();
    }
    /**
     * Run healthchecks and handle issues
     */
    async runHealthchecks() {
        if (!this.healthcheckService)
            return;
        try {
            const report = await this.healthcheckService.runChecks();
            // Process each check result
            for (const [checkName, result] of Object.entries(report.checks)) {
                if (result.status === 'fail') {
                    await this.handleHealthcheckFailure(checkName, result);
                }
                else if (result.status === 'warn') {
                    await this.handleHealthcheckWarning(checkName, result);
                }
            }
        }
        catch {
            // Ignore errors in healthcheck
        }
    }
    /**
     * Handle healthcheck failure (critical issue)
     */
    async handleHealthcheckFailure(checkName, result) {
        const signature = `healthcheck:${checkName}:${result.message}`;
        // Deduplicate notifications
        if (this.notifiedHealthcheckIssues.has(signature)) {
            return;
        }
        this.notifiedHealthcheckIssues.add(signature);
        // Send critical notification
        for (const callback of this.notifyCallbacks) {
            callback(`Critical: ${this.formatCheckName(checkName)}`, result.message, 'Basso' // Warning sound
            );
        }
        // Queue corrective action if details include action
        const action = result.details?.action;
        if (typeof action === 'string') {
            const taskInput = {
                priority: 'high',
                source: 'iron-law-monitor',
                anomaly_type: 'unusual_pattern',
                prompt: action,
                suggested_agent: 'general-purpose',
                context: {
                    type: checkName,
                    message: result.message,
                },
            };
            await this.queueManager.addTask(taskInput);
        }
    }
    /**
     * Handle healthcheck warning
     */
    async handleHealthcheckWarning(checkName, result) {
        const signature = `healthcheck:${checkName}:${result.message}`;
        // Deduplicate notifications
        if (this.notifiedHealthcheckIssues.has(signature)) {
            return;
        }
        this.notifiedHealthcheckIssues.add(signature);
        // Send warning notification
        for (const callback of this.notifyCallbacks) {
            callback(`Warning: ${this.formatCheckName(checkName)}`, result.message, 'Funk' // Softer warning sound
            );
        }
        // Queue corrective action
        const detailAction = result.details?.action;
        const action = typeof detailAction === 'string' ? detailAction : `Fix ${checkName} issue: ${result.message}`;
        const taskInput = {
            priority: 'medium',
            source: 'iron-law-monitor',
            anomaly_type: 'unusual_pattern',
            prompt: action,
            suggested_agent: 'general-purpose',
            context: {
                type: checkName,
                message: result.message,
            },
        };
        await this.queueManager.addTask(taskInput);
    }
    /**
     * Format check name for display
     */
    formatCheckName(checkName) {
        return checkName
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
    /**
     * Run IRON LAW checks and handle violations
     */
    async runIronLawChecks() {
        try {
            const violations = await this.ironLawMonitor.check();
            // Notify iron law callbacks
            if (violations.length > 0) {
                for (const callback of this.ironLawCallbacks) {
                    callback(violations);
                }
                // Generate interventions for violations
                for (const violation of violations) {
                    const signature = `iron_law:${violation.type}:${violation.message}`;
                    if (this.processedIssueSignatures.has(signature)) {
                        continue;
                    }
                    this.processedIssueSignatures.add(signature);
                    // Notify notification callbacks
                    for (const callback of this.notifyCallbacks) {
                        callback(`IRON LAW #${violation.law}`, violation.message, 'Basso' // Warning sound
                        );
                    }
                    // Add corrective action to queue
                    if (violation.correctiveAction) {
                        const taskInput = {
                            priority: 'high',
                            source: 'iron-law-monitor',
                            anomaly_type: 'unusual_pattern',
                            prompt: violation.correctiveAction,
                            suggested_agent: 'general-purpose',
                            context: {
                                law: violation.law,
                                type: violation.type,
                                message: violation.message,
                            },
                        };
                        await this.queueManager.addTask(taskInput);
                    }
                }
            }
        }
        catch {
            // Ignore errors in IRON LAW checks
        }
    }
    /**
     * Stop monitoring
     */
    async stop() {
        if (!this.running)
            return;
        this.running = false;
        // Stop IRON LAW monitoring
        if (this.ironLawInterval) {
            clearInterval(this.ironLawInterval);
            this.ironLawInterval = null;
        }
        // Stop healthcheck monitoring
        if (this.healthcheckInterval) {
            clearInterval(this.healthcheckInterval);
            this.healthcheckInterval = null;
        }
        this.logReader.stopTailing();
        await this.saveState();
    }
    /**
     * Check if supervisor is running
     */
    isRunning() {
        return this.running;
    }
    /**
     * Get current state
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Register callback for analysis events
     */
    onAnalyze(callback) {
        this.analyzeCallbacks.push(callback);
    }
    /**
     * Register callback for intervention events
     */
    onIntervention(callback) {
        this.interventionCallbacks.push(callback);
    }
    /**
     * Register callback for notification events
     */
    onNotify(callback) {
        this.notifyCallbacks.push(callback);
    }
    /**
     * Register callback for IRON LAW violation events
     */
    onIronLawViolation(callback) {
        this.ironLawCallbacks.push(callback);
    }
    /**
     * Manually trigger IRON LAW check (for testing or on-demand)
     */
    async checkIronLaws() {
        return this.ironLawMonitor.check();
    }
    /**
     * Track file change for TDD monitoring
     */
    trackFileChange(filePath, action) {
        this.ironLawMonitor.trackFileChange(filePath, action);
    }
    /**
     * Track tool call for TDD order verification
     */
    trackToolCall(tool, filePath) {
        this.ironLawMonitor.trackToolCall(tool, filePath);
    }
    /**
     * Set active feature for dev docs monitoring
     */
    setActiveFeature(featureName) {
        this.ironLawMonitor.setActiveFeature(featureName);
    }
    async handleEntry(entry) {
        // Add to entries, then bound the retained history so per-entry analyzer work
        // stays O(window) instead of O(N) (prevents O(N²) growth over a long session).
        this.entries.push(entry);
        // Accumulate session-lifetime anchors BEFORE trimming so facts that scroll out
        // of the window (first START, completed chain steps, seen/completed phases)
        // still reach the analyzer.
        this.accumulateAnchors(entry);
        this.retainWindow();
        // Analyze current state (bounded window + durable anchors)
        const analysis = this.analyzer.analyze(this.entries, new Date(), this.anchors);
        // Update state
        this.updateState(analysis);
        // Notify analyze callbacks
        for (const callback of this.analyzeCallbacks) {
            callback(analysis, this.entries);
        }
        // Process issues and generate interventions
        for (const issue of analysis.issues) {
            const signature = this.getIssueSignature(issue);
            if (this.processedIssueSignatures.has(signature)) {
                continue; // Already handled this issue
            }
            const intervention = this.interventionGenerator.generate(issue);
            this.processedIssueSignatures.add(signature);
            // Notify intervention callbacks
            for (const callback of this.interventionCallbacks) {
                callback(intervention);
            }
            // Notify notification callbacks
            for (const callback of this.notifyCallbacks) {
                callback(intervention.notification.title, intervention.notification.message, intervention.notification.sound);
            }
            // Add to queue if has queue task
            if (intervention.queue_task) {
                const taskInput = {
                    priority: this.mapPriority(intervention.queue_task.priority),
                    source: 'log-monitor',
                    anomaly_type: this.mapIssueTypeToAnomaly(issue.type),
                    prompt: intervention.queue_task.prompt,
                    suggested_agent: intervention.queue_task.agent_type || 'debugger',
                    context: {
                        analysis: issue.message,
                        confidence: issue.confidence,
                    },
                };
                await this.queueManager.addTask(taskInput);
            }
        }
        // Persist state on a throttled cadence (not once per log line).
        await this.maybePersistState();
    }
    /**
     * Throttle state persistence: write on the very first entry (so the state file
     * is fresh immediately) and then at most once per STATE_SAVE_THRESHOLD entries.
     * stop() calls saveState() directly to flush the latest state on shutdown.
     */
    async maybePersistState() {
        this.entriesSinceSave++;
        if (!this.hasPersistedOnce || this.entriesSinceSave >= STATE_SAVE_THRESHOLD) {
            this.hasPersistedOnce = true;
            this.entriesSinceSave = 0;
            await this.saveState();
        }
    }
    /**
     * Fold one entry into the session-lifetime anchors. Called on EVERY entry
     * BEFORE retainWindow(), so the anchors record facts even after the entry that
     * carried them is evicted. The anchor set is a tiny, fixed shape — NOT a copy
     * of the full entry history — so it stays O(1) in memory over a long session.
     */
    accumulateAnchors(entry) {
        const chain = this.anchors.chainProgress;
        if (entry.event === 'START') {
            if (!this.anchors.firstCommand) {
                this.anchors.firstCommand = entry.cmd;
            }
            if (entry.cmd in chain && chain[entry.cmd] === 'pending') {
                chain[entry.cmd] = 'in_progress';
            }
        }
        if (entry.event === 'COMPLETE' && entry.cmd in chain) {
            chain[entry.cmd] = 'complete';
        }
        if (entry.event === 'FAILED' && entry.cmd in chain) {
            chain[entry.cmd] = 'failed';
        }
        if (entry.event === 'PHASE_START' && entry.phase && !this.anchors.seenPhases.includes(entry.phase)) {
            this.anchors.seenPhases.push(entry.phase);
        }
        if (entry.event === 'PHASE_COMPLETE' &&
            entry.phase &&
            !this.anchors.completedPhases.includes(entry.phase)) {
            this.anchors.completedPhases.push(entry.phase);
        }
    }
    /**
     * Bound the retained entry history to ANALYSIS_WINDOW. Drops the oldest
     * entries beyond the window and logs the truncation exactly once per session.
     * The notice goes to console (not workflow.log) on purpose: the LogReader is
     * actively tailing workflow.log, so writing there would re-ingest the notice.
     */
    retainWindow() {
        if (this.entries.length <= ANALYSIS_WINDOW)
            return;
        const dropped = this.entries.length - ANALYSIS_WINDOW;
        this.entries = this.entries.slice(-ANALYSIS_WINDOW);
        if (!this.windowDropNotified) {
            this.windowDropNotified = true;
            console.warn(`[watcher] analysis window full: retaining the ${ANALYSIS_WINDOW} most ` +
                `recent log entries; older entries (${dropped}+) are no longer re-scanned.`);
        }
    }
    updateState(analysis) {
        if (analysis.current_command) {
            this.state.current_command = analysis.current_command;
        }
        if (analysis.current_phase) {
            this.state.current_phase = analysis.current_phase;
        }
        if (analysis.last_activity_time) {
            this.state.last_activity_time = analysis.last_activity_time;
        }
        // Update chain progress
        this.state.chain_progress = analysis.chain_progress;
        this.state.milestone_timestamps = analysis.milestone_timestamps;
    }
    async loadState() {
        // Try to load existing state
        if (fs.existsSync(this.statePath)) {
            try {
                const data = fs.readFileSync(this.statePath, 'utf-8');
                this.state = JSON.parse(data);
                // Restore persisted anchors; if the state file predates anchors, rebuild
                // them from the full log so session-lifetime detectors stay correct.
                if (this.state.anchors) {
                    this.anchors = this.normalizeAnchors(this.state.anchors);
                }
                else {
                    await this.rebuildAnchorsFromLog();
                }
                return;
            }
            catch {
                // Fall through to rebuild from log
            }
        }
        // Rebuild from log
        const existingEntries = await this.logReader.readAll();
        if (existingEntries.length > 0) {
            // Accumulate anchors across the FULL history before trimming the window.
            for (const entry of existingEntries) {
                this.accumulateAnchors(entry);
            }
            this.entries = existingEntries;
            this.retainWindow();
            const analysis = this.analyzer.analyze(this.entries, new Date(), this.anchors);
            this.updateState(analysis);
        }
    }
    /**
     * Rebuild anchors by replaying the full log (used when a persisted state file
     * predates the anchors field). Does not touch the analysis window.
     */
    async rebuildAnchorsFromLog() {
        const existingEntries = await this.logReader.readAll();
        for (const entry of existingEntries) {
            this.accumulateAnchors(entry);
        }
    }
    /**
     * Coerce a parsed-from-JSON anchors object into a complete WorkflowAnchors,
     * filling any field a hand-edited or partial state file might omit.
     */
    normalizeAnchors(raw) {
        const base = emptyAnchors();
        if (!raw)
            return base;
        return {
            firstCommand: raw.firstCommand ?? base.firstCommand,
            chainProgress: { ...base.chainProgress, ...(raw.chainProgress ?? {}) },
            seenPhases: Array.isArray(raw.seenPhases) ? [...raw.seenPhases] : base.seenPhases,
            completedPhases: Array.isArray(raw.completedPhases) ? [...raw.completedPhases] : base.completedPhases,
        };
    }
    async saveState() {
        try {
            // Fold the live anchors into the persisted state so they survive a restart.
            this.state.anchors = this.anchors;
            fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
        }
        catch {
            // Ignore write errors
        }
    }
    getIssueSignature(issue) {
        // Create a signature that identifies unique issues
        // We don't want to keep firing interventions for the same issue
        return `${issue.type}:${issue.message}`;
    }
    mapPriority(priority) {
        switch (priority) {
            case 'high':
                return 'high';
            case 'medium':
                return 'medium';
            case 'low':
                return 'low';
        }
    }
    mapIssueTypeToAnomaly(issueType) {
        // Map workflow issue types to existing anomaly types
        switch (issueType) {
            case 'loop_detected':
                return 'agent_loop';
            case 'phase_stuck':
            case 'abrupt_stop':
            case 'partial_completion':
                return 'agent_stuck';
            case 'explicit_failure':
            case 'agent_failed':
            case 'regression':
                return 'agent_error';
            case 'tdd_violation':
            case 'out_of_order':
            case 'chain_broken':
            case 'missing_milestones':
            case 'incomplete_outputs':
                return 'unusual_pattern';
            case 'silence':
            case 'declining_velocity':
            case 'agent_silence':
            case 'abandoned_agent':
                return 'recommended_investigation';
            default:
                return 'unusual_pattern';
        }
    }
}
//# sourceMappingURL=watcher-supervisor.js.map