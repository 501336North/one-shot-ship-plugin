/**
 * The gate's per-call deadline (fix round 4, K8). The CLI ends a decision still running at its
 * hard limit, and a call whose decision is ended is refused as too complex to check in time (round 9,
 * D-R9-4; before, a builder's or the main agent's was allowed unchecked). So every loop an
 * input can make long (the tokenizer, the command reader, the pattern matchers, the path resolver,
 * the folder search) calls `tick()` as it goes; once the call's deadline has passed, `tick()`
 * throws OverBudget and the call is refused as too complex, well before the hard limit.
 *
 * The deadline belongs to the call that set it (async context), so work outside a decision (the
 * recorder) has none, and calls decided side by side in one process don't share one.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { OverBudget } from './budget.js';

interface Deadline {
  at: number;
  now: () => number;
}

const current = new AsyncLocalStorage<Deadline>();

/**
 * The answer (stderr, exit 2) to any call whose decision ran past its time: the gate's own timer, the
 * CLI's hard limit, or the hook's deadline (round 9, D-R9-4). hooks/oss-tool-gate.sh holds the same text.
 */
export const TIMED_OUT_REFUSAL = 'Refused by the tool gate: this command is too complex to check in time; split it into simpler commands.\n';

/**
 * Steps between looks at the clock: a look costs more than a step, and 256 steps take well under a
 * millisecond, so a slow step (a long word joined or split) can't carry the call far past its deadline
 * between looks (fix part K12).
 */
const CHECK_EVERY = 256;

/** Runs `run` (one decision) with a deadline `ms` after now, by `now`. */
export function withDeadline<T>(ms: number, now: () => number, run: () => T): T {
  return current.run({ at: now() + ms, now }, run);
}

/** Steps taken in this process; the call's deadline is looked up only every CHECK_EVERY (round 10, PERF INFO-1). */
let steps = 0;

/** One step of work; past the call's deadline, OverBudget. */
export function tick(): void {
  if (++steps % CHECK_EVERY !== 0) return;
  const deadline = current.getStore();
  if (deadline !== undefined && deadline.now() > deadline.at) {
    throw new OverBudget('checking it took too long');
  }
}

/**
 * How long a program the gate starts and waits for (spawnSync's `timeout`) may take: `capMs`, or the
 * time left in the call when that is shorter; at least 1 ms, since 0 means no limit (round 9, PERF LOW-1).
 */
export function timeLeft(capMs: number): number {
  const deadline = current.getStore();
  if (deadline === undefined) return capMs;
  return Math.max(1, Math.min(capMs, Math.floor(deadline.at - deadline.now())));
}
