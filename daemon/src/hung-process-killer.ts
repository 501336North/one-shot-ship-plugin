/**
 * HungProcessKiller - Kills processes that exceed timeout thresholds
 *
 * Manages timeout configurations per process type and handles safe
 * termination with logging.
 */

import { promises as fs } from 'fs';
import { ProcessInfo, ProcessType } from './process-monitor.js';

export interface TimeoutConfig {
  timeoutMs: number;
}

export interface KillResult {
  success: boolean;
  pid: number;
  message: string;
  dryRun: boolean;
}

export interface HungProcessKillerConfig {
  logFile: string;
  timeouts?: {
    [key in ProcessType]?: number;
  };
}

// Default timeouts per process type
const DEFAULT_TIMEOUTS: Record<ProcessType, number> = {
  'vitest': 5 * 60 * 1000,      // 5 minutes
  'npm-test': 10 * 60 * 1000,   // 10 minutes
  'jest': 10 * 60 * 1000,       // 10 minutes
  'node': 15 * 60 * 1000,       // 15 minutes
  'unknown': 30 * 60 * 1000     // 30 minutes (conservative default)
};

export class HungProcessKiller {
  private config: HungProcessKillerConfig;
  private timeouts: Record<ProcessType, number>;

  constructor(config: HungProcessKillerConfig) {
    this.config = config;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
  }

  /**
   * Get timeout configuration for a process type
   */
  getTimeoutConfig(type: ProcessType): TimeoutConfig {
    return {
      timeoutMs: this.timeouts[type] || DEFAULT_TIMEOUTS.unknown
    };
  }

  /**
   * Determine if a process should be killed based on its age
   */
  shouldKillProcess(process: ProcessInfo, type: ProcessType): boolean {
    const age = Date.now() - process.startTime.getTime();
    const timeout = this.getTimeoutConfig(type).timeoutMs;
    return age > timeout;
  }

  /**
   * Log a kill action with full details
   */
  async logKill(process: ProcessInfo, type: ProcessType, reason: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const ageMinutes = Math.round((Date.now() - process.startTime.getTime()) / 60000);

    const logEntry = [
      `[${timestamp}] KILL ACTION`,
      `  PID: ${process.pid}`,
      `  Type: ${type}`,
      `  Command: ${process.command}`,
      `  Age: ${ageMinutes} minutes`,
      `  CPU: ${process.cpuPercent}%`,
      `  Memory: ${Math.round(process.memoryMB)} MB`,
      `  Reason: ${reason}`,
      ''
    ].join('\n');

    await fs.appendFile(this.config.logFile, logEntry);
  }

  /**
   * Kill a process by PID
   * Uses SIGTERM first, then SIGKILL after grace period
   */
  async killProcess(pid: number, dryRun = false): Promise<KillResult> {
    if (dryRun) {
      return {
        success: true,
        pid,
        message: `Would kill process ${pid} (dry-run mode)`,
        dryRun: true
      };
    }

    try {
      // Send SIGTERM first (graceful)
      process.kill(pid, 'SIGTERM');

      // Wait a bit and check if process is still running
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        // Check if process still exists
        process.kill(pid, 0);

        // Process still running, send SIGKILL
        process.kill(pid, 'SIGKILL');

        return {
          success: true,
          pid,
          message: `Killed process ${pid} with SIGKILL`,
          dryRun: false
        };
      } catch {
        // Process no longer exists - SIGTERM worked
        return {
          success: true,
          pid,
          message: `Killed process ${pid} with SIGTERM`,
          dryRun: false
        };
      }
    } catch (error) {
      return {
        success: false,
        pid,
        message: `Failed to kill process ${pid}: ${error}`,
        dryRun: false
      };
    }
  }
}
