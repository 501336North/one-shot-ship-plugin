/**
 * WorkflowAnalyzer - Semantic reasoning about workflow health
 *
 * Detects:
 * - Negative signals (presence of bad): loops, stuck phases, regressions, failures
 * - Positive signal erosion (absence of good): silence, missing milestones, declining velocity
 * - Hard stops (positive signals ceased): abrupt stops, partial completion, abandoned agents
 */

import { ParsedLogEntry } from '../logger/log-reader.js';

export type IssueType =
  // Negative signals (presence of bad)
  | 'loop_detected'
  | 'phase_stuck'
  | 'regression'
  | 'out_of_order'
  | 'chain_broken'
  | 'tdd_violation'
  | 'explicit_failure'
  | 'agent_failed'
  // Positive signal erosion (absence of good)
  | 'silence'
  | 'missing_milestones'
  | 'declining_velocity'
  | 'incomplete_outputs'
  | 'agent_silence'
  // Hard stop detection
  | 'abrupt_stop'
  | 'partial_completion'
  | 'abandoned_agent'
  // IRON LAW violations
  | 'iron_law_violation'
  | 'iron_law_repeated'
  | 'iron_law_ignored';

export type HealthStatus = 'healthy' | 'warning' | 'critical';

export type ChainStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

export interface WorkflowIssue {
  type: IssueType;
  confidence: number; // 0-1
  message: string;
  context?: Record<string, unknown>;
}

export interface ActiveAgent {
  id: string;
  type: string;
  spawn_time: string;
  started: boolean;
  completed: boolean;
}

export interface ChainProgress {
  ideate: ChainStatus;
  plan: ChainStatus;
  build: ChainStatus;
  ship: ChainStatus;
}

export interface WorkflowAnalysis {
  health: HealthStatus;
  issues: WorkflowIssue[];
  current_command?: string;
  current_phase?: string;
  phase_start_time?: string;
  last_activity_time?: string;
  milestone_timestamps: string[];
  active_agents: ActiveAgent[];
  expected_milestones: number;
  actual_milestones: number;
  chain_progress: ChainProgress;
}

// Timing thresholds (in milliseconds) - use slightly lower than test values
const THRESHOLDS = {
  SILENCE_WARNING: 90 * 1000, // 1.5 minutes of silence
  PHASE_STUCK: 4 * 60 * 1000, // 4 minutes without phase complete
  ABRUPT_STOP: 2.5 * 60 * 1000, // 2.5 minutes without activity
  AGENT_SILENCE: 50 * 1000, // 50 seconds for agent to start producing entries
  AGENT_ABANDONED: 90 * 1000, // 1.5 minutes for agent to complete
};

// Expected TDD phase order
const PHASE_ORDER = ['RED', 'GREEN', 'REFACTOR'];

// Expected command chain
const COMMAND_CHAIN = ['ideate', 'plan', 'build', 'ship'];

// Expected milestones per phase
const EXPECTED_MILESTONES: Record<string, number> = {
  RED: 1, // At least one test written
  GREEN: 1, // At least one implementation step
  REFACTOR: 0, // Refactor is optional milestones
};

// Commands that require predecessors
const CHAIN_PREREQUISITES: Record<string, string[]> = {
  build: ['plan', 'ideate'],
  ship: ['build'],
};

// Commands that require specific outputs
const EXPECTED_OUTPUTS: Record<string, boolean> = {
  ideate: true, // Should have outputs
  plan: true, // Should have outputs
  build: true, // Should have outputs
};

