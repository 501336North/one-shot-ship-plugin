/**
 * Feature resolution for phase results (R-257): which active feature folder a repo's phase belongs to.
 * Shared by the phase-result CLI (T9) and the Stop dispatcher (T11). Mirrors oss_resolve_feature (hooks/oss-safe-path.sh).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FEATURE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const BRANCH_RE = /^[^/]+\/([^/]+)\/[^/]/;

function gitOut(cwd: string, args: string[]): string | null {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  try {
    const out = execFileSync('git', args, { cwd, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/** Active feature folders (real dirs with a valid name). */
export function activeFeatures(repo: string): string[] {
  const dir = path.join(repo, '.oss', 'dev', 'active');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => FEATURE_RE.test(n) && fs.lstatSync(path.join(dir, n), { throwIfNoEntry: false })?.isDirectory())
    .sort();
}

/** Mirrors oss_resolve_feature (hooks/oss-safe-path.sh): the branch's feature with an active dir, else the single one. */
export function resolveFeature(repo: string): string | null {
  const ref = gitOut(repo, ['symbolic-ref', '-q', 'HEAD']);
  const branch = ref !== null && ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
  const m = BRANCH_RE.exec(branch);
  if (m !== null) {
    const f = m[1];
    const st = fs.lstatSync(path.join(repo, '.oss', 'dev', 'active', f), { throwIfNoEntry: false });
    return FEATURE_RE.test(f) && st?.isDirectory() ? f : null;
  }
  const active = activeFeatures(repo);
  return active.length === 1 ? active[0] : null;
}
