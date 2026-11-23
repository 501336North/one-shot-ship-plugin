/**
 * Ship result assembler (R-257 T8, AC-003.4 to AC-003.7, card c; amended S2, S6, S9, P4).
 *
 * Diff: hardened git (fixed argv, no shell, GIT_* unset, GIT_CONFIG_NOSYSTEM=1, fsmonitor and hooks off, no external
 * diff or textconv, 10 s timeout). The base is a local branch only (never gh or fetch), checked with
 * `check-ref-format --branch` and passed after `--end-of-options`. Empty when the tree equals the base tip (covers a
 * squash-merged branch) or nothing changed since the merge-base. Totals come from `--shortstat` against the merge-base,
 * taken from the ship-start snapshot's same-name remote SHA when that is ahead of a stale local base (pen L2).
 * Gates: the feature's timeline gate lines of this run whose sha256 is in the ledger `gates/<feature>`, latest round only
 * (`source: model`). Every captured review-agent row of the feature (ledger `verdicts/<feature>`, verdict-capture.ts; D51:
 * no cutoff, pen F1/L7) then applies, per gate (`source: agent`; `fixed` stays from the line):
 * - D45 (replaces D32's, D36's and D43's pass-based clearing): captured PASS rows decide and clear nothing. Each
 *   captured FAIL row of a gate is open unless the shipped code (HEAD outside .oss) differs from the code that failed
 *   (its reviewed trees, else its headSha's tree; untracked scratch files and empty or .oss-only commits are no change).
 *   D51: the gate is open when any of its fail rows is, with the newest open row's findings, so a revert to code that
 *   already failed stays blocked. An open fail keeps its gate failed, and no fix count overrides it; its blocker reads
 *   `gate:<name> (captured fail, not re-reviewed: a tracked code change is needed to clear it)` (D57). A fail with
 *   neither trees nor headSha does not count (D48). D55: a fail whose trees git pruned is compared through its
 *   headSha's tree, and ignored when that commit is gone too (also for a headSha-only row). Rows are walked newest
 *   first and each reviewed state is compared once per assemble (perf low 1). D58: only the feature's own paths count
 *   (its diff from the merge base, plus the reviewed tree's changes against the review-time merge base), so upstream
 *   commits brought in by a rebase or merge never clear a fail (FailComparer). D67: a path upstream changed between the
 *   review-time base and the merge base never clears a fail, whatever it holds now; a row held open that way reads
 *   `gate:<name> (captured fail, not re-reviewed: upstream changed a file this feature changes; ...)` (D71).
 * - An open captured pen-test fail adds that optional gate. D26: the result labels how many gates an agent row backs
 *   (`gateEvidence`) and names the rest (`uncapturedGates`).
 * Overrides: each decisionId must be a decisions.ndjson record whose line hash, id and feature match a ledger row;
 * `person` is copied from that record, never from the model. D69 + D70: an entry naming a gate whose record is a ship
 * pick answered `Override <gate>` clears that gate's D67 rows captured before the pick was answered.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openLedger, LedgerError, type LedgerRow } from './ledger.js';
import { gitBin } from './git-bin.js';
import { gitEnv } from './git.js';
import {
  baseFields,
  parseJsonObject,
  parseJsonOr,
  readValue,
  redactModelText,
  sha256,
  type AssembleContext,
  type AssembleOutcome,
} from './assemble-common.js';

/**
 * The gates ship requires (AC-003.5): the timeline gate line names, i.e. the `gate.txt` values of the served ship.md
 * (code-reviewer -> code-review, performance-auditor -> performance, security-auditor -> security). The same set as
 * healthchecks/quality-gates.ts; pen-test stays optional (R-257 T27).
 */
export const DEFAULT_REQUIRED_GATES: readonly string[] = ['code-review', 'performance', 'security'];

export interface AssembleShipOptions {
  base: string;
  requiredGates?: readonly string[];
  /** Pen L2: the ship-start snapshot (remote ref name to SHA); a same-name SHA ahead of the local base moves the diff base. */
  remoteRefs?: ReadonlyMap<string, string>;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const REPO_FILE_CAP = 4 * 1024 * 1024;

class GitError extends Error {
  /**
   * Perf L1 (gate round 11): git's output overflowed the call's buffer (spawnSync's ENOBUFS). Perf F2 (gate round 12):
   * git ran past the call's time limit (ETIMEDOUT).
   */
  constructor(message: string, readonly overflow = false, readonly timedOut = false) {
    super(message);
  }
}

/**
 * `raw` keeps stdout as git printed it (for `-z` output, whose paths may end in spaces). git is the fixed-path binary
 * (gitBin, never PATH; pen N3) run with PATH=/usr/bin:/bin; with none, every call fails (closed).
 */
function runGit(
  repo: string,
  args: string[],
  okCodes: number[] = [0],
  raw = false,
  maxBuffer = 1024 * 1024,
  input?: string,
  timeout = 10_000,
): { status: number; out: string } {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.PATH = '/usr/bin:/bin';
  const git = gitBin();
  if (git === '') throw new GitError('no git');
  const r = spawnSync(git, ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env,
    encoding: 'utf-8',
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    input,
    timeout,
    maxBuffer,
  });
  if (r.error !== undefined || r.status === null || !okCodes.includes(r.status)) {
    const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
    throw new GitError(args[0], code === 'ENOBUFS', code === 'ETIMEDOUT');
  }
  return { status: r.status, out: raw ? r.stdout : r.stdout.trim() };
}

/**
 * D79 (gate round 13): a git call that ran past its time limit is never read as "no" (an older, wider base): it is
 * rethrown, so assembleShip refuses diff_unavailable with the timeout hint.
 */
function rethrowTimeout(e: unknown): void {
  if (e instanceof GitError && e.timedOut) throw e;
}

/** The diff_unavailable hint when the base is a valid branch name with no local branch (pen info 2: fixed text). */
export const NO_LOCAL_BASE = 'create the local branch from its remote (git branch <base> <remote>/<base>)';

/** True when `name` passes `check-ref-format --branch` (fixed argv, never an option). */
function validBranchName(repo: string, name: string): boolean {
  if (name === '' || name.startsWith('-')) return false;
  try {
    runGit(repo, ['check-ref-format', '--branch', name]);
    return true;
  } catch {
    return false;
  }
}

