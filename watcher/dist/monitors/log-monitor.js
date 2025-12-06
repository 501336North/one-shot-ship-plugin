/**
 * Log Monitor - Monitors agent output for anomalies
 *
 * Implements AC-002.1 through AC-002.5 from REQUIREMENTS.md
 */
export class LogMonitor {
    queueManager;
    ruleEngine;
    logBuffer;
    maxBufferSize;
    lastActivityTime;
    stuckReported;
    constructor(queueManager, ruleEngine, maxBufferSize = 100) {
        this.queueManager = queueManager;
        this.ruleEngine = ruleEngine;
        this.logBuffer = [];
        this.maxBufferSize = maxBufferSize;
        this.lastActivityTime = Date.now();
        this.stuckReported = false;
    }
    /**
     * Process a single log line
     */
    async processLine(line) {
        const trimmed = line.trim();
        // Skip empty lines
        if (!trimmed) {
            return;
        }
        // Update activity timestamp
        this.lastActivityTime = Date.now();
        this.stuckReported = false; // Reset stuck flag on new activity
        // Add to buffer
        this.logBuffer.push(trimmed);
        if (this.logBuffer.length > this.maxBufferSize) {
            this.logBuffer.shift();
        }
        // Analyze single line
        const match = this.ruleEngine.analyze(trimmed);
        if (match) {
            await this.createTask(match);
        }
    }
    /**
     * Get recent logs as a single string
     */
    getRecentLogs(count) {
        const lines = this.logBuffer.slice(-count);
        return lines.join('\n');
    }
    /**
     * Get the timestamp of last activity
     */
    getLastActivityTime() {
        return this.lastActivityTime;
    }
    /**
     * Check if agent appears stuck (no output for specified seconds)
     */
    checkIfStuck(timeoutSeconds) {
        const elapsed = (Date.now() - this.lastActivityTime) / 1000;
        return elapsed >= timeoutSeconds;
    }
    /**
     * Check if stuck and create task if so
     */
    async checkAndReportStuck(timeoutSeconds) {
        if (this.stuckReported) {
            return; // Already reported this stuck period
        }
        if (this.checkIfStuck(timeoutSeconds)) {
            this.stuckReported = true;
            const task = {
                priority: 'high',
                source: 'log-monitor',
                anomaly_type: 'agent_stuck',
                prompt: `Agent appears stuck - no output for ${timeoutSeconds}+ seconds. Investigate if process is hung or waiting for input.`,
                suggested_agent: 'debugger',
                context: {
                    log_excerpt: this.getRecentLogs(10),
                },
            };
            await this.queueManager.addTask(task);
        }
    }
    /**
     * Analyze aggregated logs for patterns that span multiple lines
     */
    async analyzeAggregated() {
        const aggregated = this.getRecentLogs(this.maxBufferSize);
        if (!aggregated) {
            return;
        }
        const match = this.ruleEngine.analyze(aggregated);
        if (match) {
            await this.createTask(match);
        }
    }
    /**
     * Reset monitor state
     */
    reset() {
        this.logBuffer.length = 0;
        this.lastActivityTime = Date.now();
        this.stuckReported = false;
    }
    /**
     * Create a task from a rule match
     */
    async createTask(match) {
        const task = {
            priority: match.priority,
            source: 'log-monitor',
            anomaly_type: match.anomaly_type,
            prompt: match.prompt,
            suggested_agent: match.suggested_agent,
            context: match.context,
        };
        await this.queueManager.addTask(task);
    }
}
//# sourceMappingURL=log-monitor.js.map