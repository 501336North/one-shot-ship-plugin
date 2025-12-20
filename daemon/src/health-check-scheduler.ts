/**
 * HealthCheckScheduler - Runs health checks on a configurable schedule
 *
 * Executes health check commands periodically and logs results.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SchedulerConfig {
  ossDir: string;
  intervalMs?: number;
  healthCheckCommand?: string;
}

export interface HealthCheckResult {
  success: boolean;
  timestamp: Date;
  duration: number;
  output: string;
  error?: string;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_HEALTH_CHECK_COMMAND = 'npm test -- --run';

export class HealthCheckScheduler {
  private config: Required<SchedulerConfig>;
  private intervalId: NodeJS.Timeout | null = null;
  private lastResult: HealthCheckResult | null = null;

  constructor(config: SchedulerConfig) {
    this.config = {
      ossDir: config.ossDir,
      intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
      healthCheckCommand: config.healthCheckCommand ?? DEFAULT_HEALTH_CHECK_COMMAND
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<SchedulerConfig> {
    return { ...this.config };
  }

  /**
   * Run a health check and return the result
   */
  async runHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    let success = true;
    let output = '';
    let error: string | undefined;

    try {
      const result = await execAsync(this.config.healthCheckCommand, {
        cwd: this.config.ossDir,
        timeout: 60000 // 1 minute timeout
      });
      output = result.stdout + result.stderr;
    } catch (err: any) {
      success = false;
      output = err.stdout || '';
      error = err.stderr || err.message;
    }

    const duration = Date.now() - startTime;
    const timestamp = new Date();

    const result: HealthCheckResult = {
      success,
      timestamp,
      duration,
      output,
      error
    };

    this.lastResult = result;

    // Log the result
    await this.logResult(result);

    return result;
  }

  /**
   * Log health check result to file
   */
  private async logResult(result: HealthCheckResult): Promise<void> {
    const logPath = path.join(this.config.ossDir, 'health-check.log');
    const status = result.success ? 'PASS' : 'FAIL';

    const logEntry = [
      `[${result.timestamp.toISOString()}] ${status}`,
      `  Duration: ${result.duration}ms`,
      `  Output: ${result.output.substring(0, 200)}${result.output.length > 200 ? '...' : ''}`,
      result.error ? `  Error: ${result.error.substring(0, 200)}` : '',
      ''
    ].filter(Boolean).join('\n');

    await fs.appendFile(logPath, logEntry);
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.intervalId !== null) {
      return; // Already running
    }

    this.intervalId = setInterval(() => {
      this.runHealthCheck().catch(err => {
        console.error('Health check failed:', err);
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Get the last health check result
   */
  getLastResult(): HealthCheckResult | null {
    return this.lastResult;
  }
}
