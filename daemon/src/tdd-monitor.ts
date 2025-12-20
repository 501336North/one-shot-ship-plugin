/**
 * TddMonitor - Monitor TDD phase for staleness
 *
 * Detects when a TDD phase has been stuck for too long, which may
 * indicate a process is hung or the developer is stuck.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Issue } from './state-manager.js';

export interface TddMonitorConfig {
  ossDir: string;
  staleThresholdMs: number;
}

interface WorkflowState {
  tddPhase?: string;
  tddPhaseStarted?: string;
  [key: string]: unknown;
}

export class TddMonitor {
  private stateFile: string;
  private staleThresholdMs: number;

  constructor(config: TddMonitorConfig) {
    this.stateFile = path.join(config.ossDir, 'workflow-state.json');
    this.staleThresholdMs = config.staleThresholdMs;
  }

  /**
   * Check if the current TDD phase has been stuck for too long
   */
  async checkStaleTddPhase(): Promise<Issue | null> {
    try {
      const content = await fs.readFile(this.stateFile, 'utf-8');
      const state: WorkflowState = JSON.parse(content);

      const { tddPhase, tddPhaseStarted } = state;

      // No TDD phase active
      if (!tddPhase || !tddPhaseStarted) {
        return null;
      }

      const startTime = new Date(tddPhaseStarted).getTime();
      const elapsed = Date.now() - startTime;

      if (elapsed > this.staleThresholdMs) {
        const elapsedMinutes = Math.round(elapsed / 60000);
        return {
          type: 'stale_tdd_phase',
          message: `${tddPhase.toUpperCase()} phase stuck for ${elapsedMinutes}+ minutes`,
          severity: 'warning'
        };
      }

      return null;
    } catch {
      // File doesn't exist or is invalid
      return null;
    }
  }
}
