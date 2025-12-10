/**
 * WorkflowStateService - Track workflow step progression
 *
 * Tracks the current workflow state to enable smarter health checks:
 * - Current feature being worked on
 * - Last completed workflow step (ideate → plan → build → ship)
 * - Timestamp of last step completion
 *
 * State is persisted to ~/.oss/workflow-state.json
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export type WorkflowStep = 'ideate' | 'plan' | 'build' | 'ship';

export interface WorkflowState {
  currentFeature: string | null;
  lastCompletedStep: WorkflowStep | null;
  lastStepTimestamp: string | null;
}

const VALID_STEPS: WorkflowStep[] = ['ideate', 'plan', 'build', 'ship'];

const DEFAULT_STATE: WorkflowState = {
  currentFeature: null,
  lastCompletedStep: null,
  lastStepTimestamp: null,
};

export class WorkflowStateService {
  private ossDir: string;
  private stateFile: string;
  private state: WorkflowState = { ...DEFAULT_STATE };

  constructor(ossDir: string = `${process.env.HOME}/.oss`) {
    this.ossDir = ossDir;
    // Use a separate file from menubar workflow-state.json
    this.stateFile = path.join(ossDir, 'health-workflow-state.json');
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
   * Get current workflow state
   */
  async getState(): Promise<WorkflowState> {
    return { ...this.state };
  }

  /**
   * Set the current feature being worked on
   * Clears previous step state (starting fresh on new feature)
   */
  async setCurrentFeature(featureName: string): Promise<void> {
    this.state.currentFeature = featureName;
    this.state.lastCompletedStep = null;
    this.state.lastStepTimestamp = null;
    await this.persist();
  }

  /**
   * Record completion of a workflow step
   */
  async completeStep(step: WorkflowStep): Promise<void> {
    if (!VALID_STEPS.includes(step)) {
      throw new Error(`Invalid workflow step: ${step}. Must be one of: ${VALID_STEPS.join(', ')}`);
    }

    this.state.lastCompletedStep = step;
    this.state.lastStepTimestamp = new Date().toISOString();
    await this.persist();
  }

  /**
   * Clear all workflow state
   */
  async clearState(): Promise<void> {
    this.state = { ...DEFAULT_STATE };
    await this.persist();
  }

  /**
   * Get age of last completed step in hours
   * Returns null if no step has been completed
   */
  async getStepAgeHours(): Promise<number | null> {
    if (!this.state.lastStepTimestamp) {
      return null;
    }

    const stepTime = new Date(this.state.lastStepTimestamp).getTime();
    const now = Date.now();
    const ageMs = now - stepTime;
    return Math.floor(ageMs / (1000 * 60 * 60));
  }

  /**
   * Determine if archive check should warn about unarchived features
   *
   * Logic:
   * - If last step is 'ship' → don't warn (archiving expected on next plan)
   * - If last step is 'plan' and >24h old → warn (plan should have archived)
   * - Otherwise → don't warn
   */
  async shouldWarnAboutArchive(): Promise<boolean> {
    // No workflow state → don't warn
    if (!this.state.lastCompletedStep) {
      return false;
    }

    // Just shipped → don't warn (archiving happens on next plan)
    if (this.state.lastCompletedStep === 'ship') {
      return false;
    }

    // Plan was run but didn't archive → only warn if >24h
    if (this.state.lastCompletedStep === 'plan') {
      const ageHours = await this.getStepAgeHours();
      return ageHours !== null && ageHours > 24;
    }

    // Other steps (ideate, build) → don't warn
    return false;
  }

  /**
   * Persist state to file
   */
  private async persist(): Promise<void> {
    await fs.mkdir(this.ossDir, { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
  }
}
