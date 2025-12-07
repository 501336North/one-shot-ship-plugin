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
import { IronLawMonitor } from '../services/iron-law-monitor.js';
import { SettingsService } from '../services/settings.js';
export class WatcherSupervisor {
    ossDir;
    statePath;
    logReader;
    analyzer;
    interventionGenerator;
    queueManager;
    ironLawMonitor;
    settingsService;
    running = false;
    entries = [];
    state;
    analyzeCallbacks = [];
    interventionCallbacks = [];
    notifyCallbacks = [];
    ironLawCallbacks = [];
    // Track which issues we've already generated interventions for
    processedIssueSignatures = new Set();
    // IRON LAW monitoring interval
    ironLawInterval = null;
    constructor(ossDir, queueManager, options) {
        this.ossDir = ossDir;
        this.statePath = path.join(ossDir, 'workflow-state.json');
        this.logReader = new LogReader(ossDir);
        this.analyzer = new WorkflowAnalyzer();
        this.interventionGenerator = new InterventionGenerator();
        this.queueManager = queueManager;
        // Initialize IRON LAW monitor
        const projectDir = options?.projectDir || process.cwd();
        const configDir = options?.configDir || path.join(process.env.HOME || '~', '.oss');
        this.settingsService = new SettingsService(configDir);
        this.ironLawMonitor = new IronLawMonitor({
            projectDir,
            stateFile: path.join(configDir, 'iron-law-state.json'),
        });
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
        // Add to entries
        this.entries.push(entry);
        // Analyze current state
        const analysis = this.analyzer.analyze(this.entries);
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
        // Save state periodically
        await this.saveState();
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
                return;
            }
            catch {
                // Fall through to rebuild from log
            }
        }
        // Rebuild from log
        const existingEntries = await this.logReader.readAll();
        if (existingEntries.length > 0) {
            this.entries = existingEntries;
            const analysis = this.analyzer.analyze(existingEntries);
            this.updateState(analysis);
        }
    }
    async saveState() {
        try {
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