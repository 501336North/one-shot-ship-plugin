/**
 * Feature resolution for phase results (R-257): which active feature folder a repo's phase belongs to.
 * Shared by the phase-result CLI (T9) and the Stop dispatcher (T11). Mirrors oss_resolve_feature (hooks/oss-safe-path.sh).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { branchAddedPaths } from './assemble-ship.js';
import { gitOut } from './git.js';

const FEATURE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const BRANCH_RE = /^[^/]+\/([^/]+)\/[^/]/;

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

/** The current branch's short name; '' when HEAD is detached or git fails. */
function branchName(repo: string): string {
  const ref = gitOut(repo, ['symbolic-ref', '-q', 'HEAD']);
  return ref !== null && ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
}

/** Mirrors oss_resolve_feature (hooks/oss-safe-path.sh): the branch's feature with an active dir, else the single one. */
export function resolveFeature(repo: string): string | null {
  const m = BRANCH_RE.exec(branchName(repo));
  if (m !== null) {
    const f = m[1];
    const st = fs.lstatSync(path.join(repo, '.oss', 'dev', 'active', f), { throwIfNoEntry: false });
    return FEATURE_RE.test(f) && st?.isDirectory() ? f : null;
  }
  const active = activeFeatures(repo);
  return active.length === 1 ? active[0] : null;
}

const COMPLETED_RE = /^\.oss\/dev\/completed\/([^/]+)\//;
const ARCHIVED_RE = /^([A-Za-z0-9_-][A-Za-z0-9._-]*)-(\d{4}-\d{2}-\d{2})$/;

/**
 * D85 + D86: why archivedFeature found no feature: no folder (or another feature's), several of this feature's folders, git
 * ran past its time limit or the caller's deadline, the branch name names no feature (`unnamed`), or none showed because
 * `.oss/dev/completed` is git-ignored (`ignored`).
 */
export type ArchivedFeature =
  | { ok: true; feature: string; folder: string }
  | { ok: false; reason: 'none' | 'several' | 'timeout' | 'unnamed' | 'ignored' };

/**
 * D84 + D85 + D86: after the archive commit a ship re-run for a code fix still finds its feature. Only a branch whose name
 * names a feature (BRANCH_RE) gets this lookup. The feature is then the single `.oss/dev/completed/<feature>-<date>/`
 * folder of that feature that this branch added, from the same merge base assemble ship diffs from (`base` as the CLI
 * resolves it, moved past by the ship-start snapshot `remoteRefs` and live remote refs: a stale local base never counts
 * origin's archives as this branch's), when that folder is a real directory. Never any other completed folder. Every
 * git call of the diff spends from `deadline` (D86 info a).
 */
export function archivedFeature(repo: string, base: string, remoteRefs: ReadonlyMap<string, string>, deadline = Infinity): ArchivedFeature {
  const named = BRANCH_RE.exec(branchName(repo))?.[1];
  if (named === undefined) return { ok: false, reason: 'unnamed' };
  const added = branchAddedPaths(repo, base, remoteRefs, '.oss/dev/completed/', deadline);
  if (added === 'timeout') return { ok: false, reason: 'timeout' };
  if (added === null) return { ok: false, reason: 'none' };
  const folders = [...new Set(added.map((p) => COMPLETED_RE.exec(p)?.[1]))]
    .filter((n): n is string => n !== undefined && ARCHIVED_RE.exec(n)?.[1] === named);
  if (folders.length > 1) return { ok: false, reason: 'several' };
  const folder = folders[0];
  if (folder === undefined) return { ok: false, reason: ignoredArchive(repo) ? 'ignored' : 'none' };
  const st = fs.lstatSync(path.join(repo, '.oss', 'dev', 'completed', folder), { throwIfNoEntry: false });
  return st?.isDirectory() === true ? { ok: true, feature: named, folder } : { ok: false, reason: 'none' };
}

/** D86 (pen low): true when git ignores `.oss/dev/completed`, so no branch diff can show an archive there. */
function ignoredArchive(repo: string): boolean {
  return gitOut(repo, ['check-ignore', '-v', '--', '.oss/dev/completed']) !== null;
}
