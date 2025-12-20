/**
 * DaemonCli - Command-line interface for the OSS Daemon
 *
 * Provides start/stop/status commands for managing the daemon lifecycle.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { OssDaemon } from './daemon.js';
import { LaunchdService } from './launchd-service.js';
const VERSION = '1.0.0';
const HELP_TEXT = `
Usage: oss-daemon <command> [options]

Commands:
  start      Start the daemon
  stop       Stop the daemon
  status     Show daemon status
  install    Install as launchd service (macOS)
  uninstall  Remove launchd service

Options:
  --daemonize    Run in background (detached)
  --dry-run      Show what would be done without doing it
  --help, -h     Show this help message
  --version, -v  Show version number

Examples:
  oss-daemon start
  oss-daemon start --daemonize
  oss-daemon status
  oss-daemon install
`.trim();
export class DaemonCli {
    config;
    daemon;
    launchd;
    stopResolver = null;
    constructor(config) {
        this.config = config;
        this.daemon = new OssDaemon({
            ossDir: config.ossDir,
            checkIntervalMs: 60000,
            processTimeoutMs: 5 * 60 * 1000
        });
        this.launchd = new LaunchdService({
            ossDir: config.ossDir,
            label: 'com.oneshotship.daemon'
        });
    }
    /**
     * Parse command-line arguments
     */
    parseCommand(args) {
        const flags = {};
        // Check for global flags
        if (args.includes('--help') || args.includes('-h')) {
            return { action: 'help', flags: { help: true } };
        }
        if (args.includes('--version') || args.includes('-v')) {
            return { action: 'version', flags: { version: true } };
        }
        // Parse action-specific flags
        if (args.includes('--daemonize')) {
            flags.daemonize = true;
        }
        if (args.includes('--dry-run')) {
            flags.dryRun = true;
        }
        // Determine action
        const action = args.find(arg => !arg.startsWith('-'));
        switch (action) {
            case 'start':
                return { action: 'start', flags };
            case 'stop':
                return { action: 'stop', flags };
            case 'status':
                return { action: 'status', flags };
            case 'install':
                return { action: 'install', flags };
            case 'uninstall':
                return { action: 'uninstall', flags };
            default:
                return { action: 'status', flags }; // Default to status
        }
    }
    /**
     * Execute a command
     */
    async execute(args) {
        const command = this.parseCommand(args);
        switch (command.action) {
            case 'help':
                return {
                    success: true,
                    output: HELP_TEXT,
                    exitCode: 0
                };
            case 'version':
                return {
                    success: true,
                    output: `oss-daemon version ${VERSION}`,
                    exitCode: 0
                };
            case 'status':
                return this.statusCommand();
            case 'start':
                return this.startCommand(command.flags);
            case 'stop':
                return this.stopCommand();
            case 'install':
                return this.installCommand();
            case 'uninstall':
                return this.uninstallCommand();
            default:
                return {
                    success: false,
                    output: `Unknown command: ${command.action}`,
                    exitCode: 1
                };
        }
    }
    /**
     * Status command implementation
     */
    async statusCommand() {
        const pidFile = path.join(this.config.ossDir, 'daemon.pid');
        try {
            const pidContent = await fs.readFile(pidFile, 'utf-8');
            const pid = parseInt(pidContent.trim(), 10);
            // Check if process is actually running
            try {
                process.kill(pid, 0);
                return {
                    success: true,
                    output: `Daemon is running (pid: ${pid})`,
                    exitCode: 0
                };
            }
            catch {
                return {
                    success: true,
                    output: 'Daemon is not running (stale pid file)',
                    exitCode: 0
                };
            }
        }
        catch {
            return {
                success: true,
                output: 'Daemon is not running',
                exitCode: 0
            };
        }
    }
    /**
     * Start command implementation
     */
    async startCommand(flags) {
        if (flags.dryRun) {
            return {
                success: true,
                output: 'Would start the daemon',
                exitCode: 0
            };
        }
        try {
            await this.daemon.start();
            if (flags.daemonize) {
                // In daemonize mode, return immediately
                return {
                    success: true,
                    output: 'Daemon started',
                    exitCode: 0
                };
            }
            // In foreground mode, keep process alive until stopped
            return new Promise((resolve) => {
                this.stopResolver = () => {
                    resolve({
                        success: true,
                        output: 'Daemon stopped',
                        exitCode: 0
                    });
                };
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                output: `Failed to start daemon: ${message}`,
                exitCode: 1
            };
        }
    }
    /**
     * Stop command implementation
     */
    async stopCommand() {
        try {
            await this.daemon.stop();
            // If in foreground mode, resolve the pending start promise
            if (this.stopResolver) {
                this.stopResolver();
                this.stopResolver = null;
            }
            return {
                success: true,
                output: 'Daemon stopped',
                exitCode: 0
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                output: `Failed to stop daemon: ${message}`,
                exitCode: 1
            };
        }
    }
    /**
     * Install command implementation (launchd)
     */
    async installCommand() {
        try {
            const plistPath = await this.launchd.writePlist();
            return {
                success: true,
                output: `Installed to ${plistPath}\nRun: launchctl load ${plistPath}`,
                exitCode: 0
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                output: `Failed to install: ${message}`,
                exitCode: 1
            };
        }
    }
    /**
     * Uninstall command implementation
     */
    async uninstallCommand() {
        try {
            await this.launchd.uninstall();
            return {
                success: true,
                output: 'Uninstalled launchd service',
                exitCode: 0
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                output: `Failed to uninstall: ${message}`,
                exitCode: 1
            };
        }
    }
}
//# sourceMappingURL=cli.js.map