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
 *   commits brought in by a rebase or merge never clear a fail (FailComparer).
 * - An open captured pen-test fail adds that optional gate. D26: the result labels how many gates an agent row backs
 *   (`gateEvidence`) and names the rest (`uncapturedGates`).
 * Overrides: each decisionId must be a decisions.ndjson record whose line hash, id and feature match a ledger row;
 * `person` is copied from that record, never from the model.
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

class GitError extends Error {}

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
    timeout: 10_000,
    maxBuffer,
  });
  if (r.error !== undefined || r.status === null || !okCodes.includes(r.status)) throw new GitError(args[0]);
  return { status: r.status, out: raw ? r.stdout : r.stdout.trim() };
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
  } catch {
    return false;
  }
}

/** Why shipBaseCheck refused a base: `not_in_snapshot` when only the snapshot containment failed. */
export type ShipBaseCheck = 'ok' | 'refused' | 'not_in_snapshot';

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
  } catch {
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
  if (base === feature || base.includes(`/${feature}/`)) return 'refused';
  let current: string | null;
  try {
    current = runGit(repo, ['symbolic-ref', '-q', 'HEAD'], [0, 1]).out;
  } catch {
    return 'refused';
  }
  if (current === `refs/heads/${base}`) return 'refused';
  // Security info 4: a local base that is a symbolic ref (refs/heads/x -> another branch) is refused.
  try {
    if (runGit(repo, ['symbolic-ref', '-q', `refs/heads/${base}`], [0, 1]).status === 0) return 'refused';
  } catch {
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
  } catch {
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
    } catch {
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
  const out = runGit(repo, ['for-each-ref', `--contains=${from}`, '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/remotes/'], [0], true, PATH_LIST_BUFFER).out;
  for (const line of out.split('\n')) {
    const [name, sha, symref] = line.split('\0');
    if (symref !== '' || sha === undefined || !TREE_RE.test(sha) || sha === from) continue;
    if (/^refs\/remotes\/[^/]+\/(.+)$/.exec(name as string)?.[1] !== branch) continue;
    const mb = runGit(repo, ['merge-base', '--end-of-options', sha, head], [0, 1]).out;
    if (mb !== from && TREE_RE.test(mb) && containedIn(repo, from, mb)) points.add(mb);
  }
  return points.size === 0 ? from : mostAdvanced(repo, [...points]) ?? from;
}

function readDiff(repo: string, base: string, remoteRefs: ReadonlyMap<string, string>): Diff {
  if (base.startsWith('-')) throw new GitError('base');
  const branch = runGit(repo, ['check-ref-format', '--branch', base]).out;
  const tip = runGit(repo, ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}^{commit}`]).out;
  const headSha = runGit(repo, ['rev-parse', '--verify', 'HEAD^{commit}']).out;
  const from = diffFrom(repo, branch, tip, headSha, remoteRefs);
  const mergeBase = runGit(repo, ['merge-base', from, headSha]).out;
  const sameTree = runGit(repo, ['diff', '--quiet', '--no-ext-diff', '--no-textconv', tip, headSha], [0, 1]).status === 0;
  const stat = runGit(repo, ['diff', '--shortstat', '--no-renames', '--no-ext-diff', '--no-textconv', mergeBase, headSha]).out;
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

/** Buffer for a -z path list (perf L2: about 17,000 paths overflowed 1 MB). */
const PATH_LIST_BUFFER = 64 * 1024 * 1024;
const SHIPPED_CODE = ['--', '.', ':(exclude).oss'];
const DIFF = ['diff', '--no-renames', '--no-ext-diff', '--no-textconv'];

/** One path of a `diff --raw` between two tree-ishes: each side's `<mode> <object>` (mode 000000 when it has none). */
interface RawChange {
  from: string;
  to: string;
}

const ABSENT = /^0{6} /;
/** Deleted paths looked up one by one in a batch; more are compared through cached path lists. */
const BATCH_LOOKUPS = 64;
/** Path bytes per git call when paths go on argv (well under ARG_MAX). */
const ARGV_PATH_BYTES = 128 * 1024;

/** `paths` in runs whose total length stays under ARGV_PATH_BYTES. */
function argvChunks(paths: string[]): string[][] {
  const chunks: string[][] = [];
  let size = Infinity;
  for (const p of paths) {
    if (size + p.length + 1 > ARGV_PATH_BYTES) {
      chunks.push([]);
      size = 0;
    }
    (chunks[chunks.length - 1] as string[]).push(p);
    size += p.length + 1;
  }
  return chunks;
}

const C_ESCAPES: Record<string, string> = { '\x07': '\\a', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\v': '\\v', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' };

/** A name as git prints it in a `diff --git` header with core.quotePath=false (quote_c_style). */
function cQuote(name: string): string {
  if (!/[\x00-\x1f"\\\x7f]/.test(name)) return name;
  const body = name.replace(/[\x00-\x1f"\\\x7f]/g, (c) => C_ESCAPES[c] ?? `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`);
  return `"${body}"`;
}

/**
 * D45 + D58: decides whether a captured fail row is cleared by the shipped code (HEAD outside .oss), for one assemble.
 * The diff base (`from`, the commit the ship diff's merge-base was taken from) and that merge-base come from readDiff,
 * so check (reassemble) compares on the same paths. Every list is read from git output (-z, a large buffer) and
 * intersected here, so no path list ever goes on a command line. Objects git may have pruned are checked only after
 * a comparison failed (perf F1), and once per SHA.
 */
class FailComparer {
  private readonly missing = new Map<string, boolean>();
  /** Perf low 2 (gate round 8): only the merge base's and the review bases' diffs to HEAD are kept, never a row's own. */
  private readonly toHead = new Map<string, Map<string, RawChange>>();
  private readonly reviewBases = new Map<string, string | null>();
  private ancestry: Set<string> | null = null;
  private readonly added = new Map<string, Set<string>>();
  /** Perf low (gate round 9): each `<tree-ish>:<path>` lookup, once per assemble. */
  private readonly entries = new Map<string, Map<string, string | null>>();
  /** Perf medium (gate round 9): the feature's change signature now (merge base to HEAD), per path, once per assemble. */
  private readonly nowSigs = new Map<string, string>();

  constructor(private readonly repo: string, private readonly from: string, private readonly mergeBase: string) {}

  /**
   * D45: a fail is cleared only when the shipped code differs from the code that failed: its reviewed trees, else its
   * headSha's tree. A fail that cannot be compared (a malformed or partial row, or a git error) stays open; one with
   * neither is dropped (D48). D55: trees git no longer has (gc) fall back to the headSha's tree; when that commit is
   * gone too, or a headSha-only row's commit is gone, 'ignored' (neither opens nor clears).
   */
  cleared(f: FailRow): boolean | 'ignored' {
    const hasTrees = f.tree !== null && f.trackedTree !== null;
    if (f.tree !== null && f.trackedTree !== null) {
      const r = this.compare(f.tree, f.trackedTree, f.headSha, f.headSha);
      if (r !== 'unknown') return r === 'differs';
      if (!this.gone(f.tree) && !this.gone(f.trackedTree)) return false;
    }
    if (f.headSha === null) return hasTrees ? 'ignored' : false;
    const headTree = `${f.headSha}^{tree}`;
    const r = this.compare(headTree, headTree, null, f.headSha);
    if (r !== 'unknown') return r === 'differs';
    return this.gone(f.headSha) ? 'ignored' : false;
  }

  /**
   * D45 + D58: whether the shipped code differs from what the agent reviewed, on the feature's own paths only: those
   * the feature changed since the merge base (`git diff <merge-base> HEAD`), plus those the reviewed tree changed
   * against the review-time merge base (merge-base(from, review headSha)), so a flagged edit the feature has since
   * dropped still counts. A teammate's upstream change brought in by a rebase or merge is on neither list. With no
   * usable review headSha (null or pruned) only the first list counts (code-review info 1). D62: a feature path that
   * upstream also changed between the review-time base and the merge base differs only when the feature's own change
   * to it does (samePatches, D65: its mode and added lines). Ship's reviews run on the uncommitted tree and ship
   * commits afterwards (only the files it picks), so `tree` (the reviewed working tree, untracked files included) is
   * compared with HEAD: an added or modified path differs; a deleted path differs only when it was tracked at review (`trackedTree`) or in the commit
   * HEAD was at review (`reviewHead`, pen N4); an untracked file the reviewer saw and ship left out does not (pen
   * M3a). All are strict hex tree-ishes, checked by the caller. 'unknown' on any git error (an object git does not
   * have included).
   */
  private compare(tree: string, trackedTree: string, reviewHead: string | null, at: string | null): 'same' | 'differs' | 'unknown' {
    try {
      const changes = this.rawToHead(tree);
      if (changes.size === 0) return 'same';
      const own = this.baseToHead(this.mergeBase);
      const deleted = (c: RawChange): boolean => ABSENT.test(c.to);
      // The common case first, with no review-base diff (perf, gate round 8): a feature path the shipped code changed
      // that upstream left alone since review (its state at the review base is its state at the merge base) differs.
      const ownLive = [...changes].filter(([p, c]) => own.has(p) && !deleted(c)).map(([p]) => p);
      if (ownLive.length > 0) {
        const base = this.reviewBase(at);
        if (base === null || base === this.mergeBase) return 'differs';
        const probe = ownLive.slice(0, BATCH_LOOKUPS);
        const sameState = (state: string | null, mb: string): boolean => (state === null ? ABSENT.test(mb) : state === mb);
        // A git that cannot list entries falls through to the review base's diff below, which answers the same.
        const then = this.tryLookup(base, probe);
        if (then !== null && probe.some((p, i) => sameState(then[i] ?? null, own.get(p)?.from ?? ''))) return 'differs';
      }
      const reviewBase = this.reviewBase(at);
      const sinceReview = reviewBase === null ? own : this.baseToHead(reviewBase);
      // A path's state at the review-time merge base: from that diff, else the same as HEAD's.
      const reviewed = (p: string, c: RawChange): boolean =>
        own.has(p) || (reviewBase !== null && c.from !== (sinceReview.get(p)?.from ?? c.to));
      // D62: upstream changed the path between the review-time base and the merge base (each state read as above).
      const upstream = (p: string, c: RawChange): boolean =>
        reviewBase !== null && reviewBase !== this.mergeBase && (sinceReview.get(p)?.from ?? c.to) !== (own.get(p)?.from ?? c.to);
      const gone: string[] = [];
      const patched: string[] = [];
      for (const [p, c] of changes) {
        if (!reviewed(p, c)) continue;
        if (deleted(c)) gone.push(p);
        else if (upstream(p, c)) patched.push(p);
        else return 'differs';
      }
      if (patched.length > 0 && !this.samePatches(reviewBase as string, tree, patched)) return 'differs';
      if (gone.length === 0) return 'same';
      return this.trackedAtReview(gone, trackedTree, reviewHead) ? 'differs' : 'same';
    } catch {
      return 'unknown';
    }
  }

  /** `diff --raw` from a tree-ish to HEAD outside .oss, by path. */
  private rawToHead(treeish: string): Map<string, RawChange> {
    const parts = runGit(this.repo, [...DIFF, '--raw', '-z', '--no-abbrev', '--end-of-options', treeish, 'HEAD', ...SHIPPED_CODE], [0], true, PATH_LIST_BUFFER)
      .out.split('\0');
    const out = new Map<string, RawChange>();
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const m = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]/.exec(parts[i] as string);
      if (m === null) throw new GitError('raw');
      out.set(parts[i + 1] as string, { from: `${m[1]} ${m[3]}`, to: `${m[2]} ${m[4]}` });
    }
    return out;
  }

  /** rawToHead of the merge base or a review base, cached (perf low 2: rows' own trees are not). */
  private baseToHead(base: string): Map<string, RawChange> {
    const hit = this.toHead.get(base);
    if (hit !== undefined) return hit;
    const out = this.rawToHead(base);
    this.toHead.set(base, out);
    return out;
  }

  /**
   * D62 + D65: true when, for every path of `paths`, the feature's own change is the same at review (review base to
   * reviewed tree) and now (merge base to HEAD): its mode lines and its ordered added lines, compared exactly but for a
   * trailing CR, so upstream's edits elsewhere in the file (removed or context lines) are not part of it. One diff per
   * side for all the paths (perf medium, gate round 9); the merge-base side is cached across rows.
   */
  private samePatches(reviewBase: string, tree: string, paths: string[]): boolean {
    const missing = paths.filter((p) => !this.nowSigs.has(p));
    if (missing.length > 0) {
      const now = this.signatures(this.mergeBase, 'HEAD', missing);
      for (const p of missing) this.nowSigs.set(p, now.get(p) ?? '');
    }
    const then = this.signatures(reviewBase, tree, paths);
    return paths.every((p) => (then.get(p) ?? '') === this.nowSigs.get(p));
  }

  /**
   * Per path, the mode lines and added lines of a `-U0` diff from `a` to `b`, joined. The diff pins every option config
   * could change (inter-hunk context, --text over a -diff attribute, prefixes, quoting, submodule format), takes the
   * paths literally, and is split at each `diff --git ` header. A path with no section has no change ('').
   */
  private signatures(a: string, b: string, paths: string[]): Map<string, string> {
    const byHeader = new Map(paths.map((p) => [`${cQuote(`a/${p}`)} ${cQuote(`b/${p}`)}`, p]));
    const out = new Map<string, string>();
    for (const chunk of argvChunks(paths)) {
      const text = runGit(this.repo, [
        '-c', 'core.quotePath=false', '--literal-pathspecs', ...DIFF, '--no-color', '-U0', '--inter-hunk-context=0', '--text',
        '--submodule=short', '--src-prefix=a/', '--dst-prefix=b/', '--end-of-options', a, b, '--', ...chunk,
      ], [0], true, PATH_LIST_BUFFER).out;
      for (const section of text.split(/^diff --git /m).slice(1)) {
        const lines = section.split('\n');
        const p = byHeader.get(lines[0] as string);
        if (p === undefined) throw new GitError('diff header');
        const hunk = lines.findIndex((l) => l.startsWith('@@'));
        const head = hunk === -1 ? lines.slice(1) : lines.slice(1, hunk);
        const sig = head.filter((l) => /^(old mode|new mode|new file mode|deleted file mode) /.test(l));
        if (hunk !== -1) for (const l of lines.slice(hunk)) if (l.startsWith('+')) sig.push(l.replace(/\r$/, ''));
        out.set(p, sig.join('\n'));
      }
    }
    return out;
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
   * The merge base at review: merge-base(from, the review's HEAD). A review HEAD on the feature's own history since the
   * merge base needs no call: its merge base is the current one (perf low 1, gate round 8). null when there is no
   * headSha or git pruned it (the review-time base is unknown).
   */
  private reviewBase(at: string | null): string | null {
    if (at === null) return null;
    const hit = this.reviewBases.get(at);
    if (hit !== undefined) return hit;
    this.ancestry ??= new Set(
      runGit(this.repo, ['rev-list', '--ancestry-path', `${this.mergeBase}..HEAD`], [0], true, PATH_LIST_BUFFER).out.split('\n'),
    );
    let base: string | null;
    if (at === this.mergeBase || this.ancestry.has(at)) base = this.mergeBase;
    else {
      try {
        base = runGit(this.repo, ['merge-base', '--end-of-options', this.from, at]).out;
      } catch (e) {
        if (!this.gone(at)) throw e;
        base = null;
      }
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
 * T19 + D45 + D51: every captured FAIL row of the feature (no cutoff: pen F1, pen L7) is checked against the shipped
 * code (failCleared), so a revert to code that already failed stays blocked. A gate is open when any of its fail rows is
 * not cleared; it is set to fail with the newest open row's findings (`source: agent`, `fixed` stays from the line; D24's
 * fix counts never override it), and returned in the set, so its blocker says "captured fail, not re-reviewed". Captured
 * PASS rows decide and clear nothing (D45: a pass can be minted). With no open fail the timeline line stays (`source:
 * model`, listed in uncapturedGates, D26).
 */
function applyAgentVerdicts(tl: Timeline, verdictRows: LedgerRow[], comparer: FailComparer): Set<string> {
  // Perf low 1: newest first (a later ledger row wins a tie), stopping at a gate's first open row; rows sharing one
  // reviewed state are compared once.
  const rows = verdictRows.map(failRow).filter((f): f is FailRow => f !== null).reverse().sort((a, b) => b.at - a.at);
  const cleared = new Map<string, boolean | 'ignored'>();
  const newestOpen = new Map<string, FailRow>();
  for (const f of rows) {
    if (newestOpen.has(f.gate)) continue;
    const key = `${f.tree}|${f.trackedTree}|${f.headSha}`;
    if (!cleared.has(key)) cleared.set(key, comparer.cleared(f));
    if (cleared.get(key) === false) newestOpen.set(f.gate, f);
  }
  const open = new Set<string>();
  for (const [name, f] of newestOpen) {
    const zero = counts({});
    const gate = tl.byName.get(name) ?? (name === CAPTURE_ADDS_GATE
      ? { gate: name, verdict: 'fail' as const, findings: zero, fixed: zero, source: 'agent' as const }
      : undefined);
    if (gate === undefined) continue;
    tl.byName.set(name, { ...gate, verdict: 'fail', findings: f.findings, source: 'agent' });
    open.add(name);
  }
  return open;
}

type OverridesOutcome = { ok: true; overrides: Array<Record<string, string>> } | Extract<AssembleOutcome, { ok: false }>;

/** The model's `overrides.json`, each checked against a ledger-backed decision record; person comes from that record. */
function readOverrides(ctx: AssembleContext, featureDir: string, decisionRows: LedgerRow[]): OverridesOutcome {
  const recorded = new Map<string, unknown>();
  for (const line of repoLines(path.join(featureDir, 'decisions.ndjson'))) {
    const rec = parseJsonObject(line);
    if (rec === null || rec.feature !== ctx.feature || typeof rec.id !== 'string') continue;
    const h = sha256(line);
    const ok = decisionRows.some((r) => r.id === rec.id && r.feature === ctx.feature && r.sha256 === h);
    if (ok) recorded.set(rec.id, rec.person);
  }
  const raw = readValue(ctx, 'overrides.json');
  const requested = raw === null ? [] : parseJsonOr(raw, null);
  if (!Array.isArray(requested)) return { ok: false, error: 'override_unrecorded', detail: 'overrides.json' };
  const overrides: Array<Record<string, string>> = [];
  for (const item of requested as Array<Record<string, unknown> | null>) {
    const id = item?.decisionId;
    if (typeof id !== 'string' || !recorded.has(id)) return { ok: false, error: 'override_unrecorded' };
    const person = recorded.get(id);
    overrides.push({
      finding: redactModelText(typeof item?.finding === 'string' ? item.finding : ''),
      decisionId: id,
      person: typeof person === 'string' ? person : JSON.stringify(person ?? null),
    });
  }
  return { ok: true, overrides };
}

export function assembleShip(ctx: AssembleContext, opts: AssembleShipOptions): AssembleOutcome {
  let diff: Diff;
  try {
    diff = readDiff(ctx.repo, opts.base, opts.remoteRefs ?? new Map());
  } catch {
    // Pen info 2: fixed text, never the base name; code-review info (round 7): only for a name git accepts as a branch.
    return isLocalBranch(ctx.repo, opts.base) || !validBranchName(ctx.repo, opts.base)
      ? { ok: false, error: 'diff_unavailable' }
      : { ok: false, error: 'diff_unavailable', detail: NO_LOCAL_BASE };
  }
  if (diff.empty) return { ok: false, error: 'empty_diff' };

  const featureDir = path.join(ctx.repo, '.oss', 'dev', 'active', ctx.feature);
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

  const timeline = timelineGates(ctx, featureDir, gateHashes);
  const notReReviewed = applyAgentVerdicts(timeline, verdictRows, new FailComparer(ctx.repo, diff.from, diff.base));
  const byName = timeline.byName;
  for (const required of opts.requiredGates ?? DEFAULT_REQUIRED_GATES) {
    if (!byName.has(required)) return { ok: false, error: 'gate_missing', detail: required };
  }
  const gates = [...byName.values()];

  const read = readOverrides(ctx, featureDir, decisionRows);
  if (!read.ok) return read;

  const blockers = gates
    .filter((g) => g.verdict !== 'pass')
    .map((g) => (notReReviewed.has(g.gate) ? `gate:${g.gate} (${NOT_RE_REVIEWED})` : `gate:${g.gate}`));
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
