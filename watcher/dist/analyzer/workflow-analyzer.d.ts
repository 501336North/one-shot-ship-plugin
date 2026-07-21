/**
 * WorkflowAnalyzer - Semantic reasoning about workflow health
 *
 * Detects:
 * - Negative signals (presence of bad): loops, stuck phases, regressions, failures
 * - Positive signal erosion (absence of good): silence, missing milestones, declining velocity
 * - Hard stops (positive signals ceased): abrupt stops, partial completion, abandoned agents
 */
import { ParsedLogEntry } from '../logger/log-reader.js';
export type IssueType = 'loop_detected' | 'phase_stuck' | 'regression' | 'out_of_order' | 'chain_broken' | 'tdd_violation' | 'explicit_failure' | 'agent_failed' | 'silence' | 'missing_milestones' | 'declining_velocity' | 'incomplete_outputs' | 'agent_silence' | 'abrupt_stop' | 'partial_completion' | 'abandoned_agent' | 'iron_law_violation' | 'iron_law_repeated' | 'iron_law_ignored' | 'oss_error_auto_remediable' | 'oss_error_escalation';
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
/**
 * Session-lifetime "anchor facts" accumulated by the supervisor on every entry
 * BEFORE the analysis window trims old history. Session-lifetime detectors
 * (chain / regression / out-of-order) consult these so a long session that
 * scrolls its first START or an earlier phase COMPLETE out of the window neither
 * fabricates a false issue nor misses a real one. All fields are optional at the
 * analyzer boundary: when no anchors are supplied, detectors fall back to
 * deriving everything from the (windowed) entries exactly as before.
 */
export interface WorkflowAnchors {
    /** cmd of the very first START observed this session. */
    firstCommand?: string;
    /** Lifetime chain progress (COMPLETE/FAILED status) accumulated before windowing. */
    chainProgress: ChainProgress;
    /** Distinct PHASE_START phases seen over the session, in first-seen order. */
    seenPhases: string[];
    /** Distinct PHASE_COMPLETE phases seen over the session, in first-seen order. */
    completedPhases: string[];
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
    analyze(entries: ParsedLogEntry[], now?: Date, anchors?: WorkflowAnchors): WorkflowAnalysis;
    private buildState;
    private detectLoops;
    private detectStuckPhase;
    private detectRegression;
    private detectOutOfOrder;
    private detectChainViolation;
    private detectTddViolation;
    private detectExplicitFailures;
    private detectAgentFailures;
    private detectIronLawViolations;
    private detectStructuredErrors;
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