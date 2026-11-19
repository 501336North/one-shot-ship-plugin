/**
 * Ship result assembler (R-257 T8, AC-003.4 to AC-003.7, card c; amended S2, S6, S9, P4).
 *
 * Diff: hardened git (fixed argv, no shell, GIT_* unset, GIT_CONFIG_NOSYSTEM=1, fsmonitor and hooks off, no external
 * diff or textconv, 10 s timeout). The base is a local branch only (never gh or fetch), checked with
 * `check-ref-format --branch` and passed after `--end-of-options`. Empty when the tree equals the base tip (covers a
 * squash-merged branch) or nothing changed since the merge-base. Totals come from `--shortstat` against the merge-base.
 * Gates: the feature's timeline gate lines of this run whose sha256 is in the ledger `gates/<feature>`, latest round only
 * (`source: model`). Captured review-agent rows (ledger `verdicts/<feature>`, verdict-capture.ts) since the run start of
 * the feature's last ready_to_merge ship result, or all of them (pen F1: never cut at this run's start), then apply, per
 * gate (`source: agent`; `fixed` stays from the line):
 * - D32: a captured FAIL row, on any tree, keeps its gate failed until a later PASS row of that gate counts with a tree
 *   different from the fail row's. A pass on the unchanged tree never erases it, whatever round lines exist, and no
 *   fix count overrides it. Its blocker reads `gate:<name> (captured fail, not re-reviewed)`.
 * - A PASS row counts only when its agent's start snapshot matched its stop trees (`start: match`, security L4) and
 *   its reviewed trees are what ships outside .oss (reviewedIsShipped; finding 4, pen N4). The newest counting pass
 *   decides through D24/D27: unfixed critical or high (plus medium and low for security and pen-test) fails the gate;
 *   all of them fixed passes it; with none, the agent's own verdict counts.
 * - A captured pen-test row adds that optional gate. D26: the result labels how many gates an agent row backs
 *   (`gateEvidence`) and names the rest (`uncapturedGates`).
 * Overrides: each decisionId must be a decisions.ndjson record whose line hash, id and feature match a ledger row;
 * `person` is copied from that record, never from the model.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openLedger, LedgerError, type Ledger, type LedgerRow } from './ledger.js';
import { readResult } from './store.js';
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
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const REPO_FILE_CAP = 4 * 1024 * 1024;

class GitError extends Error {}

/**
 * `raw` keeps stdout as git printed it (for `-z` output, whose paths may end in spaces). git is the fixed-path binary
 * (gitBin, never PATH; pen N3) run with PATH=/usr/bin:/bin; with none, every call fails (closed).
 */
