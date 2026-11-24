/**
 * The one Stop dispatcher (R-257 T11, ADR-1; wired in hooks.json by T18).
 *
 * The subjects are EVERY phase THIS session started (round 3, finding 1): per phase, this session's latest ledger
 * `run/<phase>` row, scanned back past other sessions' newer rows. A row naming feature F is checked for F whatever the
 * branch resolves to now (round 3, finding 2); if F's folder left .oss/dev/active with no bound result, the stop is
 * allowed with the `unverified/F/<phase>` marker and a systemMessage, said once per run. A row with feature "" (started
 * before its folder existed) counts for the feature resolved now; with none resolved the stop is allowed with the
 * `unfiled/<phase>` marker and a systemMessage, said once per run (`no_feature`, D30). Other sessions' runs allow and
 * write nothing. The cwd's repo and the CLAUDE_PROJECT_DIR repo are both checked; a block from either wins.
 *
 * Runs the ordered CHECKS list: the first block wins, later checks run only when earlier ones allow. Before any check,
 * the subject without a bound result gets the ledger `pending/<feature>/<phase>` marker (only a successful assemble
 * clears it). Path problems block; an oversized ledger (`ledger_too_large`) fails open, since assemble cannot fix it. A check that throws or runs past its budget fails open but never
 * looks like a pass: the ledger `unverified/<feature>/<phase>` marker and the repo marker `results/<phase>.unverified.json`
 * are written, a systemMessage names the phase and the check, and a STOP_CHECK_ERROR (stop-check-error) event is
 * logged to the project's workflow.log. Loop guard: with stop_hook_active a block becomes allow + unverified +
 * systemMessage. A second fail-open for the same phase in the same session blocks.
 */
import * as path from 'node:path';
import { activeFeatures, resolveFeature } from '../phase-results/feature.js';
import { LedgerError, openLedger, parseRunRow, type Ledger, type RunRow } from '../phase-results/ledger.js';
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

function pathCode(e: unknown): string {
  if (e instanceof LedgerError) return e.code;
  return e instanceof Error ? (/^([a-z_]+)/.exec(e.message)?.[1] ?? 'unsafe_path') : 'unsafe_path';
}

/** Path problems block; ledger_too_large is not one here: it fails open (finding 8). */
function isPathProblem(e: unknown): boolean {
  const known = e instanceof LedgerError || (e instanceof Error && /^(unsafe_path|too_large|ledger_too_large)\b/.test(e.message));
  return known && pathCode(e) !== 'ledger_too_large';
}

/** An error class name only (never a message or stack: those can carry model text). */
function errorClass(e: unknown): string {
  if (e instanceof LedgerError) return e.code;
  return e instanceof Error && CLASS_RE.test(e.name) ? e.name : 'unknown';
}

/**
 * Where the marker of a run with no feature to check against goes (D30). Its own top folder: the ledger's segment
 * rule and the feature-name rule accept the same names, so no name under unverified/ could be kept from a feature.
 */
const UNFILED_DIR = 'unfiled';

/** One of this session's runs in the repo: a subject to check, a run with no feature (D30), or a feature moved away. */
type Item =
  | { kind: 'subject'; subject: StopSubject }
  | { kind: 'unfiled'; phase: Phase; startedAt: string }
  | { kind: 'gone'; feature: string; phase: Phase; startedAt: string };

/** This session's latest run row of <phase>, scanning back past other sessions' newer rows; null when none. */
function sessionRun(ledger: Ledger, phase: Phase, sessionId: string): RunRow | null {
  const found: { run: RunRow | null } = { run: null };
  ledger.scanBack(`run/${phase}`, (row) => {
    if (row.session !== sessionId) return true;
    found.run = parseRunRow(row);
    return false;
  });
  return found.run;
}

/**
 * Every phase whose latest run row of THIS session names a feature: that feature, whatever the branch resolves to now
 * (round 3, finding 2), or for a "" row the feature resolved now (D30). Newest first.
 */
