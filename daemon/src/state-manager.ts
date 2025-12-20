/**
 * StateManager - Manage workflow state for status line display
 *
 * Reads and writes issues to workflow-state.json for daemon/status line
 * communication.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueType = 'hung_process' | 'branch_violation' | 'stale_tdd_phase' | 'test_failure' | string;

export interface Issue {
  type: IssueType;
  message: string;
  severity: IssueSeverity;
}

export interface StateManagerConfig {
  ossDir: string;
}

export interface WorkflowState {
  issue?: Issue | null;
  daemonHeartbeat?: string;
  tddPhase?: string;
  [key: string]: unknown;
}

export class StateManager {
  private stateFile: string;

  constructor(config: StateManagerConfig) {
    this.stateFile = path.join(config.ossDir, 'workflow-state.json');
  }

  /**
   * Read current workflow state
   */
  private async readState(): Promise<WorkflowState> {
    try {
      const content = await fs.readFile(this.stateFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Write workflow state
   */
  private async writeState(state: WorkflowState): Promise<void> {
    await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
  }

  /**
   * Report an issue to workflow state
   */
  async reportIssue(issue: Issue): Promise<void> {
    const state = await this.readState();
    state.issue = issue;
    await this.writeState(state);
  }

  /**
   * Clear current issue
   */
  async clearIssue(): Promise<void> {
    const state = await this.readState();
    state.issue = null;
    await this.writeState(state);
  }

  /**
   * Get current issue if any
   */
  async getCurrentIssue(): Promise<Issue | null> {
    const state = await this.readState();
    return state.issue || null;
  }
}
