/**
 * WorkflowStateService - Manages workflow state for status line display
 *
 * @behavior Manages a JSON state file that the status line script reads to display workflow progress
 */

import * as fs from 'fs';
import * as path from 'path';

// Discovery Chain: ideate → requirements → apiDesign → dataModel → adr
// Planning Chain: plan → acceptance
// Build Chain: red → mock → green → refactor (LOOP) → integration → contract
// Ship Chain: ship
export type ChainStep =
  | 'ideate' | 'requirements' | 'apiDesign' | 'dataModel' | 'adr'  // Discovery
  | 'plan' | 'acceptance'  // Planning
  | 'red' | 'mock' | 'green' | 'refactor' | 'integration' | 'contract'  // Build
  | 'ship'  // Ship
  | 'build';  // Alias for TDD phases

export type SupervisorStatus = 'watching' | 'intervening' | 'idle';
export type StepStatus = 'pending' | 'active' | 'done';

export interface ActiveAgent {
  type: string;  // Agent type (e.g., 'react-specialist', 'typescript-pro')
  task: string;  // Current task description
  startedAt: string;  // ISO timestamp when agent was spawned
}

export interface WorkflowState {
  supervisor: SupervisorStatus;
  activeStep: ChainStep | null;
  chainState: {
    // Discovery Chain
    ideate: StepStatus;
    requirements: StepStatus;
    apiDesign: StepStatus;
    dataModel: StepStatus;
    adr: StepStatus;
    // Planning Chain
    plan: StepStatus;
    acceptance: StepStatus;
    // Build Chain (TDD Loop)
    red: StepStatus;
    mock: StepStatus;
    green: StepStatus;
    refactor: StepStatus;
    integration: StepStatus;
    contract: StepStatus;
    // Ship Chain
    ship: StepStatus;
  };
  activeAgent?: ActiveAgent;  // Currently executing agent (for status line)
  tddPhase?: string;  // Current TDD phase for status line display (red/green/refactor)
  message?: string;  // Workflow/session message for status line display
  currentTask?: string;
  progress?: string;
  testsPass?: number;
  tddCycle?: number;  // Track which TDD iteration we're on
  currentFeature?: string;  // Current feature being worked on (for health checks)
  lastCompletedStep?: string;  // Last completed workflow step (for health checks)
  lastStepTimestamp?: string;  // When the last step was completed
  lastUpdate: string;
}

export interface ProgressInfo {
  currentTask?: string;
  progress?: string;
  testsPass?: number;
}

// Full chain order for sequential progression
const CHAIN_ORDER: ChainStep[] = [
  // Discovery Chain
  'ideate', 'requirements', 'apiDesign', 'dataModel', 'adr',
  // Planning Chain
  'plan', 'acceptance',
  // Build Chain
  'red', 'mock', 'green', 'refactor', 'integration', 'contract',
  // Ship Chain
  'ship',
];

// Build phases for TDD cycle (acceptance is first, then TDD loop, then integration/contract)
const BUILD_PHASES: ChainStep[] = ['acceptance', 'red', 'mock', 'green', 'refactor', 'integration', 'contract'];

// TDD loop phases that reset when starting a new cycle
const TDD_LOOP_PHASES: ChainStep[] = ['red', 'mock', 'green', 'refactor'];

export class WorkflowStateService {
  private stateFilePath: string;

  constructor(stateFilePath?: string) {
    this.stateFilePath = stateFilePath || path.join(process.env.HOME || '~', '.oss', 'workflow-state.json');
  }

  /**
   * Creates state file with default values if it doesn't exist
   */
  async initialize(): Promise<void> {
    const defaultState = this.getDefaultState();

    // Ensure directory exists
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Only write if file doesn't exist
    if (!fs.existsSync(this.stateFilePath)) {
      await this.writeState(defaultState);
    }
  }

  /**
   * Returns current state (or defaults if file corrupted)
   */
  async getState(): Promise<WorkflowState> {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        return this.getDefaultState();
      }

