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
}

/** The phase started in this repo: the latest ledger `run/<phase>`, and whether a result row is bound to it. */
export interface StopSubject {
  repo: string;
  feature: string;
  phase: Phase;
  startedAt: string;
  bound: boolean;
  ledger: Ledger;
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
