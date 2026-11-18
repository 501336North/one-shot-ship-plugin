/**
 * Git helpers shared by the phase result modules (R-257). Every git child gets the caller's env minus GIT_*, so a
 * planted GIT_DIR or GIT_WORK_TREE cannot point git at another repo. ledger.ts keeps its own copy (child processes
 * import that file directly, so it uses node builtins only), and so does store.ts (its dist output is committed for the
 * archive healthcheck, and this file's is not).
 */
import { execFileSync } from 'node:child_process';

/** process.env without any GIT_* variable. */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return env;
}

/** Trimmed stdout of `git <args>` in cwd; null when git fails or prints nothing. */
export function gitOut(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}
