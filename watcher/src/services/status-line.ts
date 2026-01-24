/**
 * StatusLineService - Track TDD phase and workflow progress for status line display
 *
 * Tracks:
 * - Current TDD phase (RED/GREEN/REFACTOR)
 * - Task progress (current/total)
 * - Supervisor status (watching/intervening/idle)
 * - Context health (healthy/warning/critical based on token usage)
 *
 * State is persisted to ~/.oss/status-line.json for SwiftBar/Claude Code status line
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export type TDDPhase = 'RED' | 'GREEN' | 'REFACTOR';
export type SupervisorStatus = 'watching' | 'intervening' | 'idle';
export type ContextHealthLevel = 'healthy' | 'warning' | 'critical';

export interface ContextHealthInfo {
  level: ContextHealthLevel;
  usagePercent: number;
  tokensUsed?: number;
  tokensTotal?: number;
}

export interface StatusLineState {
  phase: TDDPhase | null;
  task: string | null;
  supervisor: SupervisorStatus | null;
  contextHealth: ContextHealthInfo | null;
}

const DEFAULT_STATE: StatusLineState = {
  phase: null,
  task: null,
  supervisor: null,
  contextHealth: null,
};

/**
 * Calculate context health level based on usage percentage
 * @param usagePercent - Context usage as a percentage (0-100)
 * @returns ContextHealthLevel: 'healthy' (< 50%), 'warning' (50-69%), 'critical' (>= 70%)
 */
export function calculateContextHealthLevel(usagePercent: number): ContextHealthLevel {
  if (usagePercent >= 70) {
    return 'critical';
  }
  if (usagePercent >= 50) {
    return 'warning';
  }
  return 'healthy';
}

export class StatusLineService {
  private ossDir: string;
  private stateFile: string;
  private state: StatusLineState = { ...DEFAULT_STATE };

  constructor(ossDir: string = `${process.env.HOME}/.oss`) {
    this.ossDir = ossDir;
    this.stateFile = path.join(ossDir, 'status-line.json');
  }

  /**
   * Initialize service by loading existing state (if any)
   */
  async initialize(): Promise<void> {
    try {
      const content = await fs.readFile(this.stateFile, 'utf-8');
      this.state = JSON.parse(content);
    } catch {
      // No existing state file, use defaults
      this.state = { ...DEFAULT_STATE };
    }
  }

  /**
   * Get current status line state
   */
  async getState(): Promise<StatusLineState> {
    return { ...this.state };
  }

  /**
   * Set the current TDD phase
   */
  async setTDDPhase(phase: TDDPhase): Promise<void> {
    this.state.phase = phase;
    await this.persist();
  }

  /**
   * Set task progress
   */
  async setTaskProgress(current: number, total: number): Promise<void> {
    this.state.task = `${current}/${total}`;
    await this.persist();
  }

  /**
   * Set supervisor status
   */
  async setSupervisorStatus(status: SupervisorStatus): Promise<void> {
    this.state.supervisor = status;
    await this.persist();
  }

  /**
   * Set context health information
   */
  async setContextHealth(info: ContextHealthInfo): Promise<void> {
    this.state.contextHealth = info;
    await this.persist();
  }

  /**
   * Clear all state
   */
  async clearState(): Promise<void> {
    this.state = { ...DEFAULT_STATE };
    await this.persist();
  }

  /**
   * Persist state to file
   */
  private async persist(): Promise<void> {
    await fs.mkdir(this.ossDir, { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
  }
}