function runGit(repo: string, args: string[], okCodes: number[] = [0], raw = false): { status: number; out: string } {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.PATH = '/usr/bin:/bin';
  const git = gitBin();
  if (git === '') throw new GitError('no git');
  const r = spawnSync(git, ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (r.error !== undefined || r.status === null || !okCodes.includes(r.status)) throw new GitError(args[0]);
  return { status: r.status, out: raw ? r.stdout : r.stdout.trim() };
}

/** True when `name` passes `check-ref-format --branch` and `refs/heads/<name>` exists (fixed argv, never an option). */
export function isLocalBranch(repo: string, name: string): boolean {
  if (name === '' || name.startsWith('-')) return false;
  try {
    runGit(repo, ['check-ref-format', '--branch', name]);
    runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${name}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** True when `refs/remotes/origin/<name>` exists (call after isLocalBranch accepted the name; never an option). */
export function hasOriginBranch(repo: string, name: string): boolean {
  try {
    runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/remotes/origin/${name}^{commit}`]);
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
 * D40: true when commit `tip` is an ancestor of, or equal to, at least one of `shas` (hex ids from the origin snapshot
 * ship start recorded), in one git call: `rev-list` lists `tip` unless some sha reaches it. False on any error (a sha
 * missing from the repo included) and for an empty list.
 */
export function containedInAny(repo: string, tip: string, shas: readonly string[]): boolean {
  if (shas.length === 0) return false;
  try {
    return runGit(repo, ['rev-list', '-n', '1', '--end-of-options', tip, ...shas.map((s) => `^${s}`)]).out === '';
  } catch {
    return false;
  }
}

interface Diff {
  base: string;
  baseRef: string;
  files: number;
  insertions: number;
  deletions: number;
  headSha: string;
  empty: boolean;
}

function readDiff(repo: string, base: string): Diff {
  if (base.startsWith('-')) throw new GitError('base');
  const branch = runGit(repo, ['check-ref-format', '--branch', base]).out;
  const tip = runGit(repo, ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}^{commit}`]).out;
  const headSha = runGit(repo, ['rev-parse', '--verify', 'HEAD^{commit}']).out;
  const mergeBase = runGit(repo, ['merge-base', tip, headSha]).out;
  const sameTree = runGit(repo, ['diff', '--quiet', '--no-ext-diff', '--no-textconv', tip, headSha], [0, 1]).status === 0;
  const stat = runGit(repo, ['diff', '--shortstat', '--no-renames', '--no-ext-diff', '--no-textconv', mergeBase, headSha]).out;
  const num = (re: RegExp): number => Number(re.exec(stat)?.[1] ?? 0);
  const files = num(/(\d+) files? changed/);
  return {
    base: mergeBase,
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

interface AgentRow {
  gate: string;
  verdict: 'pass' | 'fail';
  findings: Record<string, number>;
  at: number;
  tree: string | null;
  trackedTree: string | null;
  /** HEAD at review (pen N4): a deletion is allowed only for a path absent from this commit's tree too. */
  headSha: string | null;
  /** Security L4: true when the agent's start snapshot existed and equalled its stop trees (`start: "match"`). */
  startMatch: boolean;
}

/** A captured agent verdict row (T19, verdict-capture.ts): null when the row's shape is not one. */
function agentRow(row: Record<string, unknown>): AgentRow | null {
  const f = row.findings;
  const at = typeof row.ts === 'string' ? Date.parse(row.ts) : NaN;
  if (typeof row.gate !== 'string' || (row.verdict !== 'pass' && row.verdict !== 'fail') || Number.isNaN(at)) return null;
  if (typeof f !== 'object' || f === null || Array.isArray(f)) return null;
  const findings: Record<string, number> = {};
  for (const s of SEVERITIES) {
    const n = (f as Record<string, unknown>)[s];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
    findings[s] = n;
  }
  const hex = (v: unknown): string | null => (typeof v === 'string' && TREE_RE.test(v) ? v : null);
  return {
    gate: row.gate,
    verdict: row.verdict,
    findings,
    at,
    tree: hex(row.tree),
    trackedTree: hex(row.trackedTree),
    headSha: hex(row.headSha),
    startMatch: row.start === 'match',
  };
}

const TREE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * True when what the agent reviewed is what ships, outside .oss. Ship's reviews run on the uncommitted tree and ship
 * commits afterwards (only the files it picks), so trees, never HEAD, tie a row to what ships (finding 4):
 * (a) `<tree>` vs HEAD differs only by paths deleted in HEAD, and (b) none of those paths was tracked at review
 * (`<trackedTree>`) nor in the commit HEAD was at review (`<reviewHead>`, pen N4: `git rm --cached` before the review
 * cannot hide a committed file's deletion): an untracked file the reviewer saw and ship left out is fine; a tracked or
 * committed file deleted after the review, or any added or modified file, voids the row. All three are strict hex ids
 * (checked by the caller); with deletions and no reviewHead the row does not count.
 */
function reviewedIsShipped(repo: string, tree: string, trackedTree: string, reviewHead: string | null): boolean {
  try {
    const status = runGit(
      repo,
      ['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--end-of-options', tree, 'HEAD', '--', '.', ':(exclude).oss'],
      [0],
      true,
    ).out.split('\0');
    if (status[status.length - 1] === '') status.pop();
    const deleted: string[] = [];
    for (let k = 0; k + 1 < status.length; k += 2) {
      if (status[k] !== 'D') return false;
      deleted.push(status[k + 1]);
    }
    if (status.length % 2 !== 0) return false;
    if (deleted.length === 0) return true;
    if (reviewHead === null) return false;
    const listed = (treeish: string): string =>
      runGit(repo, ['--literal-pathspecs', 'ls-tree', '-r', '--name-only', '-z', '--end-of-options', treeish, '--', ...deleted], [0], true).out;
    return listed(trackedTree) === '' && listed(reviewHead) === '';
  } catch {
    return false;
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

/** D27: gates whose findings block at LOW or above (ship.md: "security findings at LOW or above"). */
const LOW_PLUS_GATES = new Set(['security', 'pen-test']);
/** D27: a captured pen-test row adds that optional gate, so its fail blocks even without a timeline line. */
const CAPTURE_ADDS_GATE = 'pen-test';

/**
 * D24/D27: unfixed = per counted severity max(0, found - fixed), summed; over 0 fails. Counted: critical and high (D24),
 * plus medium and low for security and pen-test (D27). Otherwise, when any counted finding was reported (so all were
 * fixed) the gate passes; with none, the agent's own verdict counts.
 */
function ruleVerdict(gate: string, row: AgentRow, fixed: Record<string, number>): 'pass' | 'fail' {
  const counted = LOW_PLUS_GATES.has(gate) ? ['critical', 'high', 'medium', 'low'] : ['critical', 'high'];
  const unfixed = counted.reduce((n, s) => n + Math.max(0, row.findings[s] - fixed[s]), 0);
  if (unfixed > 0) return 'fail';
  if (counted.some((s) => row.findings[s] > 0)) return 'pass';
  return row.verdict;
}

/** D36 + pen F2: true when pass `p` was captured on a known commit other than fail `f`'s (a fail with no headSha: never). */
function onNewCommit(f: AgentRow, p: AgentRow): boolean {
  return f.headSha !== null && p.headSha !== null && p.headSha !== f.headSha;
}

/**
 * D32 + pen F2 + D43: true when counting pass `p` (it always has a tree) clears fail `f`. A fail with a tree: the pass's
 * tree differs. A fail with no tree: a new commit (onNewCommit), or, when the fail has no headSha either (git rev-parse
 * failed at capture), any counting pass (D43).
 */
function passClears(f: AgentRow, p: AgentRow): boolean {
  if (f.tree !== null) return p.tree !== f.tree;
  return f.headSha === null || onNewCommit(f, p);
}

/** D32: the blocker label of a gate held failed by a captured fail row nobody re-reviewed on a changed tree. */
const NOT_RE_REVIEWED = 'captured fail, not re-reviewed';

/**
 * Pen F1: where the feature's verdict rows are read from, in epoch ms: the run start of its last ready_to_merge ship
 * result (the stored results/ship.json whose bytes the ledger's last `results/<feature>/ship` row binds), else the
 * first row (-Infinity). It never depends on this run's start, so restarting the run cannot drop an open fail; any
 * doubt (no row, unbound or unreadable file, another verdict) reads every row.
 */
function verdictCutoff(ledger: Ledger, repo: string, feature: string): number {
  const last = ledger.lastRow(`results/${feature}/ship`);
  let stored: ReturnType<typeof readResult>;
  try {
    stored = readResult(repo, feature, 'ship');
  } catch {
    return -Infinity;
  }
  if (last === null || !stored.ok || last.sha256 !== sha256(stored.bytes)) return -Infinity;
  const v = stored.value;
  if (typeof v !== 'object' || v === null || (v as Record<string, unknown>).verdict !== 'ready_to_merge') return -Infinity;
  const at = typeof last.startedAt === 'string' ? Date.parse(last.startedAt) : NaN;
  return Number.isNaN(at) ? -Infinity : at;
}

/**
 * T19 + D32: an agent's captured verdict supplies a gate's verdict and findings (`source: agent`); `fixed` stays from the
 * line. Rows from before `cutoff` (verdictCutoff, pen F1) are ignored.
 * - A FAIL row, on any tree (or none), keeps its gate failed until a later PASS row of that gate that counts (its
 *   reviewed trees are what ships, reviewedIsShipped) has a tree different from the fail row's. A pass on the unchanged
 *   tree never erases it, whatever round lines exist, and D24's fix counts never override it. Such a gate is returned
 *   in the set, so its blocker says "captured fail, not re-reviewed". Pen F2: a fail with no tree is cleared by a
 *   counting pass only on a different commit (onNewCommit); D43: one with no headSha either by any later counting pass
 *   (it has a real tree), never by a no-tree pass.
 * - D36: a PASS row with no tree (a changed file over 50 MB, or the capture deadline) but `start: match` (L4) and a
 *   headSha also clears an earlier fail row of its gate, only when its headSha differs from the fail row's (a fail with
 *   no headSha is never cleared, pen F2). It proves nothing about what it reviewed, so it never becomes the verdict.
 * - Otherwise the newest counting PASS row newer than the newest fail decides (code review H1), through D24/D27's rule
 *   (ruleVerdict).
 * - With neither (no counting pass, no open fail), the timeline line stays (`source: model`, so the gate is listed in
 *   uncapturedGates, D26).
 */
function applyAgentVerdicts(tl: Timeline, verdictRows: LedgerRow[], cutoff: number, repo: string): Set<string> {
  const byGate = new Map<string, Array<{ row: AgentRow; counts: boolean; blind: boolean }>>();
  const shipped = new Map<string, boolean>();
  for (const raw of verdictRows) {
    const row = agentRow(raw);
    if (row === null || !(row.at >= cutoff)) continue;
    let counts = false;
    if (row.verdict === 'pass' && row.startMatch && row.tree !== null && row.trackedTree !== null) {
      const key = `${row.tree} ${row.trackedTree} ${row.headSha ?? ''}`;
      if (!shipped.has(key)) shipped.set(key, reviewedIsShipped(repo, row.tree, row.trackedTree, row.headSha));
      counts = shipped.get(key) === true;
    }
    const blind = row.verdict === 'pass' && row.startMatch && row.tree === null && row.headSha !== null;
    if (row.verdict === 'fail' || counts || blind) byGate.set(row.gate, [...(byGate.get(row.gate) ?? []), { row, counts, blind }]);
  }
  const stale = new Set<string>();
  for (const [name, rows] of byGate) {
    const zero = counts({});
    const gate = tl.byName.get(name) ?? (name === CAPTURE_ADDS_GATE
      ? { gate: name, verdict: 'pass' as const, findings: zero, fixed: zero, source: 'agent' as const }
      : undefined);
    if (gate === undefined) continue;
    rows.sort((a, b) => a.row.at - b.row.at);
    const passes = rows.filter((r) => r.counts).map((r) => r.row);
    const blinds = rows.filter((r) => r.blind).map((r) => r.row);
    const open = rows
      .filter((r) => r.row.verdict === 'fail')
      .map((r) => r.row)
      .filter((f) => !passes.some((p) => p.at > f.at && passClears(f, p)))
      .filter((f) => !blinds.some((b) => b.at > f.at && onNewCommit(f, b)));
    if (open.length > 0) {
      tl.byName.set(name, { ...gate, verdict: 'fail', findings: open[open.length - 1].findings, source: 'agent' });
      stale.add(name);
      continue;
    }
    // H1: only a pass newer than the newest fail may decide; an older one was overruled by that fail.
    const lastFail = Math.max(-Infinity, ...rows.filter((r) => r.row.verdict === 'fail').map((r) => r.row.at));
    const deciding = passes.filter((p) => p.at > lastFail);
    if (deciding.length === 0) continue;
    const pick = deciding[deciding.length - 1];
    tl.byName.set(name, { ...gate, verdict: ruleVerdict(name, pick, gate.fixed), findings: pick.findings, source: 'agent' });
  }
  return stale;
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
    diff = readDiff(ctx.repo, opts.base);
  } catch {
    return { ok: false, error: 'diff_unavailable' };
  }
  if (diff.empty) return { ok: false, error: 'empty_diff' };

  const featureDir = path.join(ctx.repo, '.oss', 'dev', 'active', ctx.feature);
  let gateHashes: Set<unknown>;
  let decisionRows: LedgerRow[];
  let verdictRows: LedgerRow[];
  let cutoff: number;
  try {
    const ledger = openLedger(ctx.repo);
    gateHashes = new Set(ledger.readRows(`gates/${ctx.feature}`).map((r) => r.sha256));
    decisionRows = ledger.readRows(`decisions/${ctx.feature}`);
    verdictRows = ledger.readRows(`verdicts/${ctx.feature}`);
    cutoff = verdictCutoff(ledger, ctx.repo, ctx.feature);
  } catch (e) {
    return { ok: false, error: e instanceof LedgerError ? e.code : 'unsafe_path' };
  }

  const timeline = timelineGates(ctx, featureDir, gateHashes);
  const notReReviewed = applyAgentVerdicts(timeline, verdictRows, cutoff, ctx.repo);
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
