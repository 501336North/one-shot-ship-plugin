/**
 * Ship result assembler (R-257 T8, AC-003.4 to AC-003.7, card c; amended S2, S6, S9, P4).
 *
 * Diff: hardened git (fixed argv, no shell, GIT_* unset, GIT_CONFIG_NOSYSTEM=1, fsmonitor and hooks off, no external
 * diff or textconv, 10 s timeout). The base is a local branch only (never gh or fetch), checked with
 * `check-ref-format --branch` and passed after `--end-of-options`. Empty when the tree equals the base tip (covers a
 * squash-merged branch) or nothing changed since the merge-base. Totals come from `--shortstat` against the merge-base.
 * Gates: the feature's timeline gate lines of this run whose sha256 is in the ledger `gates/<feature>`, latest round only
 * (`source: model`). Every captured review-agent row of the feature (ledger `verdicts/<feature>`, verdict-capture.ts; D51:
 * no cutoff, pen F1/L7) then applies, per gate (`source: agent`; `fixed` stays from the line):
 * - D45 (replaces D32's, D36's and D43's pass-based clearing): captured PASS rows decide and clear nothing. Each
 *   captured FAIL row of a gate is open unless the shipped code (HEAD outside .oss) differs from the code that failed
 *   (its reviewed trees, else its headSha's tree; untracked scratch files and empty or .oss-only commits are no change).
 *   D51: the gate is open when any of its fail rows is, with the newest open row's findings, so a revert to code that
 *   already failed stays blocked. An open fail keeps its gate failed, and no fix count overrides it; its blocker reads
 *   `gate:<name> (captured fail, not re-reviewed)`. A fail with neither trees nor headSha does not count (D48).
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
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const REPO_FILE_CAP = 4 * 1024 * 1024;

class GitError extends Error {}

/**
 * `raw` keeps stdout as git printed it (for `-z` output, whose paths may end in spaces). git is the fixed-path binary
 * (gitBin, never PATH; pen N3) run with PATH=/usr/bin:/bin; with none, every call fails (closed).
 */
