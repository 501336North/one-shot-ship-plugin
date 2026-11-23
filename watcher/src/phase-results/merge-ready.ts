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

/** D83 info c: one budget for all of mergedReady's git calls, inside the 15 s oss-notify gives `check` at complete. */
const MERGED_BUDGET_MS = 10_000;

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

/** The archived copy of the result: exactly one `.oss/dev/completed/<feature>-<date>/results/ship.json`, its bytes. */
function archivedResult(repo: string, feature: string): Buffer | null {
  const done = path.join(repo, '.oss', 'dev', 'completed');
  let names: string[];
  try {
    names = fs.readdirSync(done).filter((n) => n.startsWith(`${feature}-`) && DATE_DIR.test(n.slice(feature.length + 1)));
  } catch {
    return null;
  }
  if (names.length !== 1) return null;
  const file = path.join(done, names[0] as string, 'results', 'ship.json');
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

/**
 * `complete` after `merged` (D78): the ready row stands in for the archived result when the row is this ship run's
 * (same startedAt, recorded at or after it) and still names the bound result (D83 security low: the last
 * `results/<feature>/ship` row's sha256), the feature folder is archived (no active folder; one completed copy whose
 * bytes hash to the row's sha256), and the head the merge gate tested (its `merge/tested` row for this run, D83 code
 * review M1) is covered by the row under the merge gate's rule. Then either HEAD is main, with that tested main an
 * ancestor of HEAD and not HEAD itself; or (D83 pen M1: main checked out in another worktree, so served item 6 could
 * not switch) HEAD is another branch whose tip the row covers, with the tested main a strict ancestor of origin/main.
 * Every git call shares one deadline (D83 info c). Returns the archived result, or null.
 */
export function mergedReady(repo: string, ledger: Ledger, runStartedAt: string): Record<string, unknown> | null {
  const deadline = Date.now() + MERGED_BUDGET_MS;
  const row = readyRow(ledger);
  if (row === null || row.startedAt !== runStartedAt) return null;
  const at = Date.parse(row.at);
  const started = Date.parse(runStartedAt);
  if (Number.isNaN(at) || Number.isNaN(started) || at < started) return null;
  if (ledger.lastRow(`results/${row.feature}/ship`)?.sha256 !== row.sha256) return null;
  if (fs.lstatSync(path.join(repo, '.oss', 'dev', 'active', row.feature), { throwIfNoEntry: false }) !== undefined) return null;
  const bytes = archivedResult(repo, row.feature);
  if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
  const tested = testedRow(ledger, runStartedAt);
  if (tested === null || !onlyOssAfter(repo, row.headSha, tested.head, deadline)) return null;
  const ancestor = (a: string, b: string): boolean => git(repo, ['merge-base', '--is-ancestor', '--end-of-options', a, b], deadline).status === 0;
  const ref = git(repo, ['symbolic-ref', '-q', 'HEAD'], deadline).out.trim();
  const now = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}'], deadline).out.trim();
  if (ref === 'refs/heads/main') {
    if (now === tested.main || !ancestor(tested.main, 'HEAD')) return null;
  } else {
    const origin = git(repo, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/origin/main^{commit}'], deadline).out.trim();
    if (!ref.startsWith('refs/heads/') || !onlyOssAfter(repo, row.headSha, now, deadline)) return null;
    if (!SHA.test(origin) || origin === tested.main || !ancestor(tested.main, origin)) return null;
  }
  try {
    const v: unknown = JSON.parse(bytes.toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
