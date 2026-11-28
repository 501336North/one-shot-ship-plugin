/**
 * Feature resolution for phase results (R-257): which active feature folder a repo's phase belongs to.
 * Shared by the phase-result CLI (T9) and the Stop dispatcher (T11). Mirrors oss_resolve_feature (hooks/oss-safe-path.sh).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { branchAddedPaths } from './assemble-ship.js';
import { gitBin } from './git-bin.js';
import { gitEnv, gitOut } from './git.js';

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
  const folders = [...new Set(added.paths.map((p) => COMPLETED_RE.exec(p)?.[1]))]
    .filter((n): n is string => n !== undefined && ARCHIVED_RE.exec(n)?.[1] === named);
  if (folders.length > 1) return { ok: false, reason: 'several' };
  const folder = folders[0];
  if (folder === undefined) return { ok: false, reason: ignoredArchive(repo) ? 'ignored' : 'none' };
  const st = fs.lstatSync(path.join(repo, '.oss', 'dev', 'completed', folder), { throwIfNoEntry: false });
  if (st?.isDirectory() !== true) return { ok: false, reason: 'none' };
  const isNew = archiveIsNew(repo, folder, base, deadline, added.mergeBase);
  if (isNew !== 'yes') return { ok: false, reason: isNew === 'timeout' ? 'timeout' : 'none' };
  return { ok: true, feature: named, folder };
}

/**
 * complete-gaps D10 (ii), pen P5 + ship rounds 2 and 4 (R2-1..R2-4, R4-1..R4-5): 'yes' only when `folder` is new on this
 * branch: absent, compared ASCII-case-insensitively (R4-1: a case-insensitive disk folds a case-different name onto the
 * old folder), from the tree of every merge base of HEAD with: the remote's main (refs/remotes/origin/main, else the
 * remote HEAD only when it is a symbolic ref to a live refs/remotes/origin/* ref: R4-4), `base` (refs/heads/<base>, the
 * lookup base), each refs/remotes/<remote>/<base> (R4-2), and `measuredFrom`, the merge base the added paths were
 * measured from (R4-2). With no remote at all (a purely local repo) the remote's main is replaced by refs/heads/main,
 * else refs/heads/master; with neither it refuses (R4-3). The folder's on-disk name must also equal `folder` exactly
 * (R4-1). Not origin/main's own tree: after GitHub's squash merge it holds this branch's archive, and complete must
 * still find it (phase-results.acceptance 13f10). So an old, merged archive is never this branch's, even when the
 * branch commits a new file into it or a model-chosen base reaches it. Fails closed: a remote configured with neither
 * ref, any git error or a time-out refuses ('timeout' when `deadline` ran out or a call timed out). No `git log` (it
 * could run gpg.program through log.showSignature); `ls-tree` tells "absent" (exit 0, no output) from an error. A
 * partial clone never fetches a missing object (GIT_NO_LAZY_FETCH, R4-5): it is a git error, so it refuses.
 * Known limits: a stale or forged local origin/main (never fetched) is trusted as it is; a real merge commit (not a
 * squash) of this branch refuses after the merge; an only remote not named origin refuses; a deliberately
 * case-renamed or copied archive is the same as forging the results.
 */
export function archiveIsNew(
  repo: string, folder: string, base: string, deadline = Infinity, measuredFrom?: string,
): 'yes' | 'no' | 'timeout' {
  const run = (args: string[], okCodes = [0]): string => {
    const left = Math.min(2000, deadline - Date.now());
    if (left <= 0) throw new Error('timeout');
    const env = { ...gitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_NO_LAZY_FETCH: '1', PATH: '/usr/bin:/bin' };
    const r = spawnSync(gitBin(), ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', '--literal-pathspecs', ...args], {
      cwd: repo, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: left,
    });
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') throw new Error('timeout');
    if (r.error !== undefined || r.status === null || !okCodes.includes(r.status)) throw new Error('git');
    return r.stdout.trim();
  };
  const resolve = (ref: string): string => run(['rev-parse', '--verify', '-q', `${ref}^{commit}`], [0, 1]);
  try {
    if (!fs.readdirSync(path.join(repo, '.oss', 'dev', 'completed')).includes(folder)) return 'no';
    const head = run(['rev-parse', '--verify', 'HEAD^{commit}']);
    let main = resolve('refs/remotes/origin/main');
    if (main === '') {
      const target = run(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], [0, 1]);
      if (target.startsWith('refs/remotes/origin/') && target !== 'refs/remotes/origin/HEAD') main = resolve(target);
    }
    if (main === '' && run(['remote']) !== '') return 'no';
    if (main === '') main = resolve('refs/heads/main') || resolve('refs/heads/master');
    if (main === '') return 'no';
    const ends = [main, `refs/heads/${base}`];
    for (const line of run(['for-each-ref', '--format=%(refname)', `refs/remotes/*/${base}`]).split('\n')) {
      if (/^refs\/remotes\/[^/]+\/(.+)$/.exec(line)?.[1] === base) ends.push(line);
    }
    const points = new Set(ends.map((end) => run(['merge-base', head, end])));
    if (measuredFrom !== undefined) points.add(measuredFrom);
    const lower = folder.toLowerCase();
    for (const c of points) {
      const names = run(['ls-tree', '--full-tree', '--name-only', c, '--', '.oss/dev/completed/']).split('\n');
      if (names.some((n) => n.slice('.oss/dev/completed/'.length).toLowerCase() === lower)) return 'no';
    }
    return 'yes';
  } catch (e) {
    return (e as Error).message === 'timeout' ? 'timeout' : 'no';
  }
}

/**
 * D86 (pen low): true when git ignores `.oss/dev/completed`, so no branch diff can show an archive there. D88 (code L1,
 * pen I2): `-q` (exit 0 only when ignored, so a negated rule is not), the folder as a folder (trailing /, so a `dir/`
 * negation applies) and a child path too, so `.oss/dev/completed/*` counts.
 */
function ignoredArchive(repo: string): boolean {
  return ['.oss/dev/completed/', '.oss/dev/completed/x'].some((p) => spawnSync(gitBin(), ['check-ignore', '-q', '--', p], {
    cwd: repo,
    env: { ...gitEnv(), PATH: '/usr/bin:/bin' },
    stdio: 'ignore',
    timeout: 2000,
  }).status === 0);
}
