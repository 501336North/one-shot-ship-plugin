/**
 * D78 (user pick 2026-11-23, "Pre-merge check row"): the ledger row that says a ship result was ready_to_merge for one
 * head, written by `check ship --record-ready` (wrapper Step 8, before a merge), and the two readers that need it:
 * hooks/oss-merge-test.sh (in bash, the same rules) and `check ship` after `merged`, once the feature folder is
 * archived and HEAD is main.
 *
 * Row (`merge/ready` in the run's ledger, one JSON line): {feature, headSha, sha256, startedAt, at}. `sha256` is the
 * hash of the result bytes the ledger bound (`results/<feature>/ship`), so the row chains to that bound result and
 * to the archived copy of it; `startedAt` is the ship run's (run/ship); `at` is when it was recorded.
 *
 * A row covers a later head only when every commit after the row's head (merges against each parent) changes paths
 * under `.oss/` alone: the served merge step adds only the archive commit and the build report.
 *
 * D83: the merge gate, once its tests pass, appends `merge/tested` ({startedAt, head, main, at}: the run, the head it
 * tested and GitHub's main then), which `complete` reads instead of the run folder that served Step 10 deletes. A
 * refused `--record-ready` appends a revoking `merge/ready` row ({revoked, at}, no head), which both readers refuse.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitBin } from './git-bin.js';
import { gitEnv } from './git.js';
import type { Ledger } from './ledger.js';

export const READY_ROW = 'merge/ready';
export const TESTED_ROW = 'merge/tested';
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const FEATURE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;

export interface ReadyRow {
  feature: string;
  headSha: string;
  sha256: string;
  startedAt: string;
  at: string;
}

/**
 * D83 info c + D85 info e: one budget for all of mergedReady's git and gh calls; the CLI starts it in main(), so the
 * check before mergedReady spends from it too. D88: 9 s, inside the 10 s watchdog oss-phase-result.sh gives `check`, so
 * the CLI's own refusal arrives before that watchdog fires.
 */
export const MERGED_BUDGET_MS = 9_000;

/** git with what is left of `deadline` (ms since the epoch) as its time limit; status null once it has passed. */
function git(repo: string, args: string[], deadline = Date.now() + MERGED_BUDGET_MS): { status: number | null; out: string } {
  const bin = gitBin();
  const left = deadline - Date.now();
  if (bin === '' || left <= 0) return { status: null, out: '' };
  const r = spawnSync(bin, ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env: { ...gitEnv(), GIT_CONFIG_NOSYSTEM: '1', PATH: '/usr/bin:/bin' },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: left,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.error === undefined ? r.status : null, out: r.stdout ?? '' };
}

/** The row, or null when it is missing or any field has the wrong shape. */
export function readyRow(ledger: Ledger): ReadyRow | null {
  const r = ledger.lastRow(READY_ROW);
  if (r === null) return null;
  const { feature, headSha, sha256, startedAt, at } = r;
  if (typeof feature !== 'string' || !FEATURE_RE.test(feature)) return null;
  if (typeof headSha !== 'string' || !SHA.test(headSha) || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof startedAt !== 'string' || typeof at !== 'string') return null;
  return { feature, headSha, sha256, startedAt, at };
}

/**
 * True when `to` is `from`, or descends from it and every commit in `from..to` (each merge against every parent)
 * changes only paths under `.oss/`. False on any git error. D83 (security finding 2, pen L2/L3): no signature lines in
 * the output and merges always diffed against each parent, whatever log.showSignature or log.diffMerges say.
 */
export function onlyOssAfter(repo: string, from: string, to: string, deadline?: number): boolean {
  if (!SHA.test(from) || !SHA.test(to)) return false;
  if (from === to) return true;
  if (git(repo, ['merge-base', '--is-ancestor', '--end-of-options', from, to], deadline).status !== 0) return false;
  const r = git(repo, ['log', '--no-renames', '--no-show-signature', '--diff-merges=separate', '--format=', '--name-only', '-z', '--end-of-options', `${from}..${to}`], deadline);
  if (r.status !== 0) return false;
  return r.out.split('\0').filter((p) => p !== '').every((p) => p.startsWith('.oss/'));
}

