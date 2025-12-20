/**
 * DaemonCli - Command-line interface for the OSS Daemon
 *
 * Provides start/stop/status commands for managing the daemon lifecycle.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { OssDaemon } from './daemon.js';
import { LaunchdService } from './launchd-service.js';

export interface CliConfig {
  ossDir: string;
}

export interface CliCommand {
  action: 'start' | 'stop' | 'status' | 'install' | 'uninstall' | 'help' | 'version';
  flags: {
    daemonize?: boolean;
    dryRun?: boolean;
    help?: boolean;
    version?: boolean;
  };
}

export interface CliResult {
  success: boolean;
  output: string;
  exitCode: number;
}

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
  private config: CliConfig;
  private daemon: OssDaemon;
  private launchd: LaunchdService;

  constructor(config: CliConfig) {
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
  parseCommand(args: string[]): CliCommand {
    const flags: CliCommand['flags'] = {};

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
  async execute(args: string[]): Promise<CliResult> {
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
  private async statusCommand(): Promise<CliResult> {
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
      } catch {
        return {
          success: true,
          output: 'Daemon is not running (stale pid file)',
          exitCode: 0
        };
      }
    } catch {
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
  private async startCommand(flags: CliCommand['flags']): Promise<CliResult> {
    if (flags.dryRun) {
      return {
        success: true,
        output: 'Would start the daemon',
        exitCode: 0
      };
    }

    try {
      await this.daemon.start();
      return {
        success: true,
        output: 'Daemon started',
        exitCode: 0
      };
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to start daemon: ${error.message}`,
        exitCode: 1
      };
    }
  }

  /**
   * Stop command implementation
   */
  private async stopCommand(): Promise<CliResult> {
    try {
      await this.daemon.stop();
      return {
        success: true,
        output: 'Daemon stopped',
        exitCode: 0
      };
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to stop daemon: ${error.message}`,
        exitCode: 1
      };
    }
  }

  /**
   * Install command implementation (launchd)
   */
  private async installCommand(): Promise<CliResult> {
    try {
      const plistPath = await this.launchd.writePlist();
      return {
        success: true,
        output: `Installed to ${plistPath}\nRun: launchctl load ${plistPath}`,
        exitCode: 0
      };
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to install: ${error.message}`,
        exitCode: 1
      };
    }
  }

  /**
   * Uninstall command implementation
   */
  private async uninstallCommand(): Promise<CliResult> {
    try {
      await this.launchd.uninstall();
      return {
        success: true,
        output: 'Uninstalled launchd service',
        exitCode: 0
      };
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to uninstall: ${error.message}`,
        exitCode: 1
      };
    }
  }
}
