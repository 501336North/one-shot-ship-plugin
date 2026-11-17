/**
 * git for the review-run check (R-266): the fixed, checked git of git-bin.ts (never PATH's: security
 * CRITICAL-1), argv only, never a shell; the session's `GIT_*` variables are
 * dropped (they could pick another repo or index); user-level and system config, ignore and attributes
 * files are switched off, so nothing outside the repo can hide a file from the check; fsmonitor is off.
 * Every call gets what is left of the check's time budget as its timeout.
 */

import { execFileSync } from 'node:child_process';
import { gitBinary } from './git-bin.js';

/** The time the whole check may take: a wall-clock deadline (ms since the epoch). */
export interface Budget {
  deadline: number;
}

/** The check ran out of time. */
export class BudgetExceeded extends Error {
  constructor() {
    super('the check ran out of time');
    this.name = 'BudgetExceeded';
  }
}

/** The milliseconds left; throws BudgetExceeded when none are. */
export function remaining(budget: Budget): number {
  const ms = budget.deadline - Date.now();
  if (ms <= 0) throw new BudgetExceeded();
  return ms;
}

const ISOLATED_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const ISOLATED_ARGS = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.excludesFile=/dev/null',
  '-c',
  'core.attributesFile=/dev/null',
];

function gitEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith('GIT_')) env[name] = value;
  return { ...env, ...ISOLATED_ENV, ...extra };
}

export interface GitOptions {
  env?: Record<string, string>;
  input?: string;
  /** Extra `-c name=value` settings, applied after (so over) the isolating ones. */
  config?: Record<string, string>;
}

/** git's stdout, untrimmed. Throws on a non-zero exit, and BudgetExceeded when time ran out. */
export function git(cwd: string, args: string[], budget: Budget, opts: GitOptions = {}): string {
  const timeout = remaining(budget);
  try {
    const config = Object.entries(opts.config ?? {}).flatMap(([name, value]) => ['-c', `${name}=${value}`]);
    return execFileSync(gitBinary(), [...ISOLATED_ARGS, ...config, ...args], {
      cwd,
      env: gitEnv(opts.env ?? {}),
      encoding: 'utf8',
      input: opts.input,
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      timeout,
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT' || Date.now() >= budget.deadline) throw new BudgetExceeded();
    throw err;
  }
}

/** Like git(), but null for a non-zero exit (BudgetExceeded still throws). */
export function gitOrNull(cwd: string, args: string[], budget: Budget): string | null {
  try {
    return git(cwd, args, budget);
  } catch (err) {
    if (err instanceof BudgetExceeded) throw err;
    return null;
  }
}