/** D83 (code review M1): the merge gate's `merge/tested` row for this run: the head it tested and GitHub's main then. */
function testedRow(ledger: Ledger, runStartedAt: string): { head: string; main: string } | null {
  const r = ledger.lastRow(TESTED_ROW);
  if (r === null || r.startedAt !== runStartedAt) return null;
  const { head, main } = r;
  return typeof head === 'string' && SHA.test(head) && typeof main === 'string' && SHA.test(main) ? { head, main } : null;
}

/**
 * The archived copy of the result: D85 (code review L1, pen L2) the bytes of the `.oss/dev/completed/<feature>-<date>/
 * results/ship.json` that hash to `sha256` (a feature archived before keeps its older folder); null when none does.
 */
function archivedResult(repo: string, feature: string, sha256: string): Buffer | null {
  const done = path.join(repo, '.oss', 'dev', 'completed');
  let names: string[];
  try {
    names = fs.readdirSync(done).filter((n) => n.startsWith(`${feature}-`) && DATE_DIR.test(n.slice(feature.length + 1))).sort();
  } catch {
    return null;
  }
  for (const folder of names) {
    const bytes = resultBytes(path.join(done, folder, 'results', 'ship.json'));
    if (bytes !== null && createHash('sha256').update(bytes).digest('hex') === sha256) return bytes;
  }
  return null;
}

/** A regular file's bytes (never through a link, at most MAX_RESULT_BYTES); null otherwise. */
function resultBytes(file: string): Buffer | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    return st.isFile() && st.size <= MAX_RESULT_BYTES ? fs.readFileSync(fd) : null;
  } finally {
    fs.closeSync(fd);
  }
}

/** The JSON object in `bytes`; null when it is not one. */
function parseObject(bytes: Buffer): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(bytes.toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `o[key]` when `o` is an object; undefined otherwise. */
function field(o: unknown, key: string): unknown {
  return typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[key] : undefined;
}

/**
 * D86: why `complete` refused the merged path. `no_proof`: refused before GitHub was asked (the rows, the archived
 * result or the tested head); `not_github`: origin is not one github.com repository; `gh_unavailable`: no gh, or gh not logged in; `gh_unreachable`:
 * gh failed, timed out or gave no list of pull requests; `not_merged`: GitHub shows no merged PR at the tested head.
 * D88: `gh_denied`: gh failed with HTTP 401, 403, 404 or 422 (no access to the repository or the pull request);
 * `timeout`: the budget ran out before gh was asked; `ready_stale`: the feature is archived but the ready row is another
 * run's or no longer names the bound result (record it again).
 */
export type MergedReady =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; reason: 'no_proof' | 'not_github' | 'gh_unavailable' | 'gh_unreachable' | 'gh_denied' | 'timeout' | 'ready_stale' | 'not_merged' };

const GH_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** origin's one github.com repository as `owner/name`, by the merge gate's rule (oss-merge-test.sh); null otherwise. */
function githubName(repo: string, deadline: number): string | null {
  const r = git(repo, ['config', '--get-all', 'remote.origin.url'], deadline);
  const urls = r.out.split('\n').filter((l) => l !== '');
  if (r.status !== 0 || urls.length !== 1) return null;
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(.+?)(?:\.git)?$/.exec(urls[0] as string);
  return m !== null && GH_NAME.test(m[1] as string) ? (m[1] as string) : null;
}

/**
 * D86: gh from the caller's PATH, which oss-phase-result.sh passes as OSS_GH_PATH (the CLI itself runs with
 * PATH=/usr/bin:/bin), keeping only absolute folders outside the repo, as the merge gate does (D10). null when none has gh.
 */
function ghBin(repo: string): { bin: string; dirs: string } | null {
  const top = fs.realpathSync(repo);
  const dirs = (process.env.OSS_GH_PATH ?? '').split(':').filter((d) => {
    if (!path.isAbsolute(d)) return false;
    try {
      const real = fs.realpathSync(d);
      return real !== top && !real.startsWith(`${top}/`);
    } catch {
      return false;
    }
  });
  for (const d of dirs) {
    const bin = path.join(d, 'gh');
    try {
      if (!fs.statSync(bin).isFile()) continue;
      fs.accessSync(bin, fs.constants.X_OK);
      return { bin, dirs: dirs.join(':') };
    } catch {
      /* not here: try the next folder */
    }
  }
  return null;
}

