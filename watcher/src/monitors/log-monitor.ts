import { QueueManager } from '../queue/manager.js';
import { RuleEngine, RuleMatch } from '../detectors/rules.js';
import { CreateTaskInput } from '../types.js';

/**
 * Log Monitor - Monitors agent output for anomalies
 *
 * Implements AC-002.1 through AC-002.5 from REQUIREMENTS.md
 */
export class LogMonitor {
  private readonly queueManager: QueueManager;
  private readonly ruleEngine: RuleEngine;
  private readonly logBuffer: string[];
  private readonly maxBufferSize: number;
  private lastActivityTime: number;
  private stuckReported: boolean;

  constructor(
    queueManager: QueueManager,
    ruleEngine: RuleEngine,
    maxBufferSize: number = 100
  ) {
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
  async processLine(line: string): Promise<void> {
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
  getRecentLogs(count: number): string {
    const lines = this.logBuffer.slice(-count);
    return lines.join('\n');
  }

  /**
   * Get the timestamp of last activity
   */
  getLastActivityTime(): number {
    return this.lastActivityTime;
  }

  /**
   * Check if agent appears stuck (no output for specified seconds)
   */
  checkIfStuck(timeoutSeconds: number): boolean {
    const elapsed = (Date.now() - this.lastActivityTime) / 1000;
    return elapsed >= timeoutSeconds;
  }

  /**
   * Check if stuck and create task if so
   */
  async checkAndReportStuck(timeoutSeconds: number): Promise<void> {
    if (this.stuckReported) {
      return; // Already reported this stuck period
    }

    if (this.checkIfStuck(timeoutSeconds)) {
      this.stuckReported = true;

      const task: CreateTaskInput = {
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
  async analyzeAggregated(): Promise<void> {
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
  reset(): void {
    this.logBuffer.length = 0;
    this.lastActivityTime = Date.now();
    this.stuckReported = false;
  }

  /**
   * Create a task from a rule match
   */
  private async createTask(match: RuleMatch): Promise<void> {
    const task: CreateTaskInput = {
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