/** True when `name` passes `check-ref-format --branch` and `refs/heads/<name>` exists (fixed argv, never an option). */
export function isLocalBranch(repo: string, name: string): boolean {
  if (!validBranchName(repo, name)) return false;
  try {
    runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${name}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** The commit `refs/heads/<name>` points at (call after isLocalBranch accepted the name); null when git fails. */
export function branchTip(repo: string, name: string): string | null {
  try {
    return runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${name}^{commit}`]).out;
  } catch {
    return null;
  }
}

/**
 * D40: true when commit `tip` is an ancestor of, or equal to, `sha` (a hex id from the origin snapshot ship start
 * recorded): `rev-list` lists `tip` unless `sha` reaches it. False on any error (a sha missing from the repo included).
 */
function containedIn(repo: string, tip: string, sha: string): boolean {
  try {
    return runGit(repo, ['rev-list', '-n', '1', '--end-of-options', tip, `^${sha}`]).out === '';
  } catch (e) {
    rethrowTimeout(e);
    return false;
  }
}

/**
 * Why shipBaseCheck refused a base: `not_in_snapshot` when only the snapshot containment failed; `timeout` when a git call
 * ran past its time limit (D83 info a: a slow repo, reported as diff_unavailable with the git gc hint).
 */
export type ShipBaseCheck = 'ok' | 'refused' | 'not_in_snapshot' | 'timeout';

/**
 * Security info 2 (gate round 7) + security info 4 (gate round 8): true when `refs`, `refs/heads` or `packed-refs`
 * under the git common dir, or `refs/heads/<base>` or a folder on the way to it, is a filesystem symlink (lstat), which
 * `symbolic-ref` does not see. The ref format and common dir come from one rev-parse call. A reftable repo keeps no
 * loose ref files, so only the store links are checked; ENOTDIR counts as no file (security low, gate round 8). Any
 * other error counts as a link (fail closed).
 */
function refPathLinked(repo: string, base: string): boolean {
  try {
    const [format, ...dir] = runGit(repo, ['rev-parse', '--show-ref-format', '--git-common-dir'], [0], true).out.replace(/\n$/, '').split('\n');
    const common = path.resolve(repo, dir.join('\n'));
    const linked = (p: string): boolean | undefined => {
      try {
        return fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined;
        throw e;
      }
    };
    if (['refs', 'refs/heads', 'packed-refs'].some((p) => linked(path.join(common, p)) === true)) return true;
    if (format === 'reftable') return false;
    let p = path.join(common, 'refs', 'heads');
    for (const seg of base.split('/')) {
      p = path.join(p, seg);
      const st = linked(p);
      if (st === undefined) return false;
      if (st) return true;
    }
    return false;
  } catch (e) {
    rethrowTimeout(e);
    return true;
  }
}

/**
 * D46/D50 (pen M2a, security 2a): local branch `base` is a safe ship base only when `refs` (the ship-start snapshot,
 * remote ref name to SHA) holds refs/remotes/<remote>/<base> for some one-segment remote name and the base tip is inside
 * that ref's SHA, and the base is neither the current branch nor the feature's own branch or one of its phase branches
 * (`<feature>`, `*\/<feature>/*`), nor a symbolic ref or a symlinked ref file. A remote whose name has a slash never
 * matches (fail closed), so `build` never matches origin/feat/<f>/build. `not_in_snapshot` when only the containment
 * failed (pen low 4: a base pulled mid-ship or diverged), so the refusal can say what to do.
 */
export function shipBaseCheck(repo: string, base: string, feature: string, refs: ReadonlyMap<string, string>): ShipBaseCheck {
  try {
    return checkBase(repo, base, feature, refs);
  } catch (e) {
    if (e instanceof GitError && e.timedOut) return 'timeout';
    throw e;
  }
}

function checkBase(repo: string, base: string, feature: string, refs: ReadonlyMap<string, string>): ShipBaseCheck {
  if (base === feature || base.includes(`/${feature}/`)) return 'refused';
  let current: string | null;
  try {
    current = runGit(repo, ['symbolic-ref', '-q', 'HEAD'], [0, 1]).out;
  } catch (e) {
    rethrowTimeout(e);
    return 'refused';
  }
  if (current === `refs/heads/${base}`) return 'refused';
  // Security info 4: a local base that is a symbolic ref (refs/heads/x -> another branch) is refused.
  try {
    if (runGit(repo, ['symbolic-ref', '-q', `refs/heads/${base}`], [0, 1]).status === 0) return 'refused';
  } catch (e) {
    rethrowTimeout(e);
    return 'refused';
  }
  if (refPathLinked(repo, base)) return 'refused';
  const tip = branchTip(repo, base);
  if (tip === null) return 'refused';
  for (const [name, sha] of refs) {
    const m = /^refs\/remotes\/[^/]+\/(.+)$/.exec(name);
    if (m?.[1] === base && containedIn(repo, tip, sha)) return 'ok';
  }
  return 'not_in_snapshot';
}

/** shipBaseCheck accepted the base. */
export function shipBaseAllowed(repo: string, base: string, feature: string, refs: ReadonlyMap<string, string>): boolean {
  return shipBaseCheck(repo, base, feature, refs) === 'ok';
}

interface Diff {
  base: string;
  /** The commit the merge-base was taken from (diffFrom): the local tip or a snapshot SHA. */
  from: string;
  baseRef: string;
  files: number;
  insertions: number;
  deletions: number;
  headSha: string;
  empty: boolean;
}

/** The one commit of `shas` that contains all the others (`merge-base --independent`, perf info 1); null when none does. */
function mostAdvanced(repo: string, shas: string[]): string | null {
  if (shas.length === 1) return shas[0] as string;
  try {
    const top = runGit(repo, ['merge-base', '--independent', '--end-of-options', ...shas]).out.split('\n');
    return top.length === 1 && shas.includes(top[0] as string) ? (top[0] as string) : null;
  } catch (e) {
    rethrowTimeout(e);
    return null;
  }
}

/**
 * Pen L2 + pen L1 (gate round 7): a stale local base (a teammate pushed since it was last pulled) must not count their
 * commits as the feature's. The candidates are the snapshot SHAs of same-name remote refs (`refs/remotes/<remote>/
 * <branch>`) that contain the local tip and do not already contain HEAD. The diff starts from the most advanced one
 * (it contains all the others); when none does (diverged remotes), from the one whose merge-base with HEAD every other
 * one's merge-base is an ancestor of (topology, never commit time: pen info 1); with none, the local tip.
 * D61 + D64: then from the most advanced merge base of a live `refs/remotes/<remote>/<branch>` with HEAD that contains
 * that choice (a mid-run rebase onto, or merge of, an updated remote while local main is stale). It only narrows.
 */
function diffFrom(repo: string, branch: string, tip: string, head: string, remoteRefs: ReadonlyMap<string, string>): string {
  const same = [...remoteRefs.keys()].sort()
    .filter((name) => /^refs\/remotes\/[^/]+\/(.+)$/.exec(name)?.[1] === branch)
    .map((name) => remoteRefs.get(name) as string);
  const candidates = [...new Set(same)].filter((sha) => sha !== tip && containedIn(repo, tip, sha) && !containedIn(repo, head, sha));
  const from = candidates.length === 0 ? tip : mostAdvanced(repo, candidates) ?? topologicalBest(repo, candidates, head);
  return liveBase(repo, branch, from, head);
}

/** Pen info 1: the diverged candidate whose merge-base with HEAD is the newest by ancestry; the first one on a tie. */
function topologicalBest(repo: string, candidates: string[], head: string): string {
  let best: { sha: string; mb: string } | null = null;
  for (const c of candidates) {
    try {
      const mb = runGit(repo, ['merge-base', '--end-of-options', c, head]).out;
      if (best === null || (mb !== best.mb && runGit(repo, ['merge-base', '--is-ancestor', '--end-of-options', best.mb, mb], [0, 1]).status === 0)) {
        best = { sha: c, mb };
      }
    } catch (e) {
      rethrowTimeout(e);
      // a candidate git cannot compare is skipped
    }
  }
  return best?.sha ?? (candidates[0] as string);
}

/**
 * D61 + D64: for each live one-segment `refs/remotes/<remote>/<branch>` (symrefs dropped) that contains `from` (one
 * `for-each-ref --contains`), merge-base(ref, HEAD) when that contains `from`; the most advanced such point, else
 * `from`. HEAD need not contain the ref, so a fetch after a rebase keeps the base, and diverged remotes are handled.
 * It only narrows the feature's paths.
 */
function liveBase(repo: string, branch: string, from: string, head: string): string {
  const points = new Set<string>();
  // Code-review L3 + perf I1 (gate round 10): only `<remote>/<branch>` refs are listed (a branch name has no glob
  // characters), and refs at one commit share one merge-base.
  const out = runGit(repo, ['for-each-ref', `--contains=${from}`, '--format=%(refname)%00%(objectname)%00%(symref)', `refs/remotes/*/${branch}`], [0], true, PATH_LIST_BUFFER).out;
  const tips = new Set<string>();
  for (const line of out.split('\n')) {
    const [name, sha, symref] = line.split('\0');
    if (symref !== '' || sha === undefined || !TREE_RE.test(sha) || sha === from) continue;
    if (/^refs\/remotes\/[^/]+\/(.+)$/.exec(name as string)?.[1] !== branch) continue;
    tips.add(sha);
  }
  for (const sha of tips) {
    const mb = runGit(repo, ['merge-base', '--end-of-options', sha, head], [0, 1]).out;
    if (mb !== from && TREE_RE.test(mb) && containedIn(repo, from, mb)) points.add(mb);
  }
  return points.size === 0 ? from : mostAdvanced(repo, [...points]) ?? from;
}

/**
 * Perf F2 (gate round 12): `diff --quiet` and `diff --shortstat` read every changed file's content, which on a repo of
 * many loose objects can take longer than runGit's 10 s. Together they get this budget instead: well under the 30 s the
 * hook gives assemble (oss-phase-result.sh), leaving time for the rest.
 */
const DIFF_BUDGET_MS = 20_000;

/** The diff_unavailable hint when git ran past its time limit, such as DIFF_BUDGET_MS (fixed text, no values). */
export const DIFF_TIMEOUT = 'diff_timeout: git ran past its time limit (often many loose objects): run git gc, then try again';

/** The base ship diffs from: the local base moved past by the snapshot and live remote refs (diffFrom), and its merge base with HEAD. */
function diffBase(repo: string, base: string, remoteRefs: ReadonlyMap<string, string>): { branch: string; tip: string; headSha: string; from: string; mergeBase: string } {
  if (base.startsWith('-')) throw new GitError('base');
  const branch = runGit(repo, ['check-ref-format', '--branch', base]).out;
  const tip = runGit(repo, ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}^{commit}`]).out;
  const headSha = runGit(repo, ['rev-parse', '--verify', 'HEAD^{commit}']).out;
  const from = diffFrom(repo, branch, tip, headSha, remoteRefs);
  return { branch, tip, headSha, from, mergeBase: runGit(repo, ['merge-base', from, headSha]).out };
}

/**
 * D85 (gate round 15): the paths under `dir` that this branch added, from the same merge base assemble ship diffs from
 * (diffBase), so a stale local base never counts another feature's commits from origin as this branch's. 'timeout' when
 * a git call ran past its time limit (D85 info b); null on any other git failure.
 */
export function branchAddedPaths(repo: string, base: string, remoteRefs: ReadonlyMap<string, string>, dir: string): string[] | 'timeout' | null {
  try {
    const { mergeBase, headSha } = diffBase(repo, base, remoteRefs);
    const out = runGit(repo, [...DIFF, '--name-only', '--diff-filter=A', '-z', mergeBase, headSha, '--', dir], [0], true, PATH_LIST_BUFFER).out;
    return out.split('\0').filter((p) => p !== '');
  } catch (e) {
    return e instanceof GitError && e.timedOut ? 'timeout' : null;
  }
}

function readDiff(repo: string, base: string, remoteRefs: ReadonlyMap<string, string>): Diff {
  const { branch, tip, headSha, from, mergeBase } = diffBase(repo, base, remoteRefs);
  const deadline = Date.now() + DIFF_BUDGET_MS;
  const left = (): number => Math.max(1, deadline - Date.now());
  const sameTree = runGit(repo, [...DIFF, '--quiet', tip, headSha], [0, 1], false, undefined, undefined, left()).status === 0;
  const stat = runGit(repo, [...DIFF, '--shortstat', mergeBase, headSha], [0], false, undefined, undefined, left()).out;
  const num = (re: RegExp): number => Number(re.exec(stat)?.[1] ?? 0);
  const files = num(/(\d+) files? changed/);
  return {
    base: mergeBase,
    from,
    baseRef: branch,
    files,
    insertions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
    headSha,
    empty: sameTree || files === 0,
  };
}

/** Lines of a repo file (regular, not a link, under the cap); [] when it is missing. */
function repoLines(file: string): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    return [];
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > REPO_FILE_CAP) return [];
    return fs.readFileSync(fd, 'utf-8').split('\n').filter((l) => l !== '');
  } finally {
    fs.closeSync(fd);
  }
}

function counts(v: unknown): Record<string, number> {
  const src = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const s of SEVERITIES) out[s] = typeof src[s] === 'number' ? (src[s] as number) : 0;
  return out;
}

interface Gate {
  gate: string;
  verdict: 'pass' | 'fail';
  findings: Record<string, number>;
  fixed: Record<string, number>;
  source: 'model' | 'agent';
}

/** A captured agent FAIL row (T19, verdict-capture.ts); D45: pass rows decide nothing, so they are not read. */
interface FailRow {
  gate: string;
  findings: Record<string, number>;
  at: number;
  /** The working tree the agent reviewed, outside .oss (untracked files included); null when the capture could not build it. */
  tree: string | null;
  /**
   * The tracked tree at review (.oss included); shippedVsReviewed reads it only to tell whether a path deleted since
   * review was tracked then. null when the capture could not build it.
   */
  trackedTree: string | null;
  /** HEAD at review; null when git rev-parse failed at capture. */
  headSha: string | null;
}

/** A captured fail row (T19, verdict-capture.ts): null for a pass row or when the row's shape is not one. */
function failRow(row: Record<string, unknown>): FailRow | null {
  const f = row.findings;
  const at = typeof row.ts === 'string' ? Date.parse(row.ts) : NaN;
  if (typeof row.gate !== 'string' || row.verdict !== 'fail' || Number.isNaN(at)) return null;
  if (typeof f !== 'object' || f === null || Array.isArray(f)) return null;
  const findings: Record<string, number> = {};
  for (const s of SEVERITIES) {
    const n = (f as Record<string, unknown>)[s];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
    findings[s] = n;
  }
  // D48: a row with neither tree nor headSha (no longer written by the capture) does not count.
  if ([row.tree, row.trackedTree, row.headSha].every((v) => v === undefined || v === '')) return null;
  const hex = (v: unknown): string | null => (typeof v === 'string' && TREE_RE.test(v) ? v : null);
  return { gate: row.gate, findings, at, tree: hex(row.tree), trackedTree: hex(row.trackedTree), headSha: hex(row.headSha) };
}

const TREE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A fail row's reviewed state: rows sharing one are compared once. */
function rowKey(f: FailRow): string {
  return `${f.tree}|${f.trackedTree}|${f.headSha}`;
}

/** Buffer for a -z path list (perf L2: about 17,000 paths overflowed 1 MB). */
const PATH_LIST_BUFFER = 64 * 1024 * 1024;
const SHIPPED_CODE = ['--', '.', ':(exclude).oss'];
/**
 * Info (gate round 10): every option config could change in a diff assemble reads is pinned: no renames, no external
 * diff or textconv, submodules never ignored (diff.ignoreSubmodules), no color, myers (diff.algorithm, for the totals).
 */
const DIFF_OPTIONS = ['--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--no-color', '--diff-algorithm=myers'];
const DIFF = ['diff', ...DIFF_OPTIONS];

/** One path of a `diff --raw` between two tree-ishes: each side's `<mode> <object>` (mode 000000 when it has none). */
interface RawChange {
  from: string;
  to: string;
}

const ABSENT = /^0{6} /;
/** Deleted paths looked up one by one in a batch; more are compared through cached path lists. */
const BATCH_LOOKUPS = 64;
/**
 * Fail rows whose review bases and tree diffs are read together (perf L3, gate round 10): 200 rows on old reviewed trees
 * of a 10,000-file repo take about 2.5 s; bigger batches save little time and hold more diff output at once.
 */
const BATCH_ROWS = 16;
/** Path bytes per git call when paths go on argv (well under ARG_MAX). */
const ARGV_PATH_BYTES = 128 * 1024;
const NO_CHANGES: ReadonlyMap<string, RawChange> = new Map();

/** `paths` in runs whose total UTF-8 size stays under ARGV_PATH_BYTES (info, gate round 10: bytes, not UTF-16 units). */
export function argvChunks(paths: string[]): string[][] {
  const chunks: string[][] = [];
  let size = Infinity;
  for (const p of paths) {
    const bytes = Buffer.byteLength(p) + 1;
    if (size + bytes > ARGV_PATH_BYTES) {
      chunks.push([]);
      size = 0;
    }
    (chunks[chunks.length - 1] as string[]).push(p);
    size += bytes;
  }
  return chunks;
}

/** A `diff --raw -z` record list, by path; throws on a record it cannot read. */
function parseRaw(parts: string[], out: Map<string, RawChange> = new Map()): Map<string, RawChange> {
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]/.exec(parts[i] as string);
    if (m === null) throw new GitError('raw');
    out.set(parts[i + 1] as string, { from: `${m[1]} ${m[3]}`, to: `${m[2]} ${m[4]}` });
  }
  return out;
}

/** Why a fail row is open (D57's tracked-change text, or D67's upstream text), or that it is cleared or ignored. */
type RowState = 'cleared' | 'open' | 'upstream' | 'ignored';

/**
 * D45 + D58 + D67: decides whether a captured fail row is cleared by the shipped code (HEAD outside .oss), for one
 * assemble. The diff base (`from`, the commit the ship diff's merge-base was taken from) and that merge-base come from
 * readDiff, so check (reassemble) compares on the same paths. Every list is read from git output (-z, a large buffer)
 * and intersected here. Objects git may have pruned are checked only after a comparison failed (perf F1), and once per
 * SHA. Perf L3 (gate round 10): rows are prepared in batches (prefetch): every tree diff from one `diff-tree --stdin`; a
 * row the batch could not serve falls back to its own git calls. Gate round 11: every row's review base comes from one
 * rev-list before the first batch (perf I2), a batch holds distinct review states (perf L2), and after a batched diff
 * overflows its buffer no later batch tries one (perf L1).
 */
class FailComparer {
  private readonly missing = new Map<string, boolean>();
  /** The merge base's diff to HEAD (the feature's own paths), read once. */
  private own: Map<string, RawChange> | null = null;
  private readonly reviewBases = new Map<string, string | null>();
  /**
   * The current batch's diff-tree output, unparsed (each pair parsed when used, so a batch of whole-tree diffs costs
   * its text, not a map per pair): reviewed trees to HEAD, and D67's review bases to the merge base. Replaced by the
   * next batch (perf low 2: rows' own diffs are not kept).
   */
  private readonly rowText = new Map<string, string>();
  private readonly upstreamText = new Map<string, string>();
  /** D67: the last review base's upstream changes, parsed (rows sharing a review base are usually adjacent). */
  private upstreamHit: { base: string; diff: Map<string, RawChange> } | null = null;
  private readonly prefetched = new Set<string>();
  private readonly added = new Map<string, Set<string>>();
  /** Perf low (gate round 9): each `<tree-ish>:<path>` lookup, once per assemble. */
  private readonly entries = new Map<string, Map<string, string | null>>();
  /** Perf L1 (gate round 11): set when a batched tree diff overflowed; later batches leave diffs to each row's calls. */
  private diffOverflowed = false;

  constructor(private readonly repo: string, private readonly from: string, private readonly mergeBase: string) {}

  /** True when prefetch already tried this row. */
  isPrefetched(f: FailRow): boolean {
    return this.prefetched.has(rowKey(f));
  }

  /**
   * Perf L3 (gate round 10): reads, for `rows`, every tree diff not yet read (each reviewed tree to HEAD and each review
   * base to the merge base, one `diff-tree --stdin`). Best effort: anything a batch call cannot answer is left for the
   * row's own git calls, which decide it as before. Perf L1 (gate round 11): none once a batched diff overflowed.
   */
  prefetch(rows: FailRow[]): void {
    for (const f of rows) this.prefetched.add(rowKey(f));
    this.rowText.clear();
    this.upstreamText.clear();
    if (this.diffOverflowed) return;
    try {
      const bases = [...new Set(rows.map((f) => (f.headSha === null ? null : this.reviewBases.get(f.headSha))))]
        .filter((b): b is string => typeof b === 'string' && b !== this.mergeBase);
      const trees = this.treesOf(['HEAD', this.mergeBase, ...bases]);
      const head = trees.get('HEAD');
      const mb = trees.get(this.mergeBase);
      if (head === undefined || mb === undefined) return;
      const pairs = new Map<string, (text: string) => void>();
      for (const f of rows) {
        const tree = f.tree;
        if (tree !== null) pairs.set(`${tree} ${head}`, (t) => this.rowText.set(tree, t));
      }
      for (const b of bases) {
        const t = trees.get(b);
        if (t !== undefined) pairs.set(`${t} ${mb}`, (text) => this.upstreamText.set(b, text));
      }
      if (pairs.size > 0) this.diffTrees(pairs);
    } catch (e) {
      // a batch git error: each row's own calls decide it; after an overflow, so do every later batch's (perf L1)
      if (e instanceof GitError && e.overflow) this.diffOverflowed = true;
    }
  }

  /**
   * Perf I2 (gate round 11): the review bases of every row's review head, from one history walk before the first batch
   * (batchReviewBases' answer for a head does not depend on the other heads walked with it). Best effort: a head git
   * cannot walk leaves its rows to merge-base each. Perf F1 (gate round 12): only the heads git has are walked (one
   * `cat-file --batch-check`), so one pruned head no longer fails the walk for all; never `--ignore-missing`, which
   * would leave a missing head unlisted, and an unlisted head counts as its own base.
   */
  walkReviewBases(rows: FailRow[]): void {
    try {
      const heads = [...new Set(rows.map((f) => f.headSha).filter((h): h is string => h !== null && !this.reviewBases.has(h)))];
      if (heads.length === 0) return;
      const found = runGit(this.repo, ['cat-file', '--batch-check=%(objecttype)'], [0], true, PATH_LIST_BUFFER, `${heads.join('\n')}\n`)
        .out.split('\n');
      // D79 (gate round 13): a head git reports missing goes straight to the D55 path (no review base, gone), with no
      // per-row merge-base or cat-file -e.
      heads.forEach((h, i) => {
        if (found[i]?.endsWith(' missing') === true) {
          this.reviewBases.set(h, null);
          this.missing.set(h, true);
        }
      });
      this.batchReviewBases(heads.filter((_, i) => found[i] === 'commit'));
    } catch {
      // each row takes merge-base
    }
  }

  /**
   * Perf L3: review bases for many review heads from one `rev-list --boundary --parents <heads> ^from`. A head not
   * listed is reachable from `from`, so it is its own merge base with it. A listed head whose listed history reaches
   * exactly one boundary commit has that commit as its merge base (every common ancestor lies behind the first commit
   * of `from`'s history on any path from the head). Heads reaching none or several are left to `merge-base`.
   */
  private batchReviewBases(heads: string[]): void {
    const distinct = [...new Set(heads)];
    if (distinct.length === 0) return;
    const out = runGit(this.repo, ['rev-list', '--topo-order', '--boundary', '--parents', '--stdin'], [0], true, PATH_LIST_BUFFER,
      `${distinct.join('\n')}\n^${this.from}\n`).out;
    const parents = new Map<string, string[]>();
    const order: string[] = [];
    for (const line of out.split('\n')) {
      if (line === '' || line.startsWith('-')) continue;
      const [c, ...ps] = line.split(' ');
      if (c === undefined || !TREE_RE.test(c)) throw new GitError('rev-list');
      parents.set(c, ps);
      order.push(c);
    }
    // Boundary commits each listed commit reaches (at most two kept: only "exactly one" matters), parents first.
    const reach = new Map<string, string[]>();
    for (let i = order.length - 1; i >= 0; i--) {
      const c = order[i] as string;
      const set = new Set<string>();
      for (const p of parents.get(c) ?? []) {
        for (const b of parents.has(p) ? reach.get(p) ?? [] : [p]) if (set.size < 2) set.add(b);
      }
      reach.set(c, [...set]);
    }
    for (const h of distinct) {
      if (!parents.has(h)) this.reviewBases.set(h, h);
      else {
        const r = reach.get(h) ?? [];
        if (r.length === 1) this.reviewBases.set(h, r[0] as string);
      }
    }
  }

  /** The tree of each commit-ish, from one `cat-file --batch-check`; a missing one is left out. */
  private treesOf(commits: string[]): Map<string, string> {
    const out = runGit(this.repo, ['cat-file', '--batch-check=%(objectname)'], [0], true, PATH_LIST_BUFFER,
      commits.map((c) => `${c}^{tree}`).join('\n') + '\n').out.split('\n');
    const trees = new Map<string, string>();
    commits.forEach((c, i) => {
      const t = out[i] ?? '';
      if (TREE_RE.test(t)) trees.set(c, t);
    });
    return trees;
  }

  /**
   * One `diff-tree --stdin -r -z --raw` over tree pairs (`<a> <b>` lines), each pair's record text (`-z` raw records,
   * parsed when used) handed to its callback. git prints each pair's `<a> <b>` line before its records and nothing for
   * a pair it cannot read, so a pair with no header line is left unanswered. A record starts with `:` and holds two
   * NUL-terminated fields, so a path can never be taken for a header.
   */
  private diffTrees(pairs: Map<string, (text: string) => void>): void {
    const out = runGit(this.repo, ['diff-tree', '--stdin', '-r', '-z', '--raw', '--no-abbrev', ...DIFF_OPTIONS, ...SHIPPED_CODE], [0], true,
      PATH_LIST_BUFFER, `${[...pairs.keys()].join('\n')}\n`).out;
    const done = new Map<string, string>();
    let header: string | null = null;
    let start = 0;
    let i = 0;
    const close = (): void => {
      if (header !== null) done.set(header, out.slice(start, i));
    };
    while (i < out.length) {
      if (out[i] === ':') {
        const meta = out.indexOf('\0', i);
        const name = meta === -1 ? -1 : out.indexOf('\0', meta + 1);
        if (header === null || name === -1) throw new GitError('diff-tree');
        i = name + 1;
      } else {
        close();
        const nl = out.indexOf('\n', i);
        header = nl === -1 ? '' : out.slice(i, nl);
        if (!pairs.has(header) || done.has(header)) throw new GitError('diff-tree header');
        i = nl + 1;
        start = i;
      }
    }
    close();
    for (const [h, text] of done) pairs.get(h)?.(text);
  }

  /**
   * D45: a fail is cleared only when the shipped code differs from the code that failed: its reviewed trees, else its
   * headSha's tree. A fail that cannot be compared (a malformed or partial row, or a git error) stays open; one with
   * neither is dropped (D48). D55: trees git no longer has (gc) fall back to the headSha's tree; when that commit is
   * gone too, or a headSha-only row's commit is gone, 'ignored' (neither opens nor clears). D67: 'upstream' is open
   * because upstream changed a flagged feature path since review.
   */
  state(f: FailRow): RowState {
    const hasTrees = f.tree !== null && f.trackedTree !== null;
    if (f.tree !== null && f.trackedTree !== null) {
      const r = this.compare(f.tree, f.trackedTree, f.headSha, f.headSha);
      if (r !== 'unknown') return r;
      if (!this.gone(f.tree) && !this.gone(f.trackedTree)) return 'open';
    }
    if (f.headSha === null) return hasTrees ? 'ignored' : 'open';
    const headTree = `${f.headSha}^{tree}`;
    const r = this.compare(headTree, headTree, null, f.headSha);
    if (r !== 'unknown') return r;
    return this.gone(f.headSha) ? 'ignored' : 'open';
  }

  /**
   * D45 + D58 + D67: whether the shipped code differs from what the agent reviewed, on the feature's own paths only:
   * those the feature changed since the merge base (`git diff <merge-base> HEAD`), plus those the reviewed tree changed
   * against the review-time merge base (merge-base(from, review headSha)), so a flagged edit the feature has since
   * dropped still counts. A teammate's upstream change brought in by a rebase or merge is on neither list. With no
   * usable review headSha (null or pruned) only the first list counts (code-review info 1). D67: a path upstream changed
   * between the review-time base and the merge base (content, mode, deletion, or either side of a rename, which a
   * no-renames diff lists as a deletion and an addition) never clears, whatever it holds now; when it is a feature path
   * the row is 'upstream' (its own blocker text) unless another feature path clears it (D49). Ship's reviews run on the
   * uncommitted tree and ship commits afterwards (only the files it picks), so `tree` (the reviewed working tree,
   * untracked files included) is compared with HEAD: an added or modified path differs; a deleted path differs only
   * when it was tracked at review (`trackedTree`) or in the commit HEAD was at review (`reviewHead`, pen N4); an
   * untracked file the reviewer saw and ship left out does not (pen M3a). All are strict hex tree-ishes, checked by the
   * caller. 'unknown' on any git error (an object git does not have included).
   */
  private compare(tree: string, trackedTree: string, reviewHead: string | null, at: string | null): 'cleared' | 'open' | 'upstream' | 'unknown' {
    try {
      const changes = this.rowDiff(tree);
      const own = this.ownPaths();
      const reviewBase = this.reviewBase(at);
      const up = reviewBase === null || reviewBase === this.mergeBase ? NO_CHANGES : this.upstreamSince(reviewBase);
      // D67: upstream changed a feature path (one the feature changes now, or the reviewed tree had changed: its state
      // there, read from the row's diff or else HEAD's, which is then the merge base's, is not the review base's).
      let upstream = false;
      for (const [p, u] of up) {
        if (own.has(p) || (changes.get(p)?.from ?? u.to) !== u.from) {
          upstream = true;
          break;
        }
      }
      const gone: string[] = [];
      for (const [p, c] of changes) {
        if (up.has(p)) continue;
        if (reviewBase === null && !own.has(p)) continue;
        if (!ABSENT.test(c.to)) return 'cleared';
        gone.push(p);
      }
      if (gone.length > 0 && this.trackedAtReview(gone, trackedTree, reviewHead)) return 'cleared';
      return upstream ? 'upstream' : 'open';
    } catch {
      return 'unknown';
    }
  }

  /** `diff --raw` from a tree-ish to another outside .oss, by path. */
  private rawDiff(a: string, b: string): Map<string, RawChange> {
    return parseRaw(runGit(this.repo, [...DIFF, '--raw', '-z', '--no-abbrev', '--end-of-options', a, b, ...SHIPPED_CODE], [0], true, PATH_LIST_BUFFER)
      .out.split('\0'));
  }

  /** A reviewed tree's diff to HEAD: from the current batch, else its own call. */
  private rowDiff(tree: string): Map<string, RawChange> {
    const text = this.rowText.get(tree);
    return text === undefined ? this.rawDiff(tree, 'HEAD') : parseRaw(text.split('\0'));
  }

  /** The merge base's diff to HEAD: the feature's own paths, read once. */
  private ownPaths(): Map<string, RawChange> {
    this.own ??= this.rawDiff(this.mergeBase, 'HEAD');
    return this.own;
  }

  /** D67: what upstream changed from a review base to the merge base: from the current batch, else its own call. */
  private upstreamSince(reviewBase: string): Map<string, RawChange> {
    if (this.upstreamHit?.base !== reviewBase) {
      const text = this.upstreamText.get(reviewBase);
      const diff = text === undefined ? this.rawDiff(reviewBase, this.mergeBase) : parseRaw(text.split('\0'));
      this.upstreamHit = { base: reviewBase, diff };
    }
    return this.upstreamHit.diff;
  }

  /**
   * Whether any deleted path was tracked at review: in `trackedTree` or in the review's HEAD commit. Up to
   * BATCH_LOOKUPS paths: one `ls-tree` per tree-ish (lookup, cached). More, or a git that cannot list entries: git's
   * path lookup scans each folder per name (40,000 names in one folder took 47 s), so the paths each tree-ish adds over
   * HEAD are listed once and cached.
   */
  private trackedAtReview(gone: string[], trackedTree: string, reviewHead: string | null): boolean {
    const treeishes = [trackedTree, ...(reviewHead === null ? [] : [reviewHead])];
    if (gone.length <= BATCH_LOOKUPS) {
      let listed = true;
      for (const t of treeishes) {
        const found = this.tryLookup(t, gone);
        if (found === null) {
          listed = false;
          break;
        }
        if (found.some((state) => state !== null)) return true;
      }
      if (listed) return false;
    }
    const sets = treeishes.map((t) => this.addedOverHead(t));
    return gone.some((p) => sets.some((set) => set.has(p)));
  }

  /** lookup, or null when git cannot list the entries (the caller then takes the diff-list route). */
  private tryLookup(treeish: string, paths: string[]): Array<string | null> | null {
    try {
      return this.lookup(treeish, paths);
    } catch {
      return null;
    }
  }

  /**
   * Each path's `<mode> <object>` in `treeish` (as in diff --raw; a submodule is `160000 <commit>`), null when it has no
   * such entry. `ls-tree -z --full-tree` with literal pathspecs works on every git (cat-file's %(objectmode) needs
   * 2.53, code-review high, gate round 9); the paths go on argv in bounded chunks, and each `<tree-ish>:<path>` is
   * looked up once per assemble (perf low, gate round 9).
   */
  private lookup(treeish: string, paths: string[]): Array<string | null> {
    let known = this.entries.get(treeish);
    if (known === undefined) {
      known = new Map();
      this.entries.set(treeish, known);
    }
    const missing = [...new Set(paths.filter((p) => !known.has(p)))];
    for (const chunk of argvChunks(missing)) {
      const out = runGit(this.repo, ['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', treeish, '--', ...chunk], [0], true, PATH_LIST_BUFFER).out;
      const listed = new Map<string, string>();
      for (const entry of out.split('\0')) {
        const m = /^([0-7]{6}) [a-z]+ ([0-9a-f]{40}(?:[0-9a-f]{24})?)\t(.*)$/s.exec(entry);
        if (m !== null) listed.set(m[3] as string, `${m[1]} ${m[2]}`);
        else if (entry !== '') throw new GitError('ls-tree');
      }
      for (const p of chunk) known.set(p, listed.get(p) ?? null);
    }
    return paths.map((p) => known.get(p) ?? null);
  }

  /** Paths `treeish` has that HEAD does not (outside .oss), cached per tree-ish. */
  private addedOverHead(treeish: string): Set<string> {
    let hit = this.added.get(treeish);
    if (hit === undefined) {
      hit = new Set(
        runGit(this.repo, [...DIFF, '--name-only', '-z', '--diff-filter=A', '--end-of-options', 'HEAD', treeish, ...SHIPPED_CODE], [0], true, PATH_LIST_BUFFER)
          .out.split('\0').filter((p) => p !== ''),
      );
      this.added.set(treeish, hit);
    }
    return hit;
  }

  /**
   * The merge base at review: merge-base(from, the review's HEAD), from prefetch's batch or its own call. null when
   * there is no headSha or git pruned it (the review-time base is unknown).
   */
  private reviewBase(at: string | null): string | null {
    if (at === null) return null;
    const hit = this.reviewBases.get(at);
    if (hit !== undefined) return hit;
    let base: string | null;
    try {
      base = runGit(this.repo, ['merge-base', '--end-of-options', this.from, at]).out;
    } catch (e) {
      if (!this.gone(at)) throw e;
      base = null;
    }
    this.reviewBases.set(at, base);
    return base;
  }

  /**
   * D55: true only when git says the object is not in the repo (`cat-file -e` exits 1); any other git error is not a
   * missing object, so the caller keeps the fail open. Once per SHA.
   */
  private gone(sha: string): boolean {
    const hit = this.missing.get(sha);
    if (hit !== undefined) return hit;
    let r: boolean;
    try {
      r = runGit(this.repo, ['cat-file', '-e', sha], [0, 1]).status === 1;
    } catch {
      r = false;
    }
    this.missing.set(sha, r);
    return r;
  }
}

/** A ledger-backed timeline line's round and time, for telling a re-review round from a re-roll (finding 4). */
interface RoundLine {
  round: number;
  at: number;
}

interface Timeline {
  /** Latest round only; a later line of the same gate wins. */
  byName: Map<string, Gate>;
  /** Every round's lines, by gate. */
  rounds: Map<string, RoundLine[]>;
}

/** Gates from the feature's ledger-backed timeline lines written in this run (at or after its start; pen F1). */
function timelineGates(ctx: AssembleContext, featureDir: string, gateHashes: Set<unknown>): Timeline {
  const backed: Array<Record<string, unknown>> = [];
  // Gate lines carry whole-second times: floor the run start to its second, so a line from that second counts.
  const runStart = Math.floor(Date.parse(ctx.startedAt) / 1000) * 1000;
  for (const line of repoLines(path.join(featureDir, 'timeline.ndjson'))) {
    if (!gateHashes.has(sha256(line))) continue;
    const rec = parseJsonObject(line);
    if (rec === null || typeof rec.ts !== 'string' || !(Date.parse(rec.ts) >= runStart)) continue;
    if (rec.kind === 'gate' && rec.feature === ctx.feature && typeof rec.round === 'number') {
      backed.push(rec);
    }
  }
  const latest = Math.max(0, ...backed.map((r) => r.round as number));
  const byName = new Map<string, Gate>();
  const rounds = new Map<string, RoundLine[]>();
  for (const rec of backed) {
    if (typeof rec.gate !== 'string') continue;
    const at = typeof rec.ts === 'string' ? Date.parse(rec.ts) : NaN;
    if (!Number.isNaN(at)) rounds.set(rec.gate, [...(rounds.get(rec.gate) ?? []), { round: rec.round as number, at }]);
    if (rec.round !== latest) continue;
    byName.set(rec.gate, {
      gate: rec.gate,
      verdict: rec.verdict === 'pass' ? 'pass' : 'fail',
      findings: counts(rec.findings),
      fixed: counts(rec.fixed),
      source: 'model',
    });
  }
  return { byName, rounds };
}

/** D27: a captured pen-test fail adds that optional gate, so it blocks even without a timeline line. */
const CAPTURE_ADDS_GATE = 'pen-test';

/** The blocker label of a gate held failed by an open captured fail (D32, D45). */
const NOT_RE_REVIEWED = 'captured fail, not re-reviewed: a tracked code change is needed to clear it';
/**
 * D67 + D71: the blocker label when upstream changed a feature path since review (fixed text, never a path). Rows don't
 * record which file was flagged, so it says "a file this feature changes".
 */
const UPSTREAM_CHANGED = 'captured fail, not re-reviewed: upstream changed a file this feature changes; a recorded override or a fix elsewhere in the feature clears it';

/**
 * T19 + D45 + D51: every captured FAIL row of the feature (no cutoff: pen F1, pen L7) is checked against the shipped
 * code (failCleared), so a revert to code that already failed stays blocked. A gate is open when any of its fail rows is
 * not cleared; it is set to fail with the newest open row's findings (`source: agent`, `fixed` stays from the line; D24's
 * fix counts never override it), and returned in the set, so its blocker says "captured fail, not re-reviewed". Captured
 * PASS rows decide and clear nothing (D45: a pass can be minted). With no open fail the timeline line stays (`source:
 * model`, listed in uncapturedGates, D26).
 */
function applyAgentVerdicts(
  tl: Timeline,
  verdictRows: LedgerRow[],
  comparer: FailComparer,
  overriddenAt: ReadonlyMap<string, number>,
): Map<string, 'open' | 'upstream'> {
  // Perf low 1: newest first (a later ledger row wins a tie), stopping at a gate's first open row; rows sharing one
  // reviewed state are compared once. Perf L3: the rows still to decide are prepared in batches.
  const rows = verdictRows.map(failRow).filter((f): f is FailRow => f !== null).reverse().sort((a, b) => b.at - a.at);
  const states = new Map<string, RowState>();
  const newestOpen = new Map<string, { row: FailRow; why: 'open' | 'upstream' }>();
  // D69: a gate whose open rows are all D67 rows ('upstream') keeps being walked, since an older ordinary open fail
  // (D57) decides its text and cannot be overridden; a gate with an ordinary open fail is decided.
  const decided = (gate: string): boolean => newestOpen.get(gate)?.why === 'open';
  comparer.walkReviewBases(rows);
  rows.forEach((f, i) => {
    if (decided(f.gate)) return;
    if (!states.has(rowKey(f))) {
      if (!comparer.isPrefetched(f)) {
        // Perf L2 (gate round 11): a batch holds BATCH_ROWS distinct review states, not rows.
        const batch = new Map<string, FailRow>();
        for (const r of rows.slice(i)) {
          if (batch.size === BATCH_ROWS) break;
          if (!decided(r.gate) && !states.has(rowKey(r)) && !batch.has(rowKey(r))) batch.set(rowKey(r), r);
        }
        comparer.prefetch([...batch.values()]);
      }
      states.set(rowKey(f), comparer.state(f));
    }
    const s = states.get(rowKey(f));
    // D69 + D70: a D67 row captured before a counted `Override <gate>` pick for its gate was answered is cleared.
    if (s === 'upstream' && f.at < (overriddenAt.get(f.gate) ?? -Infinity)) return;
    if (s === 'open' || s === 'upstream') {
      const prev = newestOpen.get(f.gate);
      newestOpen.set(f.gate, { row: prev?.row ?? f, why: s === 'open' ? 'open' : prev?.why ?? 'upstream' });
    }
  });
  const open = new Map<string, 'open' | 'upstream'>();
  for (const [name, { row: f, why }] of newestOpen) {
    const zero = counts({});
    const gate = tl.byName.get(name) ?? (name === CAPTURE_ADDS_GATE
      ? { gate: name, verdict: 'fail' as const, findings: zero, fixed: zero, source: 'agent' as const }
      : undefined);
    if (gate === undefined) continue;
    tl.byName.set(name, { ...gate, verdict: 'fail', findings: f.findings, source: 'agent' });
    open.set(name, why);
  }
  return open;
}

type OverridesOutcome =
  | { ok: true; overrides: Array<Record<string, string>>; clearsBefore: Map<string, number> }
  | Extract<AssembleOutcome, { ok: false }>;

/**
 * The model's `overrides.json`, each checked against a ledger-backed decision record; person comes from that record.
 * D69: an entry may name a `gate` (one of `gates`, else override_unrecorded with detail `gate`). D70: it clears that
 * gate's D67 rows captured before its decision was answered (`clearsBefore`, the latest such time per gate) only when
 * the record is a ship pick (`command: "ship"`) whose `choice` is exactly `Override <gate>` with a readable `answeredAt`.
 * D76: an entry naming a gate whose decision does not count is refused (override_unrecorded, detail `gate`); assemble
 * and check read the same records, so they agree. An entry without a gate is listed and clears nothing; D79 (pen L1): its
 * record must still be a ship pick whose choice starts `Override `, else override_unrecorded (detail `decisionId`).
 */
function readOverrides(ctx: AssembleContext, featureDir: string, decisionRows: LedgerRow[], gates: ReadonlySet<string>): OverridesOutcome {
  const recorded = new Map<string, Record<string, unknown>>();
  for (const line of repoLines(path.join(featureDir, 'decisions.ndjson'))) {
    const rec = parseJsonObject(line);
    if (rec === null || rec.feature !== ctx.feature || typeof rec.id !== 'string') continue;
    const h = sha256(line);
    const ok = decisionRows.some((r) => r.id === rec.id && r.feature === ctx.feature && r.sha256 === h);
    if (ok) recorded.set(rec.id, rec);
  }
  const raw = readValue(ctx, 'overrides.json');
  const requested = raw === null ? [] : parseJsonOr(raw, null);
  if (!Array.isArray(requested)) return { ok: false, error: 'override_unrecorded', detail: 'overrides.json' };
  const overrides: Array<Record<string, string>> = [];
  const clearsBefore = new Map<string, number>();
  for (const item of requested as Array<Record<string, unknown> | null>) {
    const id = item?.decisionId;
    if (typeof id !== 'string' || !recorded.has(id)) return { ok: false, error: 'override_unrecorded' };
    const gate = item?.gate;
    if (gate !== undefined && (typeof gate !== 'string' || !gates.has(gate))) return { ok: false, error: 'override_unrecorded', detail: 'gate' };
    const rec = recorded.get(id) as Record<string, unknown>;
    const person = rec.person;
    // D70: only a ship pick whose chosen answer is exactly `Override <gate>` counts, from the time it was answered.
    // D76: an entry naming a gate whose decision does not count is refused, like an unrecorded id.
    const at = typeof rec.answeredAt === 'string' ? Date.parse(rec.answeredAt) : NaN;
    if (typeof gate === 'string') {
      if (rec.command !== 'ship' || rec.choice !== `Override ${gate}` || Number.isNaN(at)) return { ok: false, error: 'override_unrecorded', detail: 'gate' };
      clearsBefore.set(gate, Math.max(at, clearsBefore.get(gate) ?? -Infinity));
    } else if (rec.command !== 'ship' || typeof rec.choice !== 'string' || !rec.choice.startsWith('Override ')) {
      // D79 (pen L1, gate round 13): a gate-less entry counts only for a ship pick answered `Override <gate>`.
      return { ok: false, error: 'override_unrecorded', detail: 'decisionId' };
    }
    overrides.push({
      finding: redactModelText(typeof item?.finding === 'string' ? item.finding : ''),
      decisionId: id,
      person: typeof person === 'string' ? person : JSON.stringify(person ?? null),
      ...(gate === undefined ? {} : { gate }),
    });
  }
  return { ok: true, overrides, clearsBefore };
}

export function assembleShip(ctx: AssembleContext, opts: AssembleShipOptions): AssembleOutcome {
  let diff: Diff;
  try {
    diff = readDiff(ctx.repo, opts.base, opts.remoteRefs ?? new Map());
  } catch (e) {
    // Perf F2 (gate round 12): the totals ran past their budget: its own hint (run git gc).
    if (e instanceof GitError && e.timedOut) return { ok: false, error: 'diff_unavailable', detail: DIFF_TIMEOUT };
    // Pen info 2: fixed text, never the base name; code-review info (round 7): only for a name git accepts as a branch.
    return isLocalBranch(ctx.repo, opts.base) || !validBranchName(ctx.repo, opts.base)
      ? { ok: false, error: 'diff_unavailable' }
      : { ok: false, error: 'diff_unavailable', detail: NO_LOCAL_BASE };
  }
  if (diff.empty) return { ok: false, error: 'empty_diff' };

  const featureDir = ctx.featureDir ?? path.join(ctx.repo, '.oss', 'dev', 'active', ctx.feature);
  let gateHashes: Set<unknown>;
  let decisionRows: LedgerRow[];
  let verdictRows: LedgerRow[];
  try {
    const ledger = openLedger(ctx.repo);
    gateHashes = new Set(ledger.readRows(`gates/${ctx.feature}`).map((r) => r.sha256));
    decisionRows = ledger.readRows(`decisions/${ctx.feature}`);
    verdictRows = ledger.readRows(`verdicts/${ctx.feature}`);
  } catch (e) {
    return { ok: false, error: e instanceof LedgerError ? e.code : 'unsafe_path' };
  }

  const required = opts.requiredGates ?? DEFAULT_REQUIRED_GATES;
  const read = readOverrides(ctx, featureDir, decisionRows, new Set([...required, CAPTURE_ADDS_GATE]));
  const timeline = timelineGates(ctx, featureDir, gateHashes);
  const notReReviewed = applyAgentVerdicts(timeline, verdictRows, new FailComparer(ctx.repo, diff.from, diff.base),
    read.ok ? read.clearsBefore : new Map());
  const byName = timeline.byName;
  for (const name of required) {
    if (!byName.has(name)) return { ok: false, error: 'gate_missing', detail: name };
  }
  const gates = [...byName.values()];
  if (!read.ok) return read;

  const blockers = gates
    .filter((g) => g.verdict !== 'pass')
    .map((g) => {
      const why = notReReviewed.get(g.gate);
      return why === undefined ? `gate:${g.gate}` : `gate:${g.gate} (${why === 'upstream' ? UPSTREAM_CHANGED : NOT_RE_REVIEWED})`;
    });
  const uncapturedGates = gates.filter((g) => g.source !== 'agent').map((g) => g.gate);
  const gateEvidence = uncapturedGates.length === 0 ? 'agent' : uncapturedGates.length === gates.length ? 'model' : 'partial';
  const summary = readValue(ctx, 'summary.txt');
  return {
    ok: true,
    result: {
      ...baseFields(ctx, 'ship'),
      headSha: diff.headSha,
      sources: {
        diff: 'code',
        gates: 'model',
        gateEvidence: 'code',
        uncapturedGates: 'code',
        overrides: 'code',
        blockers: 'code',
        verdict: 'code',
        summary: 'model',
      },
      diff: { base: diff.base, baseRef: diff.baseRef, files: diff.files, insertions: diff.insertions, deletions: diff.deletions },
      gates,
      gateEvidence,
      uncapturedGates,
      overrides: read.overrides,
      blockers,
      verdict: blockers.length === 0 ? 'ready_to_merge' : 'blocked',
      summary: summary === null ? '' : redactModelText(summary),
    },
  };
}