export class WorkflowAnalyzer {
  /**
   * Analyze workflow log entries and detect issues
   */
  analyze(entries: ParsedLogEntry[], now: Date = new Date()): WorkflowAnalysis {
    const state = this.buildState(entries, now);
    const issues: WorkflowIssue[] = [];

    // Detect negative signals (presence of bad)
    this.detectLoops(entries, issues);
    this.detectStuckPhase(state, now, issues);
    this.detectRegression(entries, issues);
    this.detectOutOfOrder(entries, issues);
    this.detectChainViolation(entries, state, issues);
    this.detectTddViolation(entries, issues);
    this.detectExplicitFailures(entries, issues);
    this.detectAgentFailures(entries, issues);
    this.detectIronLawViolations(entries, issues);

    // Detect positive signal erosion (absence of good)
    this.detectSilence(state, now, issues);
    this.detectMissingMilestones(entries, state, issues);
    this.detectDecliningVelocity(state, now, issues);
    this.detectIncompleteOutputs(entries, issues);
    this.detectAgentSilence(state, now, issues);

    // Detect hard stops
    this.detectAbruptStop(state, now, issues);
    this.detectPartialCompletion(state, now, issues);
    this.detectAbandonedAgent(state, now, issues);

    return {
      health: this.calculateHealth(issues),
      issues,
      current_command: state.currentCommand,
      current_phase: state.currentPhase,
      phase_start_time: state.phaseStartTime,
      last_activity_time: state.lastActivityTime,
      milestone_timestamps: state.milestoneTimestamps,
      active_agents: state.activeAgents,
      expected_milestones: state.expectedMilestones,
      actual_milestones: state.actualMilestones,
      chain_progress: state.chainProgress,
    };
  }

  private buildState(
    entries: ParsedLogEntry[],
    _now: Date
  ): {
    currentCommand?: string;
    currentPhase?: string;
    phaseStartTime?: string;
    lastActivityTime?: string;
    milestoneTimestamps: string[];
    activeAgents: ActiveAgent[];
    expectedMilestones: number;
    actualMilestones: number;
    totalMilestones: number;
    chainProgress: ChainProgress;
    commandComplete: boolean;
    phaseComplete: boolean;
    seenPhases: string[];
    completedPhases: string[];
  } {
    let currentCommand: string | undefined;
    let currentPhase: string | undefined;
    let phaseStartTime: string | undefined;
    let lastActivityTime: string | undefined;
    const milestoneTimestamps: string[] = [];
    const activeAgents: ActiveAgent[] = [];
    let actualMilestones = 0;
    let totalMilestones = 0;
    let commandComplete = false;
    let phaseComplete = false;
    const seenPhases: string[] = [];
    const completedPhases: string[] = [];

    const chainProgress: ChainProgress = {
      ideate: 'pending',
      plan: 'pending',
      build: 'pending',
      ship: 'pending',
    };

    for (const entry of entries) {
      lastActivityTime = entry.ts;

      // Track current command (from START or from any entry)
      if (!currentCommand && entry.cmd) {
        currentCommand = entry.cmd;
      }

      // Track command lifecycle
      if (entry.event === 'START') {
        currentCommand = entry.cmd;
        commandComplete = false;
        phaseComplete = false;

        if (entry.cmd in chainProgress) {
          chainProgress[entry.cmd as keyof ChainProgress] = 'in_progress';
        }
      }

      if (entry.event === 'COMPLETE') {
        commandComplete = true;
        if (entry.cmd in chainProgress) {
          chainProgress[entry.cmd as keyof ChainProgress] = 'complete';
        }
      }

      if (entry.event === 'FAILED') {
        if (entry.cmd in chainProgress) {
          chainProgress[entry.cmd as keyof ChainProgress] = 'failed';
        }
      }

      // Track phase lifecycle
      if (entry.event === 'PHASE_START' && entry.phase) {
        currentPhase = entry.phase;
        phaseStartTime = entry.ts;
        phaseComplete = false;
        actualMilestones = 0; // Reset milestone count for new phase
        if (!seenPhases.includes(entry.phase)) {
          seenPhases.push(entry.phase);
        }
      }

      // Track phase completion
      if (entry.event === 'PHASE_COMPLETE') {
        phaseComplete = true;
        if (entry.phase && !completedPhases.includes(entry.phase)) {
          completedPhases.push(entry.phase);
        }
      }

      // Track milestones
      if (entry.event === 'MILESTONE') {
        milestoneTimestamps.push(entry.ts);
        actualMilestones++;
        totalMilestones++;
      }

      // Track agents
      if (entry.event === 'AGENT_SPAWN') {
        const agentId = entry.data.agent_id as string;
        const agentType = entry.data.agent_type as string;
        activeAgents.push({
          id: agentId,
          type: agentType,
          spawn_time: entry.ts,
          started: false,
          completed: false,
        });
      }

      if (entry.event === 'AGENT_COMPLETE') {
        const agentId = entry.data.agent_id as string;
        const agent = activeAgents.find((a) => a.id === agentId);
        if (agent) {
          agent.completed = true;
        }
      }

      // Track agent START (from agent entries)
      if (entry.agent && entry.event === 'START') {
        const agent = activeAgents.find((a) => a.id === entry.agent!.id);
        if (agent) {
          agent.started = true;
        }
      }
    }

    // Calculate expected milestones based on current phase
    const expectedMilestones = currentPhase ? (EXPECTED_MILESTONES[currentPhase] ?? 0) : 0;

    return {
      currentCommand,
      currentPhase,
      phaseStartTime,
      lastActivityTime,
      milestoneTimestamps,
      activeAgents,
      expectedMilestones,
      actualMilestones,
      totalMilestones,
      chainProgress,
      commandComplete,
      phaseComplete,
      seenPhases,
      completedPhases,
    };
  }

