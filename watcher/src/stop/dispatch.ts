/**
 * The one Stop dispatcher (R-257 T11, ADR-1; wired in hooks.json by T18).
 *
 * Runs the ordered CHECKS list: the first block wins, later checks run only when earlier ones allow. Before any check,
 * a phase started in this repo without a bound result gets the ledger `pending/<feature>/<phase>` marker (only a
 * successful assemble clears it). Path problems block. A check that throws or runs past its budget fails open but never
 * looks like a pass: the ledger `unverified/<feature>/<phase>` marker and the repo marker `results/<phase>.unverified.json`
 * are written, a systemMessage names the phase and the check, and a STOP_CHECK_ERROR (stop-check-error) event is
 * logged to the project's workflow.log. Loop guard: with stop_hook_active a block becomes allow + unverified +
 * systemMessage. A second fail-open for the same phase in the same session blocks.
 */
import * as path from 'node:path';
import { resolveFeature } from '../phase-results/feature.js';
import { LedgerError, openLedger } from '../phase-results/ledger.js';
import { PHASES, type Phase } from '../phase-results/schemas.js';
import { resolveRepo } from '../phase-results/store.js';
import { WorkflowLogger } from '../logger/workflow-logger.js';
import { safeWriteFileAtomic } from '../utils/safe-project-write.js';
import { blockFor, phaseResultMissing } from './checks/phase-result-missing.js';
import type { CheckOutcome, StopCheck, StopContext, StopInput, StopOutput, StopSubject } from './types.js';

export type { CheckOutcome, StopCheck, StopContext, StopInput, StopOutput, StopSubject } from './types.js';

/** The fixed, ordered check list. R-265 adds `chain-step-pending` here, and nothing else. */
export const CHECKS: readonly StopCheck[] = [phaseResultMissing];

export interface DispatchOptions {
  phaseResultCli: string;
  checks?: readonly StopCheck[];
  /** A check running longer than this (ms) counts as timed out, even when it returns. */
  checkBudgetMs?: number;
}

const DEFAULT_BUDGET_MS = 4000;
const CLASS_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

type Resolved = { kind: 'none' } | { kind: 'subject'; subject: StopSubject } | { kind: 'block'; outcome: CheckOutcome };

function isPathProblem(e: unknown): boolean {
  return e instanceof LedgerError || (e instanceof Error && /^(unsafe_path|too_large|ledger_too_large)\b/.test(e.message));
}

function pathCode(e: unknown): string {
  if (e instanceof LedgerError) return e.code;
  return e instanceof Error ? (/^([a-z_]+)/.exec(e.message)?.[1] ?? 'unsafe_path') : 'unsafe_path';
}

/** An error class name only (never a message or stack: those can carry model text). */
function errorClass(e: unknown): string {
  return e instanceof Error && CLASS_RE.test(e.name) ? e.name : 'unknown';
}

function resolveSubject(cwd: string): Resolved {
  const repo = resolveRepo(cwd);
  if (repo === null) return { kind: 'none' };
  const ledger = openLedger(repo);
  let latest: { phase: Phase; startedAt: string } | null = null;
  for (const phase of PHASES) {
    const startedAt = ledger.lastRow(`run/${phase}`)?.startedAt;
    if (typeof startedAt === 'string' && (latest === null || startedAt > latest.startedAt)) latest = { phase, startedAt };
  }
  if (latest === null) return { kind: 'none' };
  const feature = resolveFeature(repo);
  if (feature === null) return { kind: 'block', outcome: blockFor(latest.phase, 'no_feature', false) };
  const bound = ledger.lastRow(`results/${feature}/${latest.phase}`)?.startedAt === latest.startedAt;
  return { kind: 'subject', subject: { repo, feature, ledger, bound, ...latest } };
}

function toOutput(o: CheckOutcome): StopOutput | null {
  if (o.kind === 'allow') return null;
  return o.systemMessage === undefined
    ? { decision: 'block', reason: o.reason }
    : { decision: 'block', reason: o.reason, systemMessage: o.systemMessage };
}

/** The started phase's name for messages, or 'current' before one is resolved. */
function phaseName(ctx: StopContext): string {
  return ctx.subject?.phase ?? 'current';
}

