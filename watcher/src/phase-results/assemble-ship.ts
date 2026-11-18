/**
 * Ship result assembler (R-257 T8, AC-003.4 to AC-003.7, card c; amended S2, S6, S9, P4).
 *
 * Diff: hardened git (fixed argv, no shell, GIT_* unset, GIT_CONFIG_NOSYSTEM=1, fsmonitor and hooks off, no external
 * diff or textconv, 10 s timeout). The base is a local branch only (never gh or fetch), checked with
 * `check-ref-format --branch` and passed after `--end-of-options`. Empty when the tree equals the base tip (covers a
 * squash-merged branch) or nothing changed since the merge-base. Totals come from `--shortstat` against the merge-base.
 * Gates: the feature's timeline gate lines whose sha256 is in the ledger `gates/<feature>`, latest round only
 * (`source: model`). T19: a review agent's captured verdict (ledger `verdicts/<feature>`, verdict-capture.ts) written
 * at or after this run's start, on the tree being shipped (outside .oss), replaces that gate's verdict and findings (`source: agent`);
 * `fixed` stays from the line. A captured fail is erased only by a pass from a later review round (finding 4). D24
 * (ship.md: "fail whenever critical or high findings ... are left unfixed at the end of the round"): any unfixed
 * critical or high finding fails the gate; all of them fixed passes it; with none, the block's verdict counts. D27:
 * security and pen-test count medium and low too, and a captured pen-test row adds that optional gate. D26: the result
 * labels how many gates an agent row backs (`gateEvidence`) and names the rest (`uncapturedGates`).
 * Overrides: each decisionId must be a decisions.ndjson record whose line hash, id and feature match a ledger row;
 * `person` is copied from that record, never from the model.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openLedger, LedgerError, type LedgerRow } from './ledger.js';
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

/** `raw` keeps stdout as git printed it (for `-z` output, whose paths may end in spaces). */
function runGit(repo: string, args: string[], okCodes: number[] = [0], raw = false): { status: number; out: string } {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = '1';
  const r = spawnSync('git', ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', ...args], {
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
  return { gate: row.gate, verdict: row.verdict, findings, at, tree: hex(row.tree), trackedTree: hex(row.trackedTree) };
}

const TREE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * True when what the agent reviewed is what ships, outside .oss. Ship's reviews run on the uncommitted tree and ship
 * commits afterwards (only the files it picks), so trees, never HEAD, tie a row to what ships (finding 4):
 * (a) `<tree>` vs HEAD differs only by paths deleted in HEAD, and (b) none of those paths was tracked at review
 * (`<trackedTree>`): an untracked file the reviewer saw and ship left out is fine; a tracked file deleted after the
 * review, or any added or modified file, voids the row. Both trees are strict hex ids (checked by the caller).
 */
function reviewedIsShipped(repo: string, tree: string, trackedTree: string): boolean {
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
    const tracked = runGit(
      repo,
      ['--literal-pathspecs', 'ls-tree', '-r', '--name-only', '-z', '--end-of-options', trackedTree, '--', ...deleted],
      [0],
      true,
    ).out;
    return tracked === '';
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

/** Gates from the feature's ledger-backed timeline lines. */
function timelineGates(ctx: AssembleContext, featureDir: string, gateHashes: Set<unknown>): Timeline {
  const backed: Array<Record<string, unknown>> = [];
  for (const line of repoLines(path.join(featureDir, 'timeline.ndjson'))) {
    if (!gateHashes.has(sha256(line))) continue;
    const rec = parseJsonObject(line);
    if (rec !== null && rec.kind === 'gate' && rec.feature === ctx.feature && typeof rec.round === 'number') {
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

/** The highest round of the gate's lines written at or before `at` (0 when none): the review round a row belongs to. */
function roundAt(lines: RoundLine[], at: number): number {
  return Math.max(0, ...lines.filter((l) => l.at <= at).map((l) => l.round));
}

/**
 * T19: an agent's captured verdict supplies a gate's verdict and findings (`source: agent`); `fixed` stays from the
 * line. Only rows from this ship run (at or after its start) whose reviewed trees match what ships count
 * (reviewedIsShipped, finding 4).
 * The newest counted row wins, except that a failing row is erased only by a passing row from a later review round,
 * i.e. one captured after a newer timeline line of that gate: re-running the agent inside one round never erases a fail.
 */
function applyAgentVerdicts(tl: Timeline, verdictRows: LedgerRow[], runStart: number, repo: string): void {
  const byGate = new Map<string, AgentRow[]>();
  const shipped = new Map<string, boolean>();
  for (const raw of verdictRows) {
    const row = agentRow(raw);
    if (row === null || !(row.at >= runStart) || row.tree === null || row.trackedTree === null) continue;
    const key = `${row.tree} ${row.trackedTree}`;
    if (!shipped.has(key)) shipped.set(key, reviewedIsShipped(repo, row.tree, row.trackedTree));
    if (shipped.get(key) !== true) continue;
    byGate.set(row.gate, [...(byGate.get(row.gate) ?? []), row]);
  }
  for (const [name, rows] of byGate) {
    const zero = counts({});
    const gate = tl.byName.get(name) ?? (name === CAPTURE_ADDS_GATE
      ? { gate: name, verdict: 'pass' as const, findings: zero, fixed: zero, source: 'agent' as const }
      : undefined);
    if (gate === undefined) continue;
    const lines = tl.rounds.get(name) ?? [];
    const judged = rows
      .sort((a, b) => a.at - b.at)
      .map((row) => ({ row, verdict: ruleVerdict(name, row, gate.fixed), round: roundAt(lines, row.at) }));
    let pick = judged[judged.length - 1];
    if (pick.verdict === 'pass') {
      const kept = judged.filter((j) => j.verdict === 'fail' && j.round >= pick.round);
      if (kept.length > 0) pick = kept[kept.length - 1];
    }
    tl.byName.set(name, { ...gate, verdict: pick.verdict, findings: pick.row.findings, source: 'agent' });
  }
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
  try {
    const ledger = openLedger(ctx.repo);
    gateHashes = new Set(ledger.readRows(`gates/${ctx.feature}`).map((r) => r.sha256));
    decisionRows = ledger.readRows(`decisions/${ctx.feature}`);
    verdictRows = ledger.readRows(`verdicts/${ctx.feature}`);
  } catch (e) {
    return { ok: false, error: e instanceof LedgerError ? e.code : 'unsafe_path' };
  }

  const timeline = timelineGates(ctx, featureDir, gateHashes);
  applyAgentVerdicts(timeline, verdictRows, Date.parse(ctx.startedAt), ctx.repo);
  const byName = timeline.byName;
  for (const required of opts.requiredGates ?? DEFAULT_REQUIRED_GATES) {
    if (!byName.has(required)) return { ok: false, error: 'gate_missing', detail: required };
  }
  const gates = [...byName.values()];

  const read = readOverrides(ctx, featureDir, decisionRows);
  if (!read.ok) return read;

  const blockers = gates.filter((g) => g.verdict !== 'pass').map((g) => `gate:${g.gate}`);
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
