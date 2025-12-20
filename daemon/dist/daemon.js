/**
 * OssDaemon - Supervisor daemon for process monitoring and health checks
 *
 * Runs as a standalone process (via launchd) to:
 * - Monitor for hung test processes (vitest, npm test)
 * - Kill processes that exceed timeout thresholds
 * - Track system resource usage
 * - Send notifications on issues
 */
import { promises as fs } from 'fs';
import * as path from 'path';
// Priority order for severity levels
const SEVERITY_PRIORITY = {
    error: 3,
    warning: 2,
    info: 1
};
export class OssDaemon {
    config;
    pidFile;
    logFile;
    stateFile;
    running = false;
    pendingOperations = [];
    interval = null;
    tickCount = 0;
    constructor(config) {
        this.config = config;
        this.pidFile = path.join(config.ossDir, 'daemon.pid');
        this.logFile = path.join(config.ossDir, 'daemon.log');
        this.stateFile = path.join(config.ossDir, 'workflow-state.json');
    }
    /**
     * Start the daemon
     */
    async start() {
        // Check for existing instance
        if (await this.isDaemonRunning()) {
            throw new Error('Daemon already running');
        }
        // Ensure directory exists
        await fs.mkdir(this.config.ossDir, { recursive: true });
        // Write PID file
        await fs.writeFile(this.pidFile, String(process.pid));
        this.running = true;
        // Start the monitoring loop
        this.interval = setInterval(() => this.tick(), this.config.checkIntervalMs);
        await this.log('Daemon started');
    }
    /**
     * Stop the daemon
     */
    async stop() {
        if (!this.running) {
            return;
        }
        // Stop the monitoring loop
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        // Wait for pending operations
        await Promise.all(this.pendingOperations);
        await this.log('Daemon stopped');
        // Remove PID file
        try {
            await fs.unlink(this.pidFile);
        }
        catch {
            // Ignore if file doesn't exist
        }
        this.running = false;
    }
    /**
     * Check if daemon is running
     */
    isRunning() {
        return this.running;
    }
    /**
     * Get the number of monitoring ticks that have occurred
     */
    getTickCount() {
        return this.tickCount;
    }
    /**
     * Single tick of the monitoring loop
     */
    tick() {
        this.tickCount++;
        this.updateHeartbeat().catch(() => {
            // Ignore heartbeat write errors
        });
    }
    /**
     * Update heartbeat in workflow-state.json
     */
    async updateHeartbeat() {
        let state = {};
        // Read existing state if present
        try {
            const content = await fs.readFile(this.stateFile, 'utf-8');
            state = JSON.parse(content);
        }
        catch {
            // File doesn't exist or is invalid, use empty object
        }
        // Update heartbeat
        state.daemonHeartbeat = new Date().toISOString();
        // Write back
        await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
    }
    /**
     * Log activity to daemon.log
     */
    async log(message) {
        const timestamp = new Date().toISOString();
        const entry = `[${timestamp}] ${message}\n`;
        const operation = fs.appendFile(this.logFile, entry);
        this.pendingOperations.push(operation);
        try {
            await operation;
        }
        finally {
            const index = this.pendingOperations.indexOf(operation);
            if (index > -1) {
                this.pendingOperations.splice(index, 1);
            }
        }
    }
    /**
     * Check if another daemon instance is running
     */
    async isDaemonRunning() {
        try {
            const pid = await fs.readFile(this.pidFile, 'utf-8');
            const pidNum = parseInt(pid.trim());
            // Check if process exists
            try {
                process.kill(pidNum, 0); // Signal 0 just checks existence
                return true;
            }
            catch {
                // Process doesn't exist, clean up stale PID file
                await fs.unlink(this.pidFile);
                return false;
            }
        }
        catch {
            // PID file doesn't exist
            return false;
        }
    }
    /**
     * Prioritize issues by severity (error > warning > info)
     * Returns the highest priority issue, or null if empty
     */
    static prioritizeIssues(issues) {
        if (issues.length === 0) {
            return null;
        }
        return issues.reduce((highest, current) => {
            const currentPriority = SEVERITY_PRIORITY[current.severity] || 0;
            const highestPriority = SEVERITY_PRIORITY[highest.severity] || 0;
            return currentPriority > highestPriority ? current : highest;
        }, issues[0]);
    }
}
//# sourceMappingURL=daemon.js.map