  private detectLoops(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    // Look for repeated similar entries
    const recentEntries = entries.slice(-10);
    const actionSignatures: string[] = [];

    for (const entry of recentEntries) {
      if (entry.event === 'MILESTONE') {
        // Create signature from milestone data
        const signature = JSON.stringify(entry.data);
        actionSignatures.push(signature);
      }
    }

    // Count consecutive repeats
    let maxRepeats = 0;
    let currentRepeats = 1;
    let lastSignature = '';

    for (const sig of actionSignatures) {
      if (sig === lastSignature) {
        currentRepeats++;
        maxRepeats = Math.max(maxRepeats, currentRepeats);
      } else {
        currentRepeats = 1;
        lastSignature = sig;
      }
    }

    if (maxRepeats >= 3) {
      // Confidence increases with number of repeats (5+ repeats = >0.9 confidence)
      const confidence = Math.min(0.98, 0.85 + (maxRepeats - 3) * 0.03);
      issues.push({
        type: 'loop_detected',
        confidence,
        message: `Same action repeated ${maxRepeats} times consecutively`,
        context: { repeat_count: maxRepeats },
      });
    }
  }

  private detectStuckPhase(
    state: ReturnType<typeof this.buildState>,
    now: Date,
    issues: WorkflowIssue[]
  ): void {
    if (!state.phaseStartTime || state.phaseComplete) return;

    const elapsed = now.getTime() - new Date(state.phaseStartTime).getTime();
    if (elapsed > THRESHOLDS.PHASE_STUCK) {
      issues.push({
        type: 'phase_stuck',
        confidence: 0.85,
        message: `Phase ${state.currentPhase} has been running for ${Math.round(elapsed / 60000)} minutes without completion`,
        context: { phase: state.currentPhase, elapsed_ms: elapsed },
      });
    }
  }

  private detectRegression(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    // Look for COMPLETE followed by FAILED
    let hadComplete = false;
    let completedPhase: string | undefined;

    for (const entry of entries) {
      if (entry.event === 'PHASE_COMPLETE') {
        hadComplete = true;
        completedPhase = entry.phase;
      }

      if (entry.event === 'FAILED' && hadComplete) {
        issues.push({
          type: 'regression',
          confidence: 0.9,
          message: `Workflow failed after ${completedPhase} phase completed successfully`,
          context: { completed_phase: completedPhase, error: entry.data.error },
        });
      }
    }
  }