function recordUnverified(ctx: StopContext, check: string, cls: string): void {
  const s = ctx.subject;
  if (s === null) return;
  const at = new Date().toISOString();
  try {
    s.ledger.writeMarker(`unverified/${s.feature}/${s.phase}`, { check, errorClass: cls, at, session: ctx.input.sessionId });
  } catch {
    /* the repo marker and the systemMessage still go out */
  }
  try {
    const marker = { verification: 'unverified', verificationError: { check, errorClass: cls }, phase: s.phase, at };
    safeWriteFileAtomic(
      path.join(s.repo, '.oss'),
      `dev/active/${s.feature}/results/${s.phase}.unverified.json`,
      `${JSON.stringify(marker)}\n`,
      { newFileMode: 0o600 },
    );
  } catch {
    /* refused or failed: the ledger marker is the one check reads first */
  }
}

async function failOpen(ctx: StopContext, check: string, cls: string): Promise<StopOutput> {
  const s = ctx.subject;
  const phase = phaseName(ctx);
  if (s !== null && !ctx.input.stopHookActive && ctx.input.sessionId !== '') {
    let prev: Record<string, unknown> | null = null;
    try {
      prev = s.ledger.readMarker(`unverified/${s.feature}/${s.phase}`);
    } catch {
      prev = null;
    }
    if (prev?.session === ctx.input.sessionId) {
      return {
        decision: 'block',
        reason:
          `OSS: the ${check} stop check failed again for the ${phase} phase in this session (${cls}). ` +
          `Run ~/.oss/hooks/oss-phase-result.sh assemble ${phase} before stopping.`,
        systemMessage: `OSS: ${check} failed twice for ${phase} (${cls}); the stop is blocked`,
      };
    }
  }
  recordUnverified(ctx, check, cls);
  if (s !== null) {
    try {
      await new WorkflowLogger(path.join(s.repo, '.oss')).log({
        cmd: 'stop',
        phase: s.phase,
        event: 'STOP_CHECK_ERROR',
        data: { check, errorClass: cls },
      });
    } catch {
      /* logging is best effort; the markers and the message carry the failure */
    }
  }
  return {
    systemMessage:
      `OSS: the ${check} stop check could not run for the ${phase} phase (${cls}). ${phase} is marked unverified ` +
      `and will not pass until you run oss-phase-result.sh assemble ${phase}.`,
  };
}

function loopGuard(ctx: StopContext, check: string): StopOutput {
  recordUnverified(ctx, check, 'loop_guard');
  const phase = phaseName(ctx);
  return {
    systemMessage:
      `OSS: stop allowed by the loop guard while the ${phase} phase has no valid result (${check}). ` +
      `${phase} is marked unverified; run oss-phase-result.sh assemble ${phase}.`,
  };
}

/** A block goes out as is, except under stop_hook_active, where the loop guard turns it into an unverified allow. */
function blockOrGuard(ctx: StopContext, check: string, outcome: CheckOutcome): StopOutput | null {
  return ctx.input.stopHookActive ? loopGuard(ctx, check) : toOutput(outcome);
}

export async function dispatch(input: StopInput, opts: DispatchOptions): Promise<StopOutput | null> {
  const checks = opts.checks ?? CHECKS;
  const budget = opts.checkBudgetMs ?? DEFAULT_BUDGET_MS;
  const ctx: StopContext = { input, subject: null, phaseResultCli: opts.phaseResultCli };
  try {
    const r = resolveSubject(input.cwd);
    if (r.kind === 'block') return blockOrGuard(ctx, 'stop-dispatch', r.outcome);
    if (r.kind === 'subject') {
      ctx.subject = r.subject;
      if (!r.subject.bound) {
        r.subject.ledger.writeMarker(`pending/${r.subject.feature}/${r.subject.phase}`, {
          check: 'stop-dispatch',
          at: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    if (!isPathProblem(e)) return failOpen(ctx, 'stop-dispatch', errorClass(e));
    return blockOrGuard(ctx, 'stop-dispatch', blockFor(phaseName(ctx), pathCode(e), true));
  }

  for (const check of checks) {
    const t0 = Date.now();
    let outcome: CheckOutcome;
    try {
      outcome = check.run(ctx);
    } catch (e) {
      if (!isPathProblem(e)) return failOpen(ctx, check.id, errorClass(e));
      outcome = blockFor(phaseName(ctx), pathCode(e), true);
    }
    if (Date.now() - t0 > budget) return failOpen(ctx, check.id, 'timeout');
    if (outcome.kind === 'block') return blockOrGuard(ctx, check.id, outcome);
  }
  return null;
}
