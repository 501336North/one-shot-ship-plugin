/**
 * MenuBarService - Manages workflow state for SwiftBar menu bar display
 *
 * @behavior Manages a JSON state file that SwiftBar reads to display workflow progress
 */

import * as fs from 'fs';
import * as path from 'path';

export type ChainStep = 'ideate' | 'plan' | 'acceptance' | 'red' | 'green' | 'refactor' | 'integration' | 'ship' | 'build';
export type SupervisorStatus = 'watching' | 'intervening' | 'idle';
export type StepStatus = 'pending' | 'active' | 'done';

export interface WorkflowState {
  supervisor: SupervisorStatus;
  activeStep: ChainStep | null;
  chainState: {
    ideate: StepStatus;
    plan: StepStatus;
    acceptance: StepStatus;
    red: StepStatus;
    green: StepStatus;
    refactor: StepStatus;
    integration: StepStatus;
    ship: StepStatus;
  };
  currentTask?: string;
  progress?: string;
  testsPass?: number;
  lastUpdate: string;
}

export interface ProgressInfo {
  currentTask?: string;
  progress?: string;
  testsPass?: number;
}

const CHAIN_ORDER: ChainStep[] = ['ideate', 'plan', 'acceptance', 'red', 'green', 'refactor', 'integration', 'ship'];
const BUILD_PHASES: ChainStep[] = ['acceptance', 'red', 'green', 'refactor', 'integration'];

export class MenuBarService {
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
   * Sets active step, marks previous steps as done
   */
  async setActiveStep(step: ChainStep): Promise<void> {
    const state = await this.getState();

    // Special handling for 'build' - it's an alias for the TDD phases
    if (step === 'build') {
      state.activeStep = 'build';
      state.chainState.ideate = 'done';
      state.chainState.plan = 'done';
      state.chainState.acceptance = 'active';
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
   * Marks all steps done, resets to idle
   */
  async workflowComplete(): Promise<void> {
    const state = await this.getState();

    // Mark all steps as done
    state.chainState.ideate = 'done';
    state.chainState.plan = 'done';
    state.chainState.acceptance = 'done';
    state.chainState.red = 'done';
    state.chainState.green = 'done';
    state.chainState.refactor = 'done';
    state.chainState.integration = 'done';
    state.chainState.ship = 'done';

    // Reset to idle
    state.supervisor = 'idle';
    state.activeStep = null;

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
   * Returns default state
   */
  private getDefaultState(): WorkflowState {
    return {
      supervisor: 'idle',
      activeStep: null,
      chainState: {
        ideate: 'pending',
        plan: 'pending',
        acceptance: 'pending',
        red: 'pending',
        green: 'pending',
        refactor: 'pending',
        integration: 'pending',
        ship: 'pending',
      },
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