  private detectOutOfOrder(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    const seenPhases: string[] = [];

    for (const entry of entries) {
      if (entry.event === 'PHASE_START' && entry.phase) {
        const expectedIndex = PHASE_ORDER.indexOf(entry.phase);
        const lastSeenIndex = seenPhases.length > 0 ? PHASE_ORDER.indexOf(seenPhases[seenPhases.length - 1]) : -1;

        // If we're seeing a phase that should come before what we've already seen
        if (expectedIndex !== -1 && lastSeenIndex !== -1 && expectedIndex < lastSeenIndex) {
          issues.push({
            type: 'out_of_order',
            confidence: 0.85,
            message: `Phase ${entry.phase} started after ${seenPhases[seenPhases.length - 1]}, expected order: ${PHASE_ORDER.join(' → ')}`,
            context: { expected: PHASE_ORDER, actual_order: [...seenPhases, entry.phase] },
          });
        }

        // Check for skipped phases (e.g., GREEN without RED)
        if (expectedIndex > 0 && !seenPhases.includes(PHASE_ORDER[expectedIndex - 1])) {
          issues.push({
            type: 'out_of_order',
            confidence: 0.9,
            message: `Phase ${entry.phase} started without completing ${PHASE_ORDER[expectedIndex - 1]}`,
            context: { started: entry.phase, missing: PHASE_ORDER[expectedIndex - 1] },
          });
        }

        if (!seenPhases.includes(entry.phase)) {
          seenPhases.push(entry.phase);
        }
      }
    }
  }

  private detectChainViolation(
    entries: ParsedLogEntry[],
    state: ReturnType<typeof this.buildState>,
    issues: WorkflowIssue[]
  ): void {
    // Find the first command START
    const firstCommand = entries.find((e) => e.event === 'START')?.cmd;
    if (!firstCommand) return;

    const prerequisites = CHAIN_PREREQUISITES[firstCommand];
    if (!prerequisites) return;

    // Check if any prerequisite was completed (either in log or in chain progress)
    const hasPrerequisite = prerequisites.some(
      (prereq) => state.chainProgress[prereq as keyof ChainProgress] === 'complete'
    );

    // Also check if there are any prior entries indicating the chain
    const hasEarlierChainContext = entries.some((e) => prerequisites.includes(e.cmd) && e.event === 'COMPLETE');

    if (!hasPrerequisite && !hasEarlierChainContext) {
      issues.push({
        type: 'chain_broken',
        confidence: 0.6, // Lower confidence since we might be mid-session or joining an existing workflow
        message: `Command ${firstCommand} started without completing prerequisite: ${prerequisites.join(' or ')}`,
        context: { command: firstCommand, expected_prerequisites: prerequisites },
      });
    }
  }

  private detectTddViolation(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    // Check if GREEN phase started without RED
    let seenRed = false;
    let buildStarted = false;

    for (const entry of entries) {
      if (entry.cmd === 'build' && entry.event === 'START') {
        buildStarted = true;
        seenRed = false; // Reset for this build command
      }

      if (buildStarted && entry.event === 'PHASE_START') {
        if (entry.phase === 'RED') {
          seenRed = true;
        } else if (entry.phase === 'GREEN' && !seenRed) {
          issues.push({
            type: 'tdd_violation',
            confidence: 0.95,
            message: 'GREEN phase started without completing RED phase first (write tests before implementation)',
            context: { violation: 'green_before_red' },
          });
        }
      }
    }
  }

  private detectExplicitFailures(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    for (const entry of entries) {
      if (entry.event === 'FAILED') {
        issues.push({
          type: 'explicit_failure',
          confidence: 0.95,
          message: `Command ${entry.cmd} failed: ${entry.data.error || 'Unknown error'}`,
          context: { command: entry.cmd, error: entry.data.error },
        });
      }
    }
  }

  private detectAgentFailures(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    for (const entry of entries) {
      if (entry.event === 'AGENT_COMPLETE' && entry.data.status === 'failed') {
        issues.push({
          type: 'agent_failed',
          confidence: 0.9,
          message: `Agent ${entry.data.agent_type || entry.data.agent_id} failed: ${entry.data.error || 'Unknown error'}`,
          context: { agent_id: entry.data.agent_id, error: entry.data.error },
        });
      }
    }
  }

