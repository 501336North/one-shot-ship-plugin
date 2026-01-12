import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { QueueManager } from './queue/manager.js';
import { RuleEngine } from './detectors/rules.js';
import { LogMonitor } from './monitors/log-monitor.js';
import { TestMonitor } from './monitors/test-monitor.js';
import { GitMonitor } from './monitors/git-monitor.js';
import { LLMAnalyzer } from './detectors/llm-analyzer.js';
import { WebhookReceiver } from './services/webhook-receiver.js';
import { WebhookConfig } from './config/webhook-config.js';
import { DEFAULT_CONFIG } from './types.js';
/**
 * Watcher state enum
 */
export var WatcherState;
(function (WatcherState) {
    WatcherState["Idle"] = "idle";
    WatcherState["Running"] = "running";
    WatcherState["Stopped"] = "stopped";
})(WatcherState || (WatcherState = {}));
/**
 * Main Watcher Process
 *
 * Implements US-001 from REQUIREMENTS.md
 */
export class Watcher {
    ossDir;
    apiKey;
    pidPath;
    logPath;
    configPath;
    state = WatcherState.Idle;
    queueManager = null;
    ruleEngine = null;
    logMonitor = null;
    testMonitor = null;
    gitMonitor = null;
    llmAnalyzer = null;
    webhookReceiver = null;
    config = DEFAULT_CONFIG;
    constructor(ossDir, apiKey) {
        this.ossDir = ossDir;
        this.apiKey = apiKey;
        this.pidPath = path.join(ossDir, 'watcher.pid');
        this.logPath = path.join(ossDir, 'watcher.log');
        this.configPath = path.join(ossDir, 'config.json');
    }
    /**
     * Start the watcher process
     * @returns true if started, false if another watcher already running
     */
    async start() {
        // Check for existing watcher
        if (await this.isAnotherWatcherRunning()) {
            return false;
        }
        // Clean up any stale PID file
        await this.cleanupStalePidFile();
        // Load configuration
        this.config = await this.loadConfig();
        // Create PID file
        fs.writeFileSync(this.pidPath, process.pid.toString());
        // Initialize log file
        this.log('Watcher started');
        // Initialize components
        this.queueManager = new QueueManager(this.ossDir, this.config.max_queue_size);
        this.queueManager.setDebugNotifications(true); // Enable notifications for production
        await this.queueManager.initialize();
        this.ruleEngine = new RuleEngine(this.config.loop_detection_threshold);
        this.logMonitor = new LogMonitor(this.queueManager, this.ruleEngine, 100 // buffer size
        );
        this.testMonitor = new TestMonitor(this.queueManager);
        this.gitMonitor = new GitMonitor(this.queueManager);
        if (this.config.use_llm_analysis) {
            this.llmAnalyzer = new LLMAnalyzer(this.queueManager, this.ruleEngine, this.apiKey, this.config.llm_confidence_threshold);
        }
        // Initialize webhook receiver if configured
        await this.initializeWebhookReceiver();
        this.state = WatcherState.Running;
        return true;
    }
    /**
     * Initialize webhook receiver based on config
     */
    async initializeWebhookReceiver() {
        const webhookConfig = new WebhookConfig(this.ossDir);
        if (!webhookConfig.isConfigured()) {
            this.webhookReceiver = null;
            return;
        }
        try {
            this.webhookReceiver = new WebhookReceiver({
                port: webhookConfig.getPort(),
                webhookSecret: webhookConfig.getSecret(),
            });
            // Connect webhook events to queue manager
            if (this.queueManager) {
                this.webhookReceiver.onEvent((payload) => {
                    // Only queue tasks for changes_requested reviews
                    const eventPayload = payload;
                    const review = eventPayload.review;
                    const reviewState = review?.state;
                    if (reviewState !== 'changes_requested') {
                        // Skip approved, commented, etc.
                        return;
                    }
                    // Extract PR details
                    const pullRequest = eventPayload.pull_request;
                    const prNumber = pullRequest?.number;
                    const prTitle = pullRequest?.title;
                    const prHead = pullRequest?.head;
                    const branch = prHead?.ref;
                    const reviewBody = review?.body;
                    // Detect suggested agent based on review content
                    let suggestedAgent = 'code-reviewer';
                    if (reviewBody) {
                        if (reviewBody.toLowerCase().includes('type')) {
                            suggestedAgent = 'typescript-pro';
                        }
                        else if (reviewBody.toLowerCase().includes('test')) {
                            suggestedAgent = 'test-engineer';
                        }
                        else if (reviewBody.toLowerCase().includes('security')) {
                            suggestedAgent = 'security-auditor';
                        }
                    }
                    // Queue webhook event as a task in expected format
                    // Note: id, status, created_at are auto-generated by addTask
                    this.queueManager?.addTask({
                        priority: 'high',
                        source: 'git-monitor',
                        anomaly_type: 'pr_check_failed',
                        prompt: reviewBody || 'PR review changes requested',
                        suggested_agent: suggestedAgent,
                        context: {
                            pr_number: prNumber,
                            pr_title: prTitle,
                            branch: branch,
                            review_body: reviewBody,
                        },
                    });
                });
            }
            await this.webhookReceiver.start();
            this.log(`Webhook receiver started on port ${webhookConfig.getPort()}`);
        }
        catch (error) {
            this.log(`Failed to start webhook receiver: ${error instanceof Error ? error.message : 'Unknown error'}`);
            this.webhookReceiver = null;
        }
    }
    /**
     * Stop the watcher process
     */
    async stop() {
        if (this.state === WatcherState.Stopped) {
            return;
        }
        this.log('Watcher stopped');
        this.state = WatcherState.Stopped;
        // Stop webhook receiver if running
        if (this.webhookReceiver) {
            await this.webhookReceiver.stop();
            this.webhookReceiver = null;
        }
        // Remove PID file
        if (fs.existsSync(this.pidPath)) {
            fs.unlinkSync(this.pidPath);
        }
        // Clear references
        this.queueManager = null;
        this.ruleEngine = null;
        this.logMonitor = null;
        this.testMonitor = null;
        this.gitMonitor = null;
        this.llmAnalyzer = null;
    }
    /**
     * Get the webhook receiver (for hooks and testing)
     */
    getWebhookReceiver() {
        return this.webhookReceiver;
    }
    /**
     * Get current watcher state
     */
    getState() {
        return this.state;
    }
    /**
     * Check if another watcher process is running
     */
    async isAnotherWatcherRunning() {
        if (!fs.existsSync(this.pidPath)) {
            return false;
        }
        const pidContent = fs.readFileSync(this.pidPath, 'utf-8').trim();
        const pid = parseInt(pidContent, 10);
        if (isNaN(pid)) {
            return false;
        }
        // Check if process exists
        try {
            process.kill(pid, 0); // Signal 0 just checks if process exists
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Clean up stale PID file if process not running
     */
    async cleanupStalePidFile() {
        if (!fs.existsSync(this.pidPath)) {
            return;
        }
        const isRunning = await this.isAnotherWatcherRunning();
        if (!isRunning) {
            fs.unlinkSync(this.pidPath);
        }
    }
    /**
     * Load configuration from file or use defaults
     */
    async loadConfig() {
        if (!fs.existsSync(this.configPath)) {
            return DEFAULT_CONFIG;
        }
        try {
            const content = fs.readFileSync(this.configPath, 'utf-8');
            const config = JSON.parse(content);
            return { ...DEFAULT_CONFIG, ...config };
        }
        catch {
            return DEFAULT_CONFIG;
        }
    }
    /**
     * Process a log line (for integration with Claude Code hooks)
     */
    async processLog(line) {
        if (!this.logMonitor || !this.config.monitors.logs) {
            return;
        }
        await this.logMonitor.processLine(line);
    }
    /**
     * Get the queue manager (for hooks)
     */
    getQueueManager() {
        return this.queueManager;
    }
    /**
     * Get the log monitor (for hooks)
     */
    getLogMonitor() {
        return this.logMonitor;
    }
    /**
     * Get the test monitor (for hooks)
     */
    getTestMonitor() {
        return this.testMonitor;
    }
    /**
     * Get the git monitor (for hooks)
     */
    getGitMonitor() {
        return this.gitMonitor;
    }
    /**
     * Run health check - execute npm test and queue any failures
     * This should be called on session start to catch pre-existing issues
     */
    async runHealthCheck() {
        this.log('Running health check...');
        this.sendNotification('🔍 Health Check', 'Running npm test...', 'low');
        try {
            // Run npm test and capture output
            const projectDir = path.dirname(this.ossDir);
            const output = execSync('npm test 2>&1', {
                cwd: projectDir,
                timeout: 300000, // 5 minutes max
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024, // 10MB
            });
            // Analyze output for failures
            if (this.testMonitor) {
                const result = await this.testMonitor.analyzeTestOutput(output);
                if (result.hasFailures) {
                    // Queue failing tests
                    await this.testMonitor.reportFailure(result);
                    const message = `${result.failedTests.length} test(s) failing`;
                    this.log(`Health check failed: ${message}`);
                    this.sendNotification('❌ Health Check Failed', message, 'critical');
                    return {
                        passed: false,
                        failureCount: result.failedTests.length,
                        message,
                    };
                }
            }
            this.log('Health check passed');
            this.sendNotification('✅ Health Check Passed', 'All tests passing', 'high');
            return {
                passed: true,
                failureCount: 0,
                message: 'All tests passing',
            };
        }
        catch (error) {
            // Test command failed - likely test failures
            const errorOutput = error instanceof Error && 'stdout' in error
                ? error.stdout || ''
                : '';
            if (this.testMonitor && errorOutput) {
                const result = await this.testMonitor.analyzeTestOutput(errorOutput);
                if (result.hasFailures) {
                    await this.testMonitor.reportFailure(result);
                    const message = `${result.failedTests.length} test(s) failing`;
                    this.log(`Health check failed: ${message}`);
                    this.sendNotification('❌ Health Check Failed', message, 'critical');
                    return {
                        passed: false,
                        failureCount: result.failedTests.length,
                        message,
                    };
                }
            }
            // Generic failure
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Health check error: ${message}`);
            this.sendNotification('⚠️ Health Check Error', 'Could not run tests', 'critical');
            return {
                passed: false,
                failureCount: 0,
                message: `Error: ${message}`,
            };
        }
    }
    /**
     * Send a notification via oss-notify.sh or status line CLI
     * All runtime notifications use the status line as the visual notification mechanism
     */
    sendNotification(title, message, priority = 'high') {
        try {
            const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(this.ossDir);
            const notifyScript = path.join(pluginRoot, 'hooks', 'oss-notify.sh');
            if (fs.existsSync(notifyScript)) {
                execSync(`"${notifyScript}" "${title}" "${message}" ${priority}`, {
                    timeout: 5000,
                    stdio: 'ignore',
                });
            }
            else {
                // Fallback to status line CLI - status line is the only visual notification method
                const cliPath = path.join(pluginRoot, 'watcher', 'dist', 'cli', 'update-workflow-state.js');
                if (fs.existsSync(cliPath)) {
                    execSync(`node "${cliPath}" setMessage "${title}: ${message}"`, {
                        timeout: 5000,
                        stdio: 'ignore',
                    });
                }
                // If neither available, silently fail - no visual notification
            }
        }
        catch {
            // Ignore notification errors
        }
    }
    /**
     * Write to log file with timestamp
     */
    log(message) {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(this.logPath, logLine);
    }
}
// Export all components for use by hooks
export { QueueManager } from './queue/manager.js';
export { RuleEngine } from './detectors/rules.js';
export { LogMonitor } from './monitors/log-monitor.js';
export { TestMonitor } from './monitors/test-monitor.js';
export { GitMonitor } from './monitors/git-monitor.js';
export { LLMAnalyzer } from './detectors/llm-analyzer.js';
export { WebhookReceiver } from './services/webhook-receiver.js';
export { WebhookConfig } from './config/webhook-config.js';
export * from './types.js';
//# sourceMappingURL=index.js.map