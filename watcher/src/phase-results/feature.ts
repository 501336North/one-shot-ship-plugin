/**
 * Feature resolution for phase results (R-257): which active feature folder a repo's phase belongs to.
 * Shared by the phase-result CLI (T9) and the Stop dispatcher (T11). Mirrors oss_resolve_feature (hooks/oss-safe-path.sh).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
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

const COMPLETED_RE = /^\.oss\/dev\/completed\/([^/]+)\//;
const ARCHIVED_RE = /^([A-Za-z0-9_-][A-Za-z0-9._-]*)-(\d{4}-\d{2}-\d{2})$/;

/**
 * D84: after the archive commit a ship re-run for a code fix still finds its feature. With no active folder, the
 * feature is the single `.oss/dev/completed/<feature>-<date>/` folder that this branch's own diff (from its merge base
 * with `base`, the ship base as the CLI resolves it) added, when that folder is a real directory. None, more than one,
 * or any git failure: null (no_feature, as before). Never any other completed folder.
 */
export function archivedFeature(repo: string, base: string): { feature: string; folder: string } | null {
  const mb = gitOut(repo, ['merge-base', '--end-of-options', `refs/heads/${base}`, 'HEAD']);
  if (mb === null || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(mb)) return null;
  const out = gitOut(repo, ['diff', '--name-only', '--no-renames', '--diff-filter=A', '-z', mb, 'HEAD', '--', '.oss/dev/completed/']);
  if (out === null) return null;
  const folders = new Set(out.split('\0').map((p) => COMPLETED_RE.exec(p)?.[1]).filter((n): n is string => n !== undefined));
  if (folders.size !== 1) return null;
  const folder = [...folders][0] as string;
  const m = ARCHIVED_RE.exec(folder);
  const st = fs.lstatSync(path.join(repo, '.oss', 'dev', 'completed', folder), { throwIfNoEntry: false });
  return m !== null && st?.isDirectory() === true ? { feature: m[1] as string, folder } : null;
}