function runGit(repo: string, args: string[], okCodes: number[] = [0], raw = false, maxBuffer = 1024 * 1024): { status: number; out: string } {
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
    maxBuffer,
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

/**
 * D46/D50 (pen M2a, security 2a): local branch `base` is a safe ship base only when `refs` (the ship-start snapshot,
 * remote ref name to SHA) holds refs/remotes/<remote>/<base> for some one-segment remote name and the base tip is inside
 * that ref's SHA, and the base is neither the current branch nor the feature's own branch or one of its phase branches
 * (`<feature>`, `*\/<feature>/*`). A remote whose name has a slash never matches (fail closed), so `build` never
 * matches origin/feat/<f>/build.
 */
export function shipBaseAllowed(repo: string, base: string, feature: string, refs: ReadonlyMap<string, string>): boolean {
  if (base === feature || base.includes(`/${feature}/`)) return false;
  let current: string | null;
  try {
    current = runGit(repo, ['symbolic-ref', '-q', 'HEAD'], [0, 1]).out;
  } catch {
    return false;
  }
  if (current === `refs/heads/${base}`) return false;
  const tip = branchTip(repo, base);
  if (tip === null) return false;
  for (const [name, sha] of refs) {
    const m = /^refs\/remotes\/[^/]+\/(.+)$/.exec(name);
    if (m?.[1] === base && containedIn(repo, tip, sha)) return true;
  }
  return false;
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

/** Buffer for a -z list of deleted paths (perf L2: about 17,000 paths overflowed 1 MB). */
const PATH_LIST_BUFFER = 64 * 1024 * 1024;
const SHIPPED_CODE = ['--', '.', ':(exclude).oss'];

/**
 * D45: whether the shipped code (HEAD outside .oss) differs from what the agent reviewed. Ship's reviews run on the
 * uncommitted tree and ship commits afterwards (only the files it picks), so `tree` (the reviewed working tree, untracked
 * files included) is compared with HEAD: an added or modified path differs; a deleted path differs only when it was
 * tracked at review (`trackedTree`) or in the commit HEAD was at review (`reviewHead`, pen N4); an untracked file the
 * reviewer saw and ship left out does not (pen M3a). All are strict hex tree-ishes, checked by the caller. 'unknown' on
 * any git error (an object git does not have included).
 * Perf L2: `diff --quiet --diff-filter=d` answers "any added or modified path" with no output at all; only when there is
 * none are the deleted paths listed (-z, a large buffer) and matched against the paths `trackedTree` and `reviewHead`
 * have that HEAD lacks (two more diffs, so no path list ever goes on a command line).
 */
function shippedVsReviewed(repo: string, tree: string, trackedTree: string, reviewHead: string | null): 'same' | 'differs' | 'unknown' {
  const diff = ['diff', '--no-renames', '--no-ext-diff', '--no-textconv'];
  const paths = (filter: string, from: string, to: string): string[] =>
    runGit(repo, [...diff, '--name-only', '-z', `--diff-filter=${filter}`, '--end-of-options', from, to, ...SHIPPED_CODE], [0], true, PATH_LIST_BUFFER)
      .out.split('\0').filter((p) => p !== '');
  try {
    if (runGit(repo, [...diff, '--quiet', '--diff-filter=d', '--end-of-options', tree, 'HEAD', ...SHIPPED_CODE], [0, 1]).status === 1) {
      return 'differs';
    }
    const deleted = paths('D', tree, 'HEAD');
    if (deleted.length === 0) return 'same';
    const wasTracked = new Set(paths('A', 'HEAD', trackedTree));
    if (reviewHead !== null) for (const p of paths('A', 'HEAD', reviewHead)) wasTracked.add(p);
    return deleted.some((p) => wasTracked.has(p)) ? 'differs' : 'same';
  } catch {
    return 'unknown';
  }
}

/**
 * D45: a fail is cleared only when the shipped code differs from the code that failed (shippedVsReviewed): its reviewed
 * trees, else its headSha's tree. Untracked scratch files and empty or .oss-only commits change nothing (pen M3). A fail
 * that cannot be compared (a malformed or partial row, or a git error) stays open; one with neither is dropped (D48).
 */
function failCleared(repo: string, f: FailRow): boolean {
  if (f.tree !== null && f.trackedTree !== null) return shippedVsReviewed(repo, f.tree, f.trackedTree, f.headSha) === 'differs';
  if (f.headSha === null) return false;
  const headTree = `${f.headSha}^{tree}`;
  return shippedVsReviewed(repo, headTree, headTree, null) === 'differs';
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
const NOT_RE_REVIEWED = 'captured fail, not re-reviewed';

/**
 * T19 + D45 + D51: every captured FAIL row of the feature (no cutoff: pen F1, pen L7) is checked against the shipped
 * code (failCleared), so a revert to code that already failed stays blocked. A gate is open when any of its fail rows is
 * not cleared; it is set to fail with the newest open row's findings (`source: agent`, `fixed` stays from the line; D24's
 * fix counts never override it), and returned in the set, so its blocker says "captured fail, not re-reviewed". Captured
 * PASS rows decide and clear nothing (D45: a pass can be minted). With no open fail the timeline line stays (`source:
 * model`, listed in uncapturedGates, D26).
 */
function applyAgentVerdicts(tl: Timeline, verdictRows: LedgerRow[], repo: string): Set<string> {
  const newestOpen = new Map<string, FailRow>();
  for (const raw of verdictRows) {
    const f = failRow(raw);
    if (f === null) continue;
    const prev = newestOpen.get(f.gate);
    if (prev !== undefined && prev.at > f.at) continue;
    if (!failCleared(repo, f)) newestOpen.set(f.gate, f);
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
  const notReReviewed = applyAgentVerdicts(timeline, verdictRows, ctx.repo);
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
