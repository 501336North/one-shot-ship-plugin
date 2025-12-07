/**
 * WorkflowAnalyzer - Semantic reasoning about workflow health
 *
 * Detects:
 * - Negative signals (presence of bad): loops, stuck phases, regressions, failures
 * - Positive signal erosion (absence of good): silence, missing milestones, declining velocity
 * - Hard stops (positive signals ceased): abrupt stops, partial completion, abandoned agents
 */
import { ParsedLogEntry } from '../logger/log-reader.js';
export type IssueType = 'loop_detected' | 'phase_stuck' | 'regression' | 'out_of_order' | 'chain_broken' | 'tdd_violation' | 'explicit_failure' | 'agent_failed' | 'silence' | 'missing_milestones' | 'declining_velocity' | 'incomplete_outputs' | 'agent_silence' | 'abrupt_stop' | 'partial_completion' | 'abandoned_agent';
export type HealthStatus = 'healthy' | 'warning' | 'critical';
export type ChainStatus = 'pending' | 'in_progress' | 'complete' | 'failed';
export interface WorkflowIssue {
    type: IssueType;
    confidence: number;
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
export declare class WorkflowAnalyzer {
    /**
     * Analyze workflow log entries and detect issues
     */
    analyze(entries: ParsedLogEntry[], now?: Date): WorkflowAnalysis;
    private buildState;
    private detectLoops;
    private detectStuckPhase;
    private detectRegression;
    private detectOutOfOrder;
    private detectChainViolation;
    private detectTddViolation;
    private detectExplicitFailures;
    private detectAgentFailures;
    private detectSilence;
    private detectMissingMilestones;
    private detectDecliningVelocity;
    private detectIncompleteOutputs;
    private detectAgentSilence;
    private detectAbruptStop;
    private detectPartialCompletion;
    private detectAbandonedAgent;
    private calculateHealth;
}
//# sourceMappingURL=workflow-analyzer.d.ts.map