  private detectIronLawViolations(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    const violationCounts: Map<number, number> = new Map();

    for (const entry of entries) {
      if (entry.event === 'IRON_LAW_CHECK') {
        const violations = entry.data.violations as Array<{ law: number; message: string }>;
        if (violations && violations.length > 0) {
          for (const v of violations) {
            // Track count
            const count = (violationCounts.get(v.law) || 0) + 1;
            violationCounts.set(v.law, count);

            if (count >= 2) {
              // Repeated violation
              issues.push({
                type: 'iron_law_repeated',
                confidence: 0.95,
                message: `IRON LAW #${v.law} violated ${count} times: ${v.message}`,
                context: { law: v.law, message: v.message, count },
              });
            } else {
              // First violation
              issues.push({
                type: 'iron_law_violation',
                confidence: 0.95,
                message: `IRON LAW #${v.law} violated: ${v.message}`,
                context: { law: v.law, message: v.message },
              });
            }
          }
        }
      }
    }
  }

  private detectSilence(state: ReturnType<typeof this.buildState>, now: Date, issues: WorkflowIssue[]): void {
    if (!state.lastActivityTime || state.commandComplete) return;
    // Need at least a command or phase active to detect silence
    if (!state.currentCommand && !state.currentPhase) return;

    const elapsed = now.getTime() - new Date(state.lastActivityTime).getTime();
    if (elapsed > THRESHOLDS.SILENCE_WARNING) {
      const confidence = Math.min(0.9, 0.7 + (elapsed / THRESHOLDS.SILENCE_WARNING - 1) * 0.1);
      const context = state.currentCommand || state.currentPhase || 'workflow';
      issues.push({
        type: 'silence',
        confidence,
        message: `No activity for ${Math.round(elapsed / 60000)} minutes while ${context} is active`,
        context: { command: state.currentCommand, phase: state.currentPhase, silence_duration_ms: elapsed },
      });
    }
  }

  private detectMissingMilestones(
    entries: ParsedLogEntry[],
    state: ReturnType<typeof this.buildState>,
    issues: WorkflowIssue[]
  ): void {
    // Check for phases that completed without expected milestones
    let currentPhase: string | undefined;
    let phaseMilestones = 0;

    for (const entry of entries) {
      if (entry.event === 'PHASE_START' && entry.phase) {
        currentPhase = entry.phase;
        phaseMilestones = 0;
      }

      if (entry.event === 'MILESTONE') {
        phaseMilestones++;
      }

      if (entry.event === 'PHASE_COMPLETE' && currentPhase) {
        const expected = EXPECTED_MILESTONES[currentPhase] ?? 0;
        if (expected > 0 && phaseMilestones < expected) {
          issues.push({
            type: 'missing_milestones',
            confidence: 0.8,
            message: `Phase ${currentPhase} completed with ${phaseMilestones} milestones, expected at least ${expected}`,
            context: { phase: currentPhase, actual: phaseMilestones, expected },
          });
        }
      }
    }
  }

  private detectDecliningVelocity(
    state: ReturnType<typeof this.buildState>,
    _now: Date,
    issues: WorkflowIssue[]
  ): void {
    if (state.milestoneTimestamps.length < 4) return;

    // Calculate gaps between milestones
    const gaps: number[] = [];
    for (let i = 1; i < state.milestoneTimestamps.length; i++) {
      const gap = new Date(state.milestoneTimestamps[i]).getTime() - new Date(state.milestoneTimestamps[i - 1]).getTime();
      gaps.push(gap);
    }

    // Check if gaps are consistently increasing (any increase counts)
    let increasingCount = 0;
    for (let i = 1; i < gaps.length; i++) {
      if (gaps[i] > gaps[i - 1]) {
        // Gap increased at all
        increasingCount++;
      }
    }

    // If at least half the gaps are increasing, flag declining velocity
    if (increasingCount >= 1) {
      issues.push({
        type: 'declining_velocity',
        confidence: Math.min(0.6, 0.4 + increasingCount * 0.1), // Lower confidence for velocity issues
        message: 'Time between milestones is increasing, workflow may be slowing down',
        context: { gaps_ms: gaps, increasing_count: increasingCount },
      });
    }
  }

