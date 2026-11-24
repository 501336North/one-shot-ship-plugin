/**
 * Types shared by the Stop dispatcher (R-257 T11, ADR-1) and its checks.
 */
import type { Ledger } from '../phase-results/ledger.js';
import type { Phase } from '../phase-results/schemas.js';

/** What the Stop hook hands the dispatcher (from Claude Code's Stop input). */
export interface StopInput {
  sessionId: string;
  stopHookActive: boolean;
  cwd: string;
  /** CLAUDE_PROJECT_DIR: its repo is checked too, so a nested repo the model cd's into does not hide the project's run. */
  projectDir?: string;
}

/**
 * A phase this session started: its latest ledger `run/<phase>` row of this session names <feature> (or "" with
 * <feature> resolved now, D30), whose folder is still active; and whether a result row is bound to it.
 */
export interface StopSubject {
  repo: string;
  feature: string;
  phase: Phase;
  startedAt: string;
  bound: boolean;
  ledger: Ledger;
  /** The branch resolves to another feature, or none (round 3, finding 2): the CLI check would not reach this one. */
  offBranch: boolean;
}

export interface StopContext {
  input: StopInput;
  subject: StopSubject | null;
  /** The phase-result CLI bundle a check runs `check <phase>` with. */
  phaseResultCli: string;
}

export type CheckOutcome = { kind: 'allow' } | { kind: 'block'; reason: string; systemMessage?: string };

/** One entry of the ordered CHECKS list: returns allow or block, or throws (the dispatcher fails open). */
export interface StopCheck {
  readonly id: string;
  run(ctx: StopContext): CheckOutcome;
}

/** The hook's stdout JSON; null from dispatch() means allow with nothing to say. */
export interface StopOutput {
  decision?: 'block';
  reason?: string;
  systemMessage?: string;
}
