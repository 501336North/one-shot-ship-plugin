/**
 * WorkflowLogger - Structured logging for OSS workflow chain
 *
 * Logs entries in hybrid format: JSON line + human-readable summary
 */

import * as fs from 'fs';
import * as path from 'path';

export type WorkflowEvent =
  | 'START'
  | 'PHASE_START'
  | 'PHASE_COMPLETE'
  | 'MILESTONE'
  | 'AGENT_SPAWN'
  | 'AGENT_COMPLETE'
  | 'COMPLETE'
  | 'FAILED';

export interface AgentInfo {
  type: string;
  id: string;
  parent_cmd: string;
}

export interface WorkflowLogEntry {
  cmd: string;
  phase?: string;
  event: WorkflowEvent;
  data: Record<string, unknown>;
  agent?: AgentInfo;
}

interface StoredLogEntry extends WorkflowLogEntry {
  ts: string;
}

export class WorkflowLogger {
  private readonly logPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(ossDir: string) {
    this.logPath = path.join(ossDir, 'workflow.log');
  }

  /**
   * Log a workflow entry
   * Writes atomically: JSON line + human summary
   */
  async log(entry: WorkflowLogEntry): Promise<void> {
    // Queue writes to ensure atomicity
    this.writeQueue = this.writeQueue.then(() => this.doLog(entry));
    return this.writeQueue;
  }

  private async doLog(entry: WorkflowLogEntry): Promise<void> {
    const timestamp = new Date().toISOString();

    const storedEntry: StoredLogEntry = {
      ts: timestamp,
      cmd: entry.cmd,
      event: entry.event,
      data: entry.data,
    };

    if (entry.phase) {
      storedEntry.phase = entry.phase;
    }

    if (entry.agent) {
      storedEntry.agent = entry.agent;
    }

    const jsonLine = JSON.stringify(storedEntry);
    const humanLine = this.formatHumanSummary(storedEntry);

    const content = `${jsonLine}\n${humanLine}\n`;

    // Atomic append
    fs.appendFileSync(this.logPath, content);
  }

  /**
   * Format human-readable summary line
   */
  private formatHumanSummary(entry: StoredLogEntry): string {
    const parts: string[] = ['#'];

    // Command (uppercase)
    parts.push(entry.cmd.toUpperCase());

    // Phase if present
    if (entry.phase) {
      parts[parts.length - 1] += `:${entry.phase}`;
    }

    // Event
    parts[parts.length - 1] += `:${entry.event}`;

    // Description based on event type and data
    const description = this.getDescription(entry);
    if (description) {
      parts.push('-');
      parts.push(description);
    }

    return parts.join(' ');
  }

  private getDescription(entry: StoredLogEntry): string {
    const data = entry.data;

    // Agent events
    if (entry.agent || entry.event === 'AGENT_SPAWN' || entry.event === 'AGENT_COMPLETE') {
      const agentType = entry.agent?.type || data.agent_type;
      const task = data.task as string | undefined;
      if (task) {
        return `${agentType}: ${task}`;
      }
      return `${agentType}`;
    }

    // COMPLETE with summary
    if (entry.event === 'COMPLETE' && data.summary) {
      return data.summary as string;
    }

    // FAILED with error
    if (entry.event === 'FAILED' && data.error) {
      return data.error as string;
    }

    // START with args
    if (entry.event === 'START' && data.args) {
      const args = data.args as string[];
      return args.join(' ');
    }

    // MILESTONE with description
    if (entry.event === 'MILESTONE' && data.description) {
      return data.description as string;
    }

    return '';
  }
}