/**
 * D86 (owner pick "Ask GitHub"): one `gh api repos/<owner>/<name>/commits/<head>/pulls` call, with what is left of the
 * deadline, must list a pull request with a merged_at time whose head is `head` and whose base is `base`. gh exiting 4
 * means it is not logged in.
 */
function prMerged(repo: string, head: string, base: string, deadline: number): 'merged' | Exclude<MergedReady, { ok: true }>['reason'] {
  if (!/^[0-9a-f]{40}$/.test(head)) return 'no_proof';
  const name = githubName(repo, deadline);
  if (name === null) return Date.now() >= deadline ? 'timeout' : 'not_github';
  const gh = ghBin(repo);
  if (gh === null) return 'gh_unavailable';
  const left = deadline - Date.now();
  if (left <= 0) return 'gh_unreachable';
  const r = spawnSync(gh.bin, ['api', '--hostname', 'github.com', `repos/${name}/commits/${head}/pulls`], {
    cwd: '/',
    env: { ...process.env, PATH: gh.dirs, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
    encoding: 'utf-8',
    // D88: stderr is read into memory only, to tell an HTTP access error from a network failure; it is never logged.
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: left,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error === undefined && r.status === 4) return 'gh_unavailable';
  if (r.error === undefined && r.status !== 0 && /\bHTTP (401|403|404|422)\b/.test(r.stderr)) return 'gh_denied';
  if (r.error !== undefined || r.status !== 0) return 'gh_unreachable';
  let prs: unknown;
  try {
    prs = JSON.parse(r.stdout);
  } catch {
    return 'gh_unreachable';
  }
  if (!Array.isArray(prs)) return 'gh_unreachable';
  const merged = prs.some((p) => typeof field(p, 'merged_at') === 'string' && field(field(p, 'head'), 'sha') === head
    && field(field(p, 'base'), 'ref') === base);
  return merged ? 'merged' : 'not_merged';
}

/**
 * `complete` after `merged` (D78): the ready row stands in for the archived result when the row is this ship run's
 * (same startedAt, recorded at or after it) and still names the bound result (D83 security low: the last
 * `results/<feature>/ship` row's sha256), the feature folder is archived (no active folder; one completed copy whose
 * bytes hash to the row's sha256), and the head the merge gate tested (its `merge/tested` row for this run, D83 code
 * review M1) is covered by the row under the merge gate's rule. D86: then GitHub must show the pull request MERGED at
 * that tested head into the result's base (prMerged), on main and on the feature branch alike; no local git state
 * counts as the merge. Every git and gh call shares one deadline (D83 info c), which the CLI starts in main() (D85
 * info e). Returns the archived result, or why it refused.
 */
export function mergedReady(repo: string, ledger: Ledger, runStartedAt: string, deadline = Date.now() + MERGED_BUDGET_MS): MergedReady {
  const no: MergedReady = { ok: false, reason: 'no_proof' };
  const row = readyRow(ledger);
  if (row === null) return no;
  if (fs.lstatSync(path.join(repo, '.oss', 'dev', 'active', row.feature), { throwIfNoEntry: false }) !== undefined) return no;
  // D88 (pen medium): the feature is archived, so a row that no longer matches gets its own cause (record it again).
  const stale: MergedReady = { ok: false, reason: 'ready_stale' };
  if (row.startedAt !== runStartedAt) return stale;
  const at = Date.parse(row.at);
  const started = Date.parse(runStartedAt);
  if (Number.isNaN(at) || Number.isNaN(started) || at < started) return stale;
  if (ledger.lastRow(`results/${row.feature}/ship`)?.sha256 !== row.sha256) return stale;
  const bytes = archivedResult(repo, row.feature, row.sha256);
  const result = bytes === null ? null : parseObject(bytes);
  if (result === null) return no;
  const tested = testedRow(ledger, runStartedAt);
  if (tested === null) return no;
  if (!onlyOssAfter(repo, row.headSha, tested.head, deadline)) return Date.now() >= deadline ? { ok: false, reason: 'timeout' } : no;
  const base = field(result.diff, 'baseRef');
  if (typeof base !== 'string') return no;
  const proof = prMerged(repo, tested.head, base, deadline);
  return proof === 'merged' ? { ok: true, result } : { ok: false, reason: proof };
}
