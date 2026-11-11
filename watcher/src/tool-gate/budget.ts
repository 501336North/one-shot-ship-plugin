/**
 * The gate's per-call work limits (fix round 4, K1). A decision slower than the gate's time limit
 * allows the call (ADR-005), so work an input can multiply (git runs, names looked up on disk) is
 * capped per call; past a cap the gate throws `OverBudget` and the call is refused as too complex
 * to check, never allowed.
 */

import type { GitReader } from './git-reader.js';

/** Thrown when a call needs more work than the gate allows; `what` says which limit, for the reason. */
export class OverBudget extends Error {
  constructor(readonly what: string) {
    super(what);
    this.name = 'OverBudget';
  }
}

export interface GitLimits {
  /** Most different git questions (folder + question) per call. */
  maxRuns: number;
  /** Most time, from the start of the call, that git may take in all. */
  timeMs: number;
}

/**
 * A git reader for one call: each question (the branch of a folder, a dry run with these words)
 * is asked once and remembered; a new question past `maxRuns`, or once `timeMs` has passed, is
 * refused with OverBudget. Each run gets only the time left, so git can't take the call past its
 * limit.
 */
export function budgetedGitReader(inner: GitReader, limits: GitLimits, now: () => number = () => performance.now()): GitReader {
  const deadline = now() + limits.timeMs;
  const asked = new Map<string, Promise<unknown>>();

  function ask<T>(key: string, run: (timeoutMs: number) => Promise<T>): Promise<T> {
    const known = asked.get(key);
    if (known !== undefined) return known as Promise<T>;
    const answer = (async () => {
      if (asked.size >= limits.maxRuns) throw new OverBudget(`more than ${limits.maxRuns} different git lookups`);
      const left = deadline - now();
      if (left <= 0) throw new OverBudget('git took too long to answer');
      const result = await run(left);
      if (now() >= deadline) throw new OverBudget('git took too long to answer');
      return result;
    })();
    asked.set(key, answer);
    return answer;
  }

  return {
    currentBranch: (dir) => ask(JSON.stringify(['branch', dir]), (timeoutMs) => inner.currentBranch(dir, timeoutMs)),
    wouldClean: (dir, options, pathspecs) =>
      ask(JSON.stringify(['clean', dir, options, pathspecs]), (timeoutMs) => inner.wouldClean(dir, options, pathspecs, timeoutMs)),
  };
}
