import { QueueManager } from '../queue/manager.js';
import { RuleEngine, RuleMatch } from '../detectors/rules.js';
import { CreateTaskInput, Priority } from '../types.js';
import { OSSError, WireError } from '../services/error-codes.js';

/**
 * Dedup window: a regex detector hit arriving within this window of a
 * structured OSS_ERROR event is considered the same failure (structured wins).
 */
const STRUCTURED_ERROR_DEDUP_WINDOW_MS = 5000;

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
  private readonly recentStructuredErrors: Array<{ source: string; seenAt: number }> = [];

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

    // Structured OSS_ERROR events win over regex detection (AC-004.4)
    const structured = this.parseStructuredError(trimmed);
    if (structured) {
      this.recentStructuredErrors.push({ source: structured.source, seenAt: Date.now() });
      await this.createStructuredTask(structured, trimmed);
      return;
    }

    // Analyze single line
    const match = this.ruleEngine.analyze(trimmed);
    if (match) {
      // Dedup: a structured event already covered this failure window
      if (this.hasRecentStructuredError()) {
        return;
      }
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
    this.recentStructuredErrors.length = 0;
  }

  /**
   * Parse a log line as a workflow-log OSS_ERROR event.
   * Returns the validated wire error, or null when the line is not one.
   */
  private parseStructuredError(line: string): WireError | null {
    if (!line.startsWith('{')) {
      return null;
    }
    try {
      const parsed = JSON.parse(line) as { event?: unknown; data?: unknown };
      if (parsed.event !== 'OSS_ERROR') {
        return null;
      }
      return OSSError.fromWireJSON(parsed.data).toWireJSON();
    } catch {
      return null;
    }
  }

  /**
   * Whether a structured OSS_ERROR was seen within the dedup window.
   * Prunes expired entries as a side effect.
   */
  private hasRecentStructuredError(): boolean {
    const cutoff = Date.now() - STRUCTURED_ERROR_DEDUP_WINDOW_MS;
    while (this.recentStructuredErrors.length > 0 && this.recentStructuredErrors[0].seenAt < cutoff) {
      this.recentStructuredErrors.shift();
    }
    return this.recentStructuredErrors.length > 0;
  }

  /**
   * Create a task carrying structured provenance from an OSS_ERROR event
   */
  private async createStructuredTask(error: WireError, line: string): Promise<void> {
    const priority: Priority =
      error.severity === 'CRITICAL' || error.severity === 'HIGH'
        ? 'high'
        : error.severity === 'MEDIUM'
          ? 'medium'
          : 'low';

    const task: CreateTaskInput = {
      priority,
      source: 'log-monitor',
      anomaly_type: 'agent_error',
      prompt:
        `Structured error ${error.code} from ${error.source}: ${error.message}` +
        (error.retry_hint !== undefined ? `\nRetry hint: ${error.retry_hint}` : ''),
      suggested_agent: 'debugger',
      context: {
        provenance: 'structured',
        error_code: error.code,
        error_source: error.source,
        retry_hint: error.retry_hint,
        log_excerpt: line,
      },
    };

    await this.queueManager.addTask(task);
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