      const contents = fs.readFileSync(this.stateFilePath, 'utf-8');
      return JSON.parse(contents);
    } catch (error) {
      // File corrupted or doesn't exist - return defaults
      return this.getDefaultState();
    }
  }

  /**
   * Sets active step, marks previous steps as done, future steps as pending
   */
  async setActiveStep(step: ChainStep): Promise<void> {
    const state = await this.getState();

    // Special handling for 'build' - it's an alias for the TDD phases
    if (step === 'build') {
      state.activeStep = 'build';
      state.chainState.ideate = 'done';
      state.chainState.plan = 'done';
      state.chainState.acceptance = 'active';
      // Mark remaining build phases as pending
      state.chainState.red = 'pending';
      state.chainState.mock = 'pending';
      state.chainState.green = 'pending';
      state.chainState.refactor = 'pending';
      state.chainState.integration = 'pending';
      state.chainState.contract = 'pending';
      state.chainState.ship = 'pending';
      await this.writeState(state);
      return;
    }

    const stepIndex = CHAIN_ORDER.indexOf(step);

    // Mark all previous steps as done
    for (let i = 0; i < stepIndex; i++) {
      const prevStep = CHAIN_ORDER[i] as keyof WorkflowState['chainState'];
      state.chainState[prevStep] = 'done';
    }

    // Mark current step as active
    state.activeStep = step;
    const chainKey = step as keyof WorkflowState['chainState'];
    state.chainState[chainKey] = 'active';

    // Mark all future steps as pending
    for (let i = stepIndex + 1; i < CHAIN_ORDER.length; i++) {
      const nextStep = CHAIN_ORDER[i] as keyof WorkflowState['chainState'];
      state.chainState[nextStep] = 'pending';
    }

    await this.writeState(state);
  }

  /**
   * Sets TDD phase within build (acceptance/red/green/refactor/integration)
   */
  async setTddPhase(phase: ChainStep): Promise<void> {
    const state = await this.getState();

    // Ideate and plan should be done
    state.chainState.ideate = 'done';
    state.chainState.plan = 'done';

    const phaseIndex = BUILD_PHASES.indexOf(phase);

    // Mark all previous build phases as done
    for (let i = 0; i < phaseIndex; i++) {
      const prevPhase = BUILD_PHASES[i] as keyof WorkflowState['chainState'];
      state.chainState[prevPhase] = 'done';
    }

    // Mark current phase as active
    const phaseKey = phase as keyof WorkflowState['chainState'];
    state.chainState[phaseKey] = 'active';

    // Mark phases after current as pending
    for (let i = phaseIndex + 1; i < BUILD_PHASES.length; i++) {
      const nextPhase = BUILD_PHASES[i] as keyof WorkflowState['chainState'];
      state.chainState[nextPhase] = 'pending';
    }

    // Set tddPhase field for status line display (red/green/refactor only)
    if (phase === 'red' || phase === 'green' || phase === 'refactor') {
      state.tddPhase = phase;
    }

    await this.writeState(state);
  }

  /**
   * Marks step as done
   */
  async completeStep(step: ChainStep): Promise<void> {
    const state = await this.getState();

    const chainKey = step as keyof WorkflowState['chainState'];
    state.chainState[chainKey] = 'done';
    state.activeStep = null;

    await this.writeState(state);
  }

  /**
   * Resets TDD loop phases (red/mock/green/refactor) for next iteration
   * Called when refactor completes and there are more tasks to do
   */
  async resetTddCycle(): Promise<void> {
    const state = await this.getState();

    // Reset TDD loop phases to pending
    for (const phase of TDD_LOOP_PHASES) {
      const phaseKey = phase as keyof WorkflowState['chainState'];
      state.chainState[phaseKey] = 'pending';
    }

    // Set red as active (starting the new cycle)
    state.chainState.red = 'active';
    state.activeStep = 'red';

    // Increment cycle counter
    state.tddCycle = (state.tddCycle || 1) + 1;

    await this.writeState(state);
  }

  /**
   * Marks all steps done, resets to idle
   */
  async workflowComplete(): Promise<void> {
    const state = await this.getState();

    // Mark all steps as done
    for (const step of CHAIN_ORDER) {
      const stepKey = step as keyof WorkflowState['chainState'];
      state.chainState[stepKey] = 'done';
    }

    // Reset to idle
    state.supervisor = 'idle';
    state.activeStep = null;
    state.tddCycle = undefined;
    state.tddPhase = undefined;  // Clear TDD phase for status line
    delete state.message;  // Clear message for status line

    await this.writeState(state);
  }

  /**
   * Updates supervisor status
   */
  async setSupervisor(status: SupervisorStatus): Promise<void> {
    const state = await this.getState();
    state.supervisor = status;
    await this.writeState(state);
  }

  /**
   * Updates currentTask, progress, testsPass
   */
  async setProgress(info: ProgressInfo): Promise<void> {
    const state = await this.getState();

    if (info.currentTask !== undefined) {
      state.currentTask = info.currentTask;
    }
    if (info.progress !== undefined) {
      state.progress = info.progress;
    }
    if (info.testsPass !== undefined) {
      state.testsPass = info.testsPass;
    }

    await this.writeState(state);
  }

  /**
   * Resets to defaults
   */
  async reset(): Promise<void> {
    await this.writeState(this.getDefaultState());
  }

  /**
   * Sets active agent for status line display
   */
  async setActiveAgent(info: { type: string; task: string }): Promise<void> {
    const state = await this.getState();
    state.activeAgent = {
      type: info.type,
      task: info.task,
      startedAt: new Date().toISOString(),
    };
    await this.writeState(state);
  }

  /**
   * Clears active agent when agent completes
   */
  async clearActiveAgent(): Promise<void> {
    const state = await this.getState();
    delete state.activeAgent;
    await this.writeState(state);
  }

  /**
   * Sets message for status line display (workflow/session events)
   */
  async setMessage(message: string): Promise<void> {
    const state = await this.getState();
    state.message = message;
    await this.writeState(state);
  }

  /**
   * Clears message from status line
   */
  async clearMessage(): Promise<void> {
    const state = await this.getState();
    delete state.message;
    await this.writeState(state);
  }

  /**
   * Determines if we should warn about archive based on workflow state
   *
   * Returns true if:
   * - Last step is 'plan' AND >24h since completion (should have been archived)
   *
   * Returns false if:
   * - Last step is 'ship' (archiving expected on next plan)
   * - No completed step yet
   * - Step completed within last 24h
   */
  async shouldWarnAboutArchive(): Promise<boolean> {
    const state = await this.getState();

    // No completed step - don't warn
    if (!state.lastCompletedStep || !state.lastStepTimestamp) {
      return false;
    }

    // Ship just completed - archiving happens on next plan
    if (state.lastCompletedStep === 'ship') {
      return false;
    }

    // Check if plan completed more than 24h ago
    if (state.lastCompletedStep === 'plan') {
      const completedAt = new Date(state.lastStepTimestamp);
      const now = new Date();
      const hoursSinceComplete = (now.getTime() - completedAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceComplete > 24;
    }

    return false;
  }

  /**
   * Returns default state
   */
  private getDefaultState(): WorkflowState {
    return {
      supervisor: 'idle',
      activeStep: null,
      chainState: {
        // Discovery Chain
        ideate: 'pending',
        requirements: 'pending',
        apiDesign: 'pending',
        dataModel: 'pending',
        adr: 'pending',
        // Planning Chain
        plan: 'pending',
        acceptance: 'pending',
        // Build Chain (TDD Loop)
        red: 'pending',
        mock: 'pending',
        green: 'pending',
        refactor: 'pending',
        integration: 'pending',
        contract: 'pending',
        // Ship Chain
        ship: 'pending',
      },
      tddCycle: 1,
      lastUpdate: new Date().toISOString(),
    };
  }

  /**
   * Writes state to file with updated timestamp
   */
  private async writeState(state: WorkflowState): Promise<void> {
    state.lastUpdate = new Date().toISOString();

    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2));
  }
}
