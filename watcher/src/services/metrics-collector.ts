/**
 * Metrics Collector Service
 *
 * Aggregates workflow telemetry to prove ROI and drive improvements.
 * Tracks session duration, command success rates, TDD phase timing.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface CommandRecord {
  command: string;
  status: 'success' | 'failure';
  startTime?: number;
  endTime?: number;
  duration?: number;
}

interface SessionRecord {
  startTime: number;
  endTime?: number;
  duration?: number;
  commands: CommandRecord[];
}

interface TddPhaseRecord {
  phase: 'red' | 'green' | 'refactor';
  startTime: number;
  endTime?: number;
  duration?: number;
}

interface MetricsData {
  sessions: SessionRecord[];
  tddPhases: TddPhaseRecord[];
  lastUpdated: string;
}

interface SessionMetrics {
  duration: number;
  commandCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

interface CommandMetrics {
  command: string;
  count: number;
  successCount: number;
  failureCount: number;
  averageDuration: number;
}

interface DailyMetrics {
  date: string;
  sessionCount: number;
  totalCommands: number;
  successRate: number;
}

interface AllTimeMetrics {
  totalSessions: number;
  totalCommands: number;
  totalSuccesses: number;
  totalFailures: number;
  averageSessionDuration: number;
  successRate: number;
}

interface TddMetrics {
  redPhaseTime: number;
  greenPhaseTime: number;
  refactorPhaseTime: number;
  cycleCount: number;
}

interface MetricsCollectorOptions {
  retentionDays?: number;
}

const DEFAULT_RETENTION_DAYS = 30;

export class MetricsCollector {
  private metricsFile: string;
  private retentionDays: number;
  private currentSession: SessionRecord | null = null;
  private currentCommand: { command: string; startTime: number } | null = null;
  private currentTddPhase: TddPhaseRecord | null = null;
  private data: MetricsData;

  constructor(options: MetricsCollectorOptions = {}) {
    const ossDir = path.join(os.homedir(), '.oss');
    this.metricsFile = path.join(ossDir, 'metrics.json');
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.data = { sessions: [], tddPhases: [], lastUpdated: new Date().toISOString() };
  }

  /**
   * Start a new session
   */
  startSession(): void {
    this.currentSession = {
      startTime: Date.now(),
      commands: [],
    };
  }

  /**
   * End the current session
   */
  endSession(): void {
    if (this.currentSession) {
      this.currentSession.endTime = Date.now();
      this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;
      this.data.sessions.push(this.currentSession);
      this.currentSession = null;
    }
  }

  /**
   * Record a command execution
   */
  recordCommand(command: string, status: 'success' | 'failure'): void {
    const record: CommandRecord = { command, status };
    if (this.currentSession) {
      this.currentSession.commands.push(record);
    }
  }

  /**
   * Start timing a command
   */
  startCommand(command: string): void {
    this.currentCommand = { command, startTime: Date.now() };
  }

  /**
   * End timing a command
   */
  endCommand(command: string, status: 'success' | 'failure'): void {
    if (this.currentCommand && this.currentCommand.command === command) {
      const record: CommandRecord = {
        command,
        status,
        startTime: this.currentCommand.startTime,
        endTime: Date.now(),
        duration: Date.now() - this.currentCommand.startTime,
      };
      if (this.currentSession) {
        this.currentSession.commands.push(record);
      }
      this.currentCommand = null;
    }
  }

  /**
   * Start a TDD phase
   */
  startTddPhase(phase: 'red' | 'green' | 'refactor'): void {
    this.currentTddPhase = {
      phase,
      startTime: Date.now(),
    };
  }

  /**
   * End a TDD phase
   */
  endTddPhase(phase: 'red' | 'green' | 'refactor'): void {
    if (this.currentTddPhase && this.currentTddPhase.phase === phase) {
      this.currentTddPhase.endTime = Date.now();
      this.currentTddPhase.duration = this.currentTddPhase.endTime - this.currentTddPhase.startTime;
      this.data.tddPhases.push(this.currentTddPhase);
      this.currentTddPhase = null;
    }
  }

  /**
   * Get metrics for current session
   */
  getSessionMetrics(): SessionMetrics {
    const session = this.currentSession || this.data.sessions[this.data.sessions.length - 1];
    if (!session) {
      return { duration: 0, commandCount: 0, successCount: 0, failureCount: 0, successRate: 0 };
    }

    const commands = session.commands;
    const successCount = commands.filter(c => c.status === 'success').length;
    const failureCount = commands.filter(c => c.status === 'failure').length;
    const commandCount = commands.length;

    return {
      duration: session.duration || (Date.now() - session.startTime),
      commandCount,
      successCount,
      failureCount,
      successRate: commandCount > 0 ? successCount / commandCount : 0,
    };
  }

  /**
   * Get metrics for a specific command
   */
  getCommandMetrics(command: string): CommandMetrics {
    // Include both saved sessions and current session
    let allCommands = this.data.sessions.flatMap(s => s.commands).filter(c => c.command === command);
    if (this.currentSession) {
      allCommands = allCommands.concat(this.currentSession.commands.filter(c => c.command === command));
    }
    const count = allCommands.length;
    const successCount = allCommands.filter(c => c.status === 'success').length;
    const failureCount = allCommands.filter(c => c.status === 'failure').length;
    const durations = allCommands.filter(c => c.duration).map(c => c.duration!);
    const averageDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return { command, count, successCount, failureCount, averageDuration };
  }

  /**
   * Get top commands by usage
   */
  getTopCommands(limit: number): { command: string; count: number }[] {
    const commandCounts: Record<string, number> = {};

    for (const session of this.data.sessions) {
      for (const cmd of session.commands) {
        commandCounts[cmd.command] = (commandCounts[cmd.command] || 0) + 1;
      }
    }

    // Also count current session
    if (this.currentSession) {
      for (const cmd of this.currentSession.commands) {
        commandCounts[cmd.command] = (commandCounts[cmd.command] || 0) + 1;
      }
    }

    return Object.entries(commandCounts)
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get daily metrics
   */
  getDailyMetrics(): DailyMetrics {
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = this.data.sessions.filter(s => {
      const sessionDate = new Date(s.startTime).toISOString().split('T')[0];
      return sessionDate === today;
    });

    const totalCommands = todaySessions.reduce((sum, s) => sum + s.commands.length, 0);
    const successCommands = todaySessions.reduce(
      (sum, s) => sum + s.commands.filter(c => c.status === 'success').length,
      0
    );

    return {
      date: today,
      sessionCount: todaySessions.length,
      totalCommands,
      successRate: totalCommands > 0 ? successCommands / totalCommands : 0,
    };
  }

  /**
   * Get all-time metrics
   */
  getAllTimeMetrics(): AllTimeMetrics {
    const sessions = this.data.sessions;
    const totalSessions = sessions.length;
    const totalCommands = sessions.reduce((sum, s) => sum + s.commands.length, 0);
    const totalSuccesses = sessions.reduce(
      (sum, s) => sum + s.commands.filter(c => c.status === 'success').length,
      0
    );
    const totalFailures = totalCommands - totalSuccesses;
    const durations = sessions.filter(s => s.duration).map(s => s.duration!);
    const averageSessionDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      totalSessions,
      totalCommands,
      totalSuccesses,
      totalFailures,
      averageSessionDuration,
      successRate: totalCommands > 0 ? totalSuccesses / totalCommands : 0,
    };
  }

  /**
   * Get TDD metrics
   */
  getTddMetrics(): TddMetrics {
    const phases = this.data.tddPhases;
    const redPhaseTime = phases.filter(p => p.phase === 'red' && p.duration).reduce((sum, p) => sum + p.duration!, 0);
    const greenPhaseTime = phases.filter(p => p.phase === 'green' && p.duration).reduce((sum, p) => sum + p.duration!, 0);
    const refactorPhaseTime = phases.filter(p => p.phase === 'refactor' && p.duration).reduce((sum, p) => sum + p.duration!, 0);
    const cycleCount = Math.floor(phases.filter(p => p.phase === 'green').length);

    return { redPhaseTime, greenPhaseTime, refactorPhaseTime, cycleCount };
  }

  /**
   * Get retention period in days
   */
  getRetentionDays(): number {
    return this.retentionDays;
  }

  /**
   * Save metrics to disk
   */
  save(): void {
    const ossDir = path.dirname(this.metricsFile);
    if (!fs.existsSync(ossDir)) {
      fs.mkdirSync(ossDir, { recursive: true });
    }

    this.data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.metricsFile, JSON.stringify(this.data, null, 2));
  }

  /**
   * Load metrics from disk
   */
  load(): void {
    try {
      if (fs.existsSync(this.metricsFile)) {
        const content = fs.readFileSync(this.metricsFile, 'utf-8');
        this.data = JSON.parse(content);
      }
    } catch {
      // If file is corrupt, start fresh
      this.data = { sessions: [], tddPhases: [], lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.data = { sessions: [], tddPhases: [], lastUpdated: new Date().toISOString() };
    if (fs.existsSync(this.metricsFile)) {
      fs.unlinkSync(this.metricsFile);
    }
  }
}