function resolveItems(repo: string, sessionId: string): { ledger: Ledger; items: Item[] } {
  const resolved = resolveFeature(repo);
  const active = activeFeatures(repo);
  const ledger = openLedger(repo);
  const items: Item[] = [];
  for (const phase of PHASES) {
    const run = sessionRun(ledger, phase, sessionId);
    if (run === null) continue;
    const { startedAt } = run;
    const feature = run.feature !== '' ? run.feature : resolved;
    if (feature === null) {
      items.push({ kind: 'unfiled', phase, startedAt });
      continue;
    }
    const bound = ledger.lastRow(`results/${feature}/${phase}`)?.startedAt === startedAt;
    if (active.includes(feature)) {
      items.push({ kind: 'subject', subject: { repo, feature, phase, startedAt, bound, ledger, offBranch: feature !== resolved } });
    } else if (!bound) {
      items.push({ kind: 'gone', feature, phase, startedAt });
    }
  }
  const at = (i: Item): string => (i.kind === 'subject' ? i.subject.startedAt : i.startedAt);
  return { ledger, items: items.sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0)) };
}

/** Writes the marker and returns <message>, unless the marker already holds this session's run: then null (once per run). */
function noteOnce(ledger: Ledger, rel: string, cls: string, sessionId: string, startedAt: string, message: string): string | null {
  try {
    const m = ledger.readMarker(rel);
    if (m?.session === sessionId && m.startedAt === startedAt) return null;
  } catch {
    /* unreadable: say it again */
  }
  try {
    ledger.writeMarker(rel, { check: 'stop-dispatch', errorClass: cls, at: new Date().toISOString(), session: sessionId, startedAt });
  } catch {
    /* the systemMessage still goes out */
  }
  return message;
}

/** D30: no feature to build the result for, so a block could not be followed: allow, marked unverified, said once. */
function unfiled(ledger: Ledger, phase: Phase, startedAt: string, sessionId: string): string | null {
  return noteOnce(
    ledger,
    `${UNFILED_DIR}/${phase}`,
    'no_feature',
    sessionId,
    startedAt,
    `OSS: the ${phase} phase started in this session has no feature folder to check its result against ` +
      `(no_feature). ${phase} is marked unverified; once its feature folder exists, run oss-phase-result.sh assemble ${phase}.`,
  );
}

/** Round 3, finding 2: the run's feature folder left .oss/dev/active with no result: no assemble can reach it. */
function gone(ledger: Ledger, feature: string, phase: Phase, startedAt: string, sessionId: string): string | null {
  return noteOnce(
    ledger,
    `unverified/${feature}/${phase}`,
    'feature_gone',
    sessionId,
    startedAt,
    `OSS: the ${phase} phase of feature ${feature}, started in this session, has no result and its folder is no ` +
      `longer under .oss/dev/active (feature_gone). ${phase} of ${feature} is marked unverified.`,
  );
}

/** A path problem met before the phase is known: the reason names the ledger, never a phase. */
function ledgerBlock(code: string): CheckOutcome {
  return {
    kind: 'block',
    reason:
      `OSS: the stop check could not read this repo's run ledger under ~/.oss/ledger (${code}): ` +
      'a linked, special or oversized file. Remove that file before stopping.',
    systemMessage: `OSS: run ledger refused (${code}): a linked, special or oversized file`,
  };
}

function toOutput(o: CheckOutcome): StopOutput | null {
  if (o.kind === 'allow') return null;
  return o.systemMessage === undefined
    ? { decision: 'block', reason: o.reason }
    : { decision: 'block', reason: o.reason, systemMessage: o.systemMessage };
}

/** " for the <phase> phase" for messages, or "" before a phase is known (never a made-up phase name). */
function forPhase(ctx: StopContext): string {
  return ctx.subject === null ? '' : ` for the ${ctx.subject.phase} phase`;
}

/** What to do about it, for messages: "" before a phase is known. */
function remedy(ctx: StopContext): string {
  const s = ctx.subject;
  return s === null ? '' : ` ${s.phase} is marked unverified and will not pass until you run oss-phase-result.sh assemble ${s.phase}.`;
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
          `OSS: the ${check} stop check failed again for the ${s.phase} phase in this session (${cls}). ` +
          `Run ~/.oss/hooks/oss-phase-result.sh assemble ${s.phase} before stopping.`,
        systemMessage: `OSS: ${check} failed twice for ${s.phase} (${cls}); the stop is blocked`,
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
    systemMessage: `OSS: the ${check} stop check could not run${forPhase(ctx)} (${cls}).${remedy(ctx)}`,
  };
}