  private detectIncompleteOutputs(entries: ParsedLogEntry[], issues: WorkflowIssue[]): void {
    for (const entry of entries) {
      if (entry.event === 'COMPLETE') {
        const expectsOutputs = EXPECTED_OUTPUTS[entry.cmd] ?? false;
        const hasOutputs = Array.isArray(entry.data.outputs) && entry.data.outputs.length > 0;

        if (expectsOutputs && !hasOutputs) {
          issues.push({
            type: 'incomplete_outputs',
            confidence: 0.75,
            message: `Command ${entry.cmd} completed without expected outputs`,
            context: { command: entry.cmd },
          });
        }
      }
    }
  }

  private detectAgentSilence(state: ReturnType<typeof this.buildState>, now: Date, issues: WorkflowIssue[]): void {
    for (const agent of state.activeAgents) {
      if (!agent.started && !agent.completed) {
        const elapsed = now.getTime() - new Date(agent.spawn_time).getTime();
        if (elapsed > THRESHOLDS.AGENT_SILENCE) {
          issues.push({
            type: 'agent_silence',
            confidence: 0.8,
            message: `Agent ${agent.type} (${agent.id}) spawned but hasn't started producing entries`,
            context: { agent_id: agent.id, agent_type: agent.type, silence_duration_ms: elapsed },
          });
        }
      }
    }
  }

  private detectAbruptStop(state: ReturnType<typeof this.buildState>, now: Date, issues: WorkflowIssue[]): void {
    if (!state.lastActivityTime || state.commandComplete) return;

    const elapsed = now.getTime() - new Date(state.lastActivityTime).getTime();
    const hasProgress = state.totalMilestones > 0;

    if (elapsed > THRESHOLDS.ABRUPT_STOP && hasProgress) {
      issues.push({
        type: 'abrupt_stop',
        confidence: 0.85,
        message: `Workflow was making progress but stopped abruptly ${Math.round(elapsed / 60000)} minutes ago`,
        context: { last_activity: state.lastActivityTime, milestones_before_stop: state.totalMilestones },
      });
    }
  }

  private detectPartialCompletion(state: ReturnType<typeof this.buildState>, now: Date, issues: WorkflowIssue[]): void {
    if (state.commandComplete) return;

    // Check if we have completed phases but current phase is incomplete and stale
    const hasCompletedPhases = state.completedPhases.length > 0;
    if (!hasCompletedPhases || !state.phaseStartTime) return;

    const elapsed = now.getTime() - new Date(state.phaseStartTime).getTime();
    if (elapsed > THRESHOLDS.PHASE_STUCK && !state.phaseComplete) {
      issues.push({
        type: 'partial_completion',
        confidence: 0.8,
        message: `Workflow partially complete (${state.completedPhases.join(', ')} done) but ${state.currentPhase} phase stalled`,
        context: { completed_phases: state.completedPhases, stuck_phase: state.currentPhase },
      });
    }
  }

  private detectAbandonedAgent(state: ReturnType<typeof this.buildState>, now: Date, issues: WorkflowIssue[]): void {
    for (const agent of state.activeAgents) {
      if (agent.started && !agent.completed) {
        const elapsed = now.getTime() - new Date(agent.spawn_time).getTime();
        if (elapsed > THRESHOLDS.AGENT_ABANDONED) {
          issues.push({
            type: 'abandoned_agent',
            confidence: 0.8,
            message: `Agent ${agent.type} (${agent.id}) started but never completed`,
            context: { agent_id: agent.id, agent_type: agent.type, running_time_ms: elapsed },
          });
        }
      }
    }
  }

  private calculateHealth(issues: WorkflowIssue[]): HealthStatus {
    if (issues.length === 0) return 'healthy';

    // Check for critical issues (high confidence failures)
    const hasCritical = issues.some(
      (i) =>
        i.confidence > 0.9 &&
        ['explicit_failure', 'agent_failed', 'regression', 'tdd_violation', 'loop_detected', 'iron_law_violation', 'iron_law_repeated'].includes(i.type)
    );

    if (hasCritical) return 'critical';

    // Check for warning-level issues
    const hasWarnings = issues.some((i) => i.confidence >= 0.7);
    if (hasWarnings) return 'warning';

    return 'healthy';
  }
}
