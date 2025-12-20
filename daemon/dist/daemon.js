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
export class OssDaemon {
    config;
    pidFile;
    logFile;
    running = false;
    pendingOperations = [];
    constructor(config) {
        this.config = config;
        this.pidFile = path.join(config.ossDir, 'daemon.pid');
        this.logFile = path.join(config.ossDir, 'daemon.log');
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
        await this.log('Daemon started');
    }
    /**
     * Stop the daemon
     */
    async stop() {
        if (!this.running) {
            return;
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
}
//# sourceMappingURL=daemon.js.map