function loopGuard(ctx: StopContext, check: string): StopOutput {
  recordUnverified(ctx, check, 'loop_guard');
  return {
    systemMessage: `OSS: stop allowed by the loop guard without a valid result${forPhase(ctx)} (${check}).${remedy(ctx)}`,
  };
}

/** A block goes out as is, except under stop_hook_active, where the loop guard turns it into an unverified allow. */
function blockOrGuard(ctx: StopContext, check: string, outcome: CheckOutcome): StopOutput | null {
  return ctx.input.stopHookActive ? loopGuard(ctx, check) : toOutput(outcome);
}

/** The checks for one subject; null allows. */
async function checkSubject(subject: StopSubject, input: StopInput, opts: DispatchOptions): Promise<StopOutput | null> {
  const checks = opts.checks ?? CHECKS;
  const budget = opts.checkBudgetMs ?? DEFAULT_BUDGET_MS;
  const ctx: StopContext = { input, subject, phaseResultCli: opts.phaseResultCli };
  try {
    if (!subject.bound) {
      subject.ledger.writeMarker(`pending/${subject.feature}/${subject.phase}`, { check: 'stop-dispatch', at: new Date().toISOString() });
    }
  } catch (e) {
    if (!isPathProblem(e)) return failOpen(ctx, 'stop-dispatch', errorClass(e));
    return blockOrGuard(ctx, 'stop-dispatch', blockFor(subject.phase, pathCode(e), true));
  }
  for (const check of checks) {
    const t0 = Date.now();
    let outcome: CheckOutcome;
    try {
      outcome = check.run(ctx);
    } catch (e) {
      if (!isPathProblem(e)) return failOpen(ctx, check.id, errorClass(e));
      outcome = blockFor(subject.phase, pathCode(e), true);
    }
    if (Date.now() - t0 > budget) return failOpen(ctx, check.id, 'timeout');
    if (outcome.kind === 'block') return blockOrGuard(ctx, check.id, outcome);
  }
  return null;
}

/** Every subject of one repo (round 3, finding 1): the first block wins; allow notes are joined. null allows. */
async function dispatchRepo(repo: string, input: StopInput, opts: DispatchOptions): Promise<StopOutput | null> {
  let resolved: { ledger: Ledger; items: Item[] };
  try {
    resolved = resolveItems(repo, input.sessionId);
  } catch (e) {
    const ctx: StopContext = { input, subject: null, phaseResultCli: opts.phaseResultCli };
    if (!isPathProblem(e)) return failOpen(ctx, 'stop-dispatch', errorClass(e));
    return blockOrGuard(ctx, 'stop-dispatch', ledgerBlock(pathCode(e)));
  }
  const notes: string[] = [];
  for (const item of resolved.items) {
    let note: string | null | undefined;
    if (item.kind === 'unfiled') note = unfiled(resolved.ledger, item.phase, item.startedAt, input.sessionId);
    else if (item.kind === 'gone') note = gone(resolved.ledger, item.feature, item.phase, item.startedAt, input.sessionId);
    else {
      const out = await checkSubject(item.subject, input, opts);
      if (out?.decision === 'block') return out;
      note = out?.systemMessage;
    }
    if (typeof note === 'string') notes.push(note);
  }
  return notes.length === 0 ? null : { systemMessage: notes.join(' ') };
}

export async function dispatch(input: StopInput, opts: DispatchOptions): Promise<StopOutput | null> {
  const repos: string[] = [];
  for (const dir of [input.cwd, input.projectDir]) {
    const repo = dir === undefined || dir === '' ? null : resolveRepo(dir);
    if (repo !== null && !repos.includes(repo)) repos.push(repo);
  }
  let first: StopOutput | null = null;
  for (const repo of repos) {
    const out = await dispatchRepo(repo, input, opts);
    if (out?.decision === 'block') return out;
    first ??= out;
  }
  return first;
}
