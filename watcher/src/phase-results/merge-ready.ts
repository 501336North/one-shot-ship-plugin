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
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gitBin } from './git-bin.js';
import { gitEnv } from './git.js';
import type { Ledger } from './ledger.js';

export const READY_ROW = 'merge/ready';
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

function git(repo: string, args: string[]): { status: number | null; out: string } {
  const bin = gitBin();
  if (bin === '') return { status: null, out: '' };
  const r = spawnSync(bin, ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env: { ...gitEnv(), GIT_CONFIG_NOSYSTEM: '1', PATH: '/usr/bin:/bin' },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
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
 * changes only paths under `.oss/`. False on any git error.
 */
export function onlyOssAfter(repo: string, from: string, to: string): boolean {
  if (!SHA.test(from) || !SHA.test(to)) return false;
  if (from === to) return true;
  if (git(repo, ['merge-base', '--is-ancestor', '--end-of-options', from, to]).status !== 0) return false;
  const r = git(repo, ['log', '--no-renames', '-m', '--format=', '--name-only', '-z', '--end-of-options', `${from}..${to}`]);
  if (r.status !== 0) return false;
  return r.out.split('\0').filter((p) => p !== '').every((p) => p.startsWith('.oss/'));
}

/** `<run folder>/<name>`'s one line, for the served merge step's folder (key: the git dir alone, D6); null when unsafe. */
function mergeRunValue(repo: string, name: string): string | null {
  const gitDir = git(repo, ['rev-parse', '--absolute-git-dir']).out.replace(/\n$/, '');
  if (gitDir === '') return null;
  const content = Buffer.from(`${gitDir}\n`, 'utf8');
  const key = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex').slice(0, 16);
  const file = path.join(os.homedir(), '.oss', 'run', key, name);
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (st === undefined || !st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid?.() || st.size > 1024) return null;
  return fs.readFileSync(file, 'utf8').replace(/\n$/, '');
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
 * `complete` after `merged` (D78): the ready row stands in for the archived result when HEAD is main, the row is this
 * ship run's (same startedAt, recorded at or after it), the feature folder is archived (no active folder; one
 * completed copy whose bytes hash to the row's sha256), and the merged PR head (the served merge step's head.txt, the
 * head tested.txt `v2 <head> <main>` names) is covered by the row under the merge gate's rule, with that tested main
 * an ancestor of HEAD and not HEAD itself. Returns the archived result, or null.
 */
export function mergedReady(repo: string, ledger: Ledger, runStartedAt: string): Record<string, unknown> | null {
  if (git(repo, ['symbolic-ref', '-q', 'HEAD']).out.trim() !== 'refs/heads/main') return null;
  const row = readyRow(ledger);
  if (row === null || row.startedAt !== runStartedAt) return null;
  const at = Date.parse(row.at);
  const started = Date.parse(runStartedAt);
  if (Number.isNaN(at) || Number.isNaN(started) || at < started) return null;
  if (fs.lstatSync(path.join(repo, '.oss', 'dev', 'active', row.feature), { throwIfNoEntry: false }) !== undefined) return null;
  const bytes = archivedResult(repo, row.feature);
  if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
  const head = mergeRunValue(repo, 'head.txt');
  const tested = /^v2 ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/.exec(mergeRunValue(repo, 'tested.txt') ?? '');
  if (head === null || tested === null || tested[1] !== head || !onlyOssAfter(repo, row.headSha, head)) return null;
  const main = tested[2] as string;
  const now = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}']).out.trim();
  if (now === main || git(repo, ['merge-base', '--is-ancestor', '--end-of-options', main, 'HEAD']).status !== 0) return null;
  try {
    const v: unknown = JSON.parse(bytes.toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
