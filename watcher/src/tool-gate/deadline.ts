/**
 * The gate's per-call deadline (fix round 4, K8). The CLI ends a decision still running at its
 * hard limit, and a call whose decision is ended is allowed unchecked (ADR-005). So every loop an
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
  ticks: number;
}

const current = new AsyncLocalStorage<Deadline>();

/**
 * Steps between looks at the clock: a look costs more than a step, and 256 steps take well under a
 * millisecond, so a slow step (a long word joined or split) can't carry the call far past its deadline
 * between looks (fix part K12).
 */
const CHECK_EVERY = 256;

/** Runs `run` (one decision) with a deadline `ms` after now, by `now`. */
export function withDeadline<T>(ms: number, now: () => number, run: () => T): T {
  return current.run({ at: now() + ms, now, ticks: 0 }, run);
}

/** One step of work; past the call's deadline, OverBudget. */
export function tick(): void {
  const deadline = current.getStore();
  if (deadline !== undefined && ++deadline.ticks % CHECK_EVERY === 0 && deadline.now() > deadline.at) {
    throw new OverBudget('checking it took too long');
  }
}
