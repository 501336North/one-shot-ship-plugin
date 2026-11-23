/**
 * @behavior When a ship phase ends, the plugin builds the ship result from git (the diff against the base branch),
 *           the feature's ledger-backed timeline gate lines and the person's recorded decisions, so "ready to merge"
 *           is decided by code, not claimed by the model.
 * @business-rule R-257 AC-003.4 to AC-003.7, card c: an empty diff is `empty_diff`; a required gate with no
 *                ledger-backed line is `gate_missing`; every gate passing with no blockers is `ready_to_merge`; an
 *                override needs a ledger-backed decision record (`override_unrecorded` otherwise) and its person is
 *                copied from that record. Git runs hardened (no shell, GIT_* unset, no fsmonitor, local base only).
 * @boundary watcher/src/phase-results/assemble-ship.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { argvChunks, assembleShip, DEFAULT_REQUIRED_GATES } from '../../src/phase-results/assemble-ship.js';
import type { AssembleContext, AssembleOutcome } from '../../src/phase-results/assemble-common.js';
import { openLedger } from '../../src/phase-results/ledger.js';
import { captureVerdict } from '../../src/phase-results/verdict-capture.js';
import { loadPhaseSchema } from '../../src/phase-results/schemas.js';
import { validate } from '../../src/phase-results/validate.js';

/**
 * Perf low 1 (gate round 6): counts the git processes assemble starts. A pass-through spy on the process boundary
 * (git is the collaborator), so every call still runs the real git.
 */
const spawns = vi.hoisted(() => ({
  n: 0,
  args: [] as string[][],
  overflow: null as ((argv: readonly string[]) => boolean) | null,
  // Perf F2 (gate round 12): a call that runs past its time limit, as spawnSync reports it (ETIMEDOUT, SIGTERM)
  timedOut: null as ((argv: readonly string[]) => boolean) | null,
  // each call's time limit (spawnSync's `timeout` option), with its argv
  timeouts: [] as Array<{ argv: string[]; timeout: number | undefined }>,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const spawnSync: typeof real.spawnSync = ((...args: Parameters<typeof real.spawnSync>) => {
    spawns.n += 1;
    // Code-review L4 (gate round 10): the argv too, so a test can tell which git route ran.
    if (Array.isArray(args[1])) spawns.args.push([...(args[1] as readonly string[])]);
    if (Array.isArray(args[1])) {
      const o = args[2] as { timeout?: number } | undefined;
      spawns.timeouts.push({ argv: [...(args[1] as readonly string[])], timeout: o?.timeout });
    }
    if (spawns.timedOut !== null && Array.isArray(args[1]) && spawns.timedOut(args[1] as readonly string[])) {
      const error: NodeJS.ErrnoException = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' });
      return { pid: 0, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: 'SIGTERM', error };
    }
    // Perf L1 (gate round 11): a call whose output overflows its buffer, as spawnSync reports it (ENOBUFS)
    if (spawns.overflow !== null && Array.isArray(args[1]) && spawns.overflow(args[1] as readonly string[])) {
      const error: NodeJS.ErrnoException = Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' });
      return { pid: 0, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: 'SIGTERM', error };
    }
    return real.spawnSync(...args);
  }) as typeof real.spawnSync;
  return { ...real, spawnSync };
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '../../..');
const FEATURE = 'phase-results';
const FAKE_KEY = 'sk-ant-api03-' + 'Ab1'.repeat(30);
// ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
const GATES = ['code-review', 'performance', 'security'];

let repo: string;
let home: string;
let valueDir: string;
let savedHome: string | undefined;
let savedPath: string | undefined;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}

function commitFile(name: string, content: string, message: string): void {
  fs.writeFileSync(path.join(repo, name), content);
  git('add', name);
  git('commit', '-q', '-m', message);
}

beforeEach(() => {
  savedHome = process.env.HOME;
  savedPath = process.env.PATH;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-ship-home-')));
  process.env.HOME = home;
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-ship-repo-')));
  valueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-ship-values-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  // no detached auto gc/maintenance: it would still be writing .git when the temp repo is removed
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  commitFile('a.txt', 'one\ntwo\nthree\n', 'base');
  git('checkout', '-q', '-b', `feat/${FEATURE}/ship`);
});
afterEach(() => {
  spawns.overflow = null;
  spawns.timedOut = null;
  spawns.timeouts = [];
  process.env.HOME = savedHome;
  process.env.PATH = savedPath;
  for (const d of [repo, home, valueDir]) fs.rmSync(d, { recursive: true, force: true });
});

function ctx(): AssembleContext {
  return {
    repo,
    feature: FEATURE,
    startedAt: '2026-11-13T09:00:00.000Z',
    headSha: '0'.repeat(40),
    valueDir,
    now: () => new Date('2026-11-13T10:00:00.000Z'),
  };
}

function featureDir(): string {
  const d = path.join(repo, '.oss', 'dev', 'active', FEATURE);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface GateLine {
  round: number;
  gate: string;
  verdict: 'pass' | 'fail';
  findings?: Record<string, number>;
  fixed?: Record<string, number>;
  ts?: string;
}

/** Appends a timeline gate line; `ledger: true` also writes its hash row, as oss-timeline.sh does. */
function gateLine(g: GateLine, opts: { ledger: boolean } = { ledger: true }): void {
  const line = JSON.stringify({
    v: 1,
    id: randomUUID(),
    ts: g.ts ?? '2026-11-13T09:30:00Z',
    kind: 'gate',
    feature: FEATURE,
    session: 'sess-1',
    round: g.round,
    gate: g.gate,
    verdict: g.verdict,
    findings: g.findings ?? {},
    fixed: g.fixed ?? {},
    mode: 'full',
  });
  fs.appendFileSync(path.join(featureDir(), 'timeline.ndjson'), `${line}\n`);
  if (opts.ledger) openLedger(repo).appendRow(`gates/${FEATURE}`, { sha256: sha256(line) });
}

function allPass(round = 1): void {
  for (const gate of GATES) gateLine({ round, gate, verdict: 'pass' });
}

/** Appends a decision record line; `ledger: true` also writes its ledger row, as oss-decision-record.sh does. */
function decision(person: unknown, opts: { ledger: boolean } = { ledger: true }): { id: string; line: string } {
  const id = randomUUID();
  const line = JSON.stringify({ v: 1, id, feature: FEATURE, question: 'Defer the LOW finding?', person });
  fs.appendFileSync(path.join(featureDir(), 'decisions.ndjson'), `${line}\n`);
  if (opts.ledger) openLedger(repo).appendRow(`decisions/${FEATURE}`, { id, feature: FEATURE, sha256: sha256(line) });
  return { id, line };
}

function result(o: AssembleOutcome): Record<string, unknown> {
  if (!o.ok) throw new Error(`expected ok, got ${o.error} ${o.detail ?? ''}`);
  return o.result;
}

/**
 * A review agent's transcript under ~/.claude/projects whose final message is `text`: the only place the capture reads
 * a verdict from (D41).
 */
function agentTranscript(text: string): string {
  const dir = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agent-${randomUUID()}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text }] } }) + '\n');
  return file;
}

function errorOf(o: AssembleOutcome): string {
  if (o.ok) throw new Error('expected a failure');
  return o.error;
}

function ship(extra: { base?: string; requiredGates?: readonly string[]; remoteRefs?: ReadonlyMap<string, string> } = {}): AssembleOutcome {
  return assembleShip(ctx(), { base: 'main', ...extra });
}

/**
 * Gate round 12 performance F2 (D77): on a repo with many loose objects `diff --shortstat` (and `diff --quiet`, on the
 * same path) can take longer than runGit's fixed 10 s, which gave a bare diff_unavailable. Both now share the assemble's
 * diff budget, 20 s in all (the hook gives assemble 30 s), and running past it gives diff_unavailable with its own hint:
 * run git gc and try again.
 */
describe('assembleShip: the diff totals get the diff budget and a git gc hint on timeout (perf F2, gate round 12)', () => {
  const isTotals = (a: readonly string[]): boolean => a.includes('--shortstat') || a.includes('--quiet');

  it('diff --quiet and diff --shortstat run with more than 10 s, within 20 s together', () => {
    commitFile('b.txt', 'x\n', 'feature');
    allPass();
    expect(result(ship()).verdict).toBe('ready_to_merge');
    const totals = spawns.timeouts.filter((c) => isTotals(c.argv));
    expect(totals.length).toBe(2);
    for (const c of totals) {
      expect(c.timeout).toBeGreaterThan(10_000);
      expect(c.timeout).toBeLessThanOrEqual(20_000);
    }
  });

  it('a diff --shortstat that runs past its budget gives diff_unavailable with the git gc hint', () => {
    commitFile('b.txt', 'x\n', 'feature');
    allPass();
    spawns.timedOut = (a) => a.includes('--shortstat');
    const o = ship();
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.error).toBe('diff_unavailable');
    expect(o.detail).toMatch(/^diff_timeout: /);
    expect(o.detail).toContain('run git gc');
  });
});

describe('assembleShip: diff', () => {
  // Behaviour: the ship result names the merge-base and the size of the change.
  // Rule: AC-003.4, diff.base is the merge-base sha and the totals come from git, not the model.
  it('diff.base equals the merge-base, and the totals match git', () => {
    commitFile('a.txt', 'one\nTWO\nthree\nfour\n', 'edit');
    commitFile('b.txt', 'x\ny\n', 'add');
    allPass();
    const r = result(ship());
    const diff = r.diff as Record<string, number | string>;
    expect(diff.base).toBe(git('merge-base', 'main', 'HEAD'));
    expect(diff).toMatchObject({ files: 2, insertions: 4, deletions: 1 });
    expect(r.headSha).toBe(git('rev-parse', 'HEAD'));
  });

  // Behaviour: shipping a branch with no commits of its own fails.
  // Rule: AC-003.4, base equals head is empty_diff.
  it('base equal to head gives empty_diff', () => {
    allPass();
    expect(errorOf(ship())).toBe('empty_diff');
  });

  // Behaviour: shipping a branch that was already squash-merged fails instead of opening an empty PR.
  // Rule: AC-003.4, a tree equal to the base tree is empty_diff.
  it('an already squash-merged branch gives empty_diff', () => {
    commitFile('b.txt', 'feature\n', 'feature work');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--squash', `feat/${FEATURE}/ship`);
    git('commit', '-q', '-m', 'squash');
    git('checkout', '-q', `feat/${FEATURE}/ship`);
    allPass();
    expect(errorOf(ship())).toBe('empty_diff');
  });

  // Behaviour: a base name that looks like a git option cannot steer git.
  // Rule: S9, the base is validated with check-ref-format and passed after --end-of-options.
  it('a base named --output=x is refused', () => {
    commitFile('b.txt', 'x\n', 'add');
    allPass();
    expect(errorOf(ship({ base: '--output=x' }))).toBe('diff_unavailable');
    expect(fs.existsSync(path.join(repo, 'x'))).toBe(false);
  });

  // Behaviour: a repo cannot run its own program when the plugin reads the diff.
  // Rule: S9, git runs with core.fsmonitor and hooks disabled.
  it('a configured core.fsmonitor script does not run', () => {
    commitFile('b.txt', 'x\n', 'add');
    const marker = path.join(home, 'fsmonitor-ran');
    const script = path.join(home, 'fsmonitor.sh');
    fs.writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    git('config', 'core.fsmonitor', script);
    allPass();
    result(ship());
    expect(fs.existsSync(marker)).toBe(false);
  });

  // Behaviour: a large change is counted correctly.
  // Rule: P4, totals come from --shortstat, which stays small however many files change.
  it('5k changed files give matching totals', () => {
    const dir = path.join(repo, 'many');
    fs.mkdirSync(dir);
    for (let i = 0; i < 5000; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), `${i}\n`);
    git('add', 'many');
    git('commit', '-q', '-m', 'many');
    allPass();
    const diff = result(ship()).diff as Record<string, number>;
    expect(diff).toMatchObject({ files: 5000, insertions: 5000, deletions: 0 });
  }, 60_000); // writing and committing 5k files outlives the 5 s default on a loaded machine

  // Behaviour: ship works on a machine with no GitHub CLI.
  // Rule: S9, the base comes from a local ref only, never gh or fetch.
  it('works with gh absent from PATH', () => {
    commitFile('b.txt', 'x\n', 'add');
    allPass();
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-ship-bin-'));
    const gitPath = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf-8' }).trim();
    fs.symlinkSync(gitPath, path.join(bin, 'git'));
    process.env.PATH = bin;
    try {
      expect((result(ship()).diff as Record<string, number>).files).toBe(1);
    } finally {
      process.env.PATH = savedPath;
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe('assembleShip: gates and verdict', () => {
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  // Behaviour: the gates the person saw run are listed in the result, marked as model-reported.
  // Rule: AC-003.5, latest-round ledger-backed gate lines become gates[] with source model.
  it('ledger-backed gate lines of the latest round become gates with source model', () => {
    // ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
    gateLine({ round: 1, gate: 'security', verdict: 'fail', findings: { high: 1 } });
    gateLine({ round: 2, gate: 'code-review', verdict: 'pass', findings: { low: 2 }, fixed: { low: 1 } });
    gateLine({ round: 2, gate: 'performance', verdict: 'pass' });
    gateLine({ round: 2, gate: 'security', verdict: 'pass' });
    const r = result(ship());
    const gates = r.gates as Array<Record<string, unknown>>;
    expect(gates).toHaveLength(3);
    expect(gates[0]).toEqual({
      // ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
      gate: 'code-review',
      verdict: 'pass',
      findings: { critical: 0, high: 0, medium: 0, low: 2, info: 0 },
      fixed: { critical: 0, high: 0, medium: 0, low: 1, info: 0 },
      source: 'model',
    });
    expect(gates.every((g) => g.source === 'model' && g.verdict === 'pass')).toBe(true);
  });

  // Behaviour: ship cannot finish when a required review never ran.
  // Rule: AC-003.5, a required gate with no line is gate_missing.
  it('a required gate missing gives gate_missing', () => {
    // ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    expect(errorOf(ship())).toBe('gate_missing');
  });

  // Behaviour: a gate line typed into the repo file by hand does not count as a review.
  // Rule: S2, only gate lines whose hash is in the private ledger count; a planted line is gate_missing.
  it('a planted gate line gives gate_missing', () => {
    // ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' }, { ledger: false });
    expect(errorOf(ship())).toBe('gate_missing');
  });

  // Behaviour: the required gate list can be set by the caller.
  // Rule: the default list is the default quality_gates agents; a caller may require others.
  it('the required gate list is injectable', () => {
    expect([...DEFAULT_REQUIRED_GATES]).toEqual(GATES);
    gateLine({ round: 1, gate: 'tests', verdict: 'pass' });
    expect(result(ship({ requiredGates: ['tests'] })).verdict).toBe('ready_to_merge');
  });

  // Behaviour: when every review passed, the person is told the branch is ready and nothing holds it.
  // Rule: card c / AC-003.6, all gates pass and blockers empty gives ready_to_merge.
  it('all passing gives ready_to_merge with blockers []', () => {
    allPass();
    const r = result(ship());
    expect(r.verdict).toBe('ready_to_merge');
    expect(r.blockers).toEqual([]);
  });

  // Behaviour: a failing review holds the merge and is named.
  // Rule: AC-003.6, a failing gate gives blocked with the gate listed in blockers.
  it('a failing gate gives blocked with the blocker listed', () => {
    // ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'fail', findings: { high: 1 } });
    const r = result(ship());
    expect(r.verdict).toBe('blocked');
    // ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
    expect(r.blockers).toEqual(['gate:security']);
  });
});

describe('assembleShip: overrides', () => {
  beforeEach(() => {
    commitFile('b.txt', 'x\n', 'add');
    allPass();
  });

  function overrides(list: Array<{ finding: string; decisionId: string }>): void {
    fs.writeFileSync(path.join(valueDir, 'overrides.json'), JSON.stringify(list));
  }

  // Behaviour: an accepted finding names the person's recorded answer, never a name the model chose.
  // Rule: AC-003.7 / D12, person is copied from the ledger-backed decision record.
  it('an override copies person from a ledger-backed record', () => {
    const { id } = decision({ status: 'unverified' });
    overrides([{ finding: 'LOW: verbose log', decisionId: id }]);
    const r = result(ship());
    expect(r.overrides).toEqual([
      { finding: 'LOW: verbose log', decisionId: id, person: JSON.stringify({ status: 'unverified' }) },
    ]);
    expect((r.sources as Record<string, string>).overrides).toBe('code');
  });

  // Behaviour: a decision written into the repo file by hand cannot justify an override.
  // Rule: S6 / FOLLOWUPS 192, an id only in the repo file is override_unrecorded.
  it('a repo-only decision id gives override_unrecorded', () => {
    const { id } = decision({ status: 'unverified' }, { ledger: false });
    overrides([{ finding: 'LOW: verbose log', decisionId: id }]);
    expect(errorOf(ship())).toBe('override_unrecorded');
  });

  // Behaviour: changing who answered after the fact voids the override.
  // Rule: S6, the record line's hash must match its ledger row; an edited person is override_unrecorded.
  it('an edited person gives override_unrecorded', () => {
    const { id, line } = decision({ status: 'unverified' });
    const file = path.join(featureDir(), 'decisions.ndjson');
    const edited = line.replace('"status":"unverified"', '"status":"verified","name":"boss"');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace(line, edited));
    overrides([{ finding: 'LOW: verbose log', decisionId: id }]);
    expect(errorOf(ship())).toBe('override_unrecorded');
  });
});

describe('assembleShip: summary and schema', () => {
  beforeEach(() => {
    commitFile('b.txt', 'x\n', 'add');
    allPass();
  });

  // Behaviour: a key pasted into the ship summary never reaches the committed result.
  // Rule: model text is redacted through the shared redaction.
  it('the summary is redacted', () => {
    fs.writeFileSync(path.join(valueDir, 'summary.txt'), `Shipped. key ${FAKE_KEY}`);
    const r = result(ship());
    expect(r.summary).toContain('[REDACTED]');
    expect(r.summary).not.toContain(FAKE_KEY);
    expect((r.sources as Record<string, string>).summary).toBe('model');
  });

  // Behaviour: the ship result is accepted by the checker the complete step runs.
  // Rule: the assembled result passes ship.schema.json.
  it('the result passes the ship schema', () => {
    const { id } = decision({ status: 'unverified' });
    fs.writeFileSync(
      path.join(valueDir, 'overrides.json'),
      JSON.stringify([{ finding: 'LOW: verbose log', decisionId: id }]),
    );
    fs.writeFileSync(path.join(valueDir, 'summary.txt'), 'Ready.');
    const r = result(ship());
    expect(validate(loadPhaseSchema('ship', PLUGIN_ROOT), r)).toEqual({ ok: true });
    expect(r.sources).toMatchObject({ diff: 'code', gates: 'model', overrides: 'code', summary: 'model' });
  });
});

/**
 * R-257 T19 (D6): a review agent's own verdict block, captured at SubagentStop into the ledger `verdicts/<feature>`,
 * supplies the gate's verdict and findings (`source: agent`). `fixed` stays from the timeline line. A row from before
 * this ship run started, or no row, leaves the timeline line as it is (`source: model`). Ship's rule still holds: a
 * gate with critical or high findings fails, whatever the agent's block said.
 */
describe('assembleShip: captured agent verdicts (T19)', () => {
  const REVIEW_GATES = ['code-review', 'security'];
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  // ⚠ changes existing test: finding 4 (round 1 security, coordinator fix) — a captured row counts only when its
  //   reviewed tree is the shipped tree, so the helper records the current (clean) tree, as both `tree` and
//   `trackedTree`, as the capture CLI does.
  // ⚠ changes existing test: D45 dead code — rows no longer carry `start` (it was a pass row with start: match).
  function captured(row: { gate: string; verdict: 'pass' | 'fail'; findings: Record<string, number>; ts: string }): void {
    const tree = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, { tree, trackedTree: tree, ...row, agent: 'agent-1', session: 'sess-1' });
  }

  function gatesOf(o: AssembleOutcome): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const g of result(o).gates as Array<Record<string, unknown>>) out[g.gate as string] = g;
    return out;
  }

  const shipReview = (): AssembleOutcome => ship({ requiredGates: REVIEW_GATES });

  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  // Behaviour: the person sees the review agent's own verdict and counts, not the main model's retelling of them.
  it('a captured row after the run start overrides the verdict and findings, keeps fixed, and marks source agent', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass', findings: { low: 1 }, fixed: { low: 1 } });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'fail', findings: { ...ZERO, medium: 3, low: 2 }, ts: '2026-11-13T09:10:00.000Z' });
    const g = gatesOf(shipReview());
    expect(g['code-review']).toEqual({
      gate: 'code-review',
      verdict: 'fail',
      findings: { ...ZERO, medium: 3, low: 2 },
      fixed: { ...ZERO, low: 1 },
      source: 'agent',
    });
    expect(g.security.source).toBe('model');
  });

  // Behaviour: restarting the ship run does not wipe a reviewer's fail; it stays open until re-review.
  // ⚠ changes existing test: pen test F1 (round 3) — an open fail no longer depends on the run start (it was
  //   "a captured row from before the ship run started is ignored").
  it('a captured fail from before the ship run started still blocks (a restarted run)', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, ts: '2026-11-13T08:59:59.000Z' });
    const g = gatesOf(shipReview());
    expect(g['code-review']).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // Behaviour: an agent that left no block does not stop the ship; today's timeline line still counts.
  it('with no captured row the timeline line stays, with source model', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass', findings: { info: 1 } });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    const g = gatesOf(shipReview());
    expect(g['code-review']).toEqual({
      gate: 'code-review',
      verdict: 'pass',
      findings: { ...ZERO, info: 1 },
      fixed: ZERO,
      source: 'model',
    });
  });

  // Behaviour: once the failed code is fixed, the gate falls back to its timeline line.
  // ⚠ changes existing test: D45 (fails only) — the fix commit clears the fail, not the later pass, so the gate keeps its line
  //   (`source: model`); it was "the latest captured row of a gate wins" (the pass became the verdict).
  it('a fail cleared by a fix commit leaves the gate to its timeline line', () => {
    gateLine({ round: 2, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 2, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'fail', findings: { ...ZERO, medium: 1 }, ts: '2026-11-13T09:10:00.000Z' });
    commitFile('b.txt', 'fixed\n', 'fix the finding');
    captured({ gate: 'code-review', verdict: 'pass', findings: ZERO, ts: '2026-11-13T09:40:00.000Z' });
    const r = result(shipReview());
    expect(gatesOf(shipReview())['code-review']).toMatchObject({ verdict: 'pass', findings: ZERO, source: 'model' });
    expect(r.verdict).toBe('ready_to_merge');
  });

  // Behaviour: a captured pass is not evidence (it can be minted), whatever findings it reports; the line decides.
  // ⚠ changes existing test: D45 (fails only) — it was "a captured pass with high findings gives a failing gate, source agent, and
  //   blocks the ship"; D24/D27's rule on a captured pass is gone with the pass.
  it('a captured pass with high findings changes nothing: the timeline line decides', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'security', verdict: 'pass', findings: { ...ZERO, high: 2 }, ts: '2026-11-13T09:10:00.000Z' });
    const r = result(shipReview());
    expect(gatesOf(shipReview()).security).toMatchObject({ verdict: 'pass', findings: ZERO, source: 'model' });
    expect(r.verdict).toBe('ready_to_merge');
  });

  // D24 (user pick 2026-11-18): ship's rule counts the round's fixes ("left unfixed at the end of the round");
  // `fixed` comes from that round's timeline line.
  function fixedCase(capturedVerdict: 'pass' | 'fail', findings: Record<string, number>, fixed: Record<string, number>): Record<string, unknown> {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass', fixed });
    captured({ gate: 'security', verdict: capturedVerdict, findings: { ...ZERO, ...findings }, ts: '2026-11-13T09:10:00.000Z' });
    return result(shipReview());
  }

  // ⚠ changes existing test: D45 (fails only) — replaces "D24: captured high=2 all fixed ... gives pass, source agent", "D24: captured
  //   high=2 with one fixed gives fail" and "D24: a fix counted under the wrong severity does not clear a critical
  //   finding": D24's rule read the fix counts against a captured pass, which no longer counts.
  it('D24: a captured pass, its findings fixed or not, leaves the gate to its line', () => {
    const r = fixedCase('pass', { high: 2 }, { high: 1 });
    expect(gatesOf(shipReview()).security).toMatchObject({ verdict: 'pass', source: 'model', fixed: { ...ZERO, high: 1 } });
    expect(r.blockers).toEqual([]);
  });

  // ⚠ changes existing test: D32 (user pick, ship round 2) — D24's fix counts never override a captured fail row; it now blocks until re-review.
  it("D24: the agent's fail about a high finding that was fixed still fails (D32)", () => {
    fixedCase('fail', { high: 1 }, { high: 1 });
    expect(gatesOf(shipReview()).security).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a captured fail with zero critical and high still fails', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'fail', findings: ZERO, ts: '2026-11-13T09:10:00.000Z' });
    expect(gatesOf(shipReview())['code-review']).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // Behaviour: a captured row never adds a gate the timeline does not show, so a required gate still needs its line.
  it('a captured row alone does not satisfy a required gate', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    captured({ gate: 'security', verdict: 'pass', findings: ZERO, ts: '2026-11-13T09:10:00.000Z' });
    expect(errorOf(shipReview())).toBe('gate_missing');
  });

  // Behaviour: a garbled ledger row is ignored rather than trusted.
  it('a captured row with a malformed shape is ignored', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, { gate: 'code-review', verdict: 'fail', findings: 'lots', ts: '2026-11-13T09:10:00.000Z' });
    expect(gatesOf(shipReview())['code-review']).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // Behaviour: the code-reviewer's own block lands on ship's code-review gate, with the default required gates.
  // Rule: R-257 T27 + T19, the capture maps code-reviewer to code-review, the gate.txt name the timeline holds.
  it('a captured code-reviewer block overrides the code-review gate under the default required gates', () => {
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass' });
    const block = '```oss-verdict\n' + JSON.stringify({ verdict: 'fail', findings: { ...ZERO, medium: 4 } }) + '\n```';
    const out = captureVerdict(
      // ⚠ changes existing test: D41 — the verdict is read only from the agent transcript, never last_assistant_message.
      { session_id: 's1', agent_id: 'a1', agent_type: 'oss:code-reviewer', cwd: repo, agent_transcript_path: agentTranscript(block) },
      { now: () => new Date('2026-11-13T09:10:00.000Z') },
    );
    expect(out).toEqual({ captured: true, gate: 'code-review', feature: FEATURE });
    const r = result(ship());
    expect(gatesOf(ship())['code-review']).toMatchObject({ verdict: 'fail', findings: { ...ZERO, medium: 4 }, source: 'agent' });
    // ⚠ changes existing test: D32 (user pick, ship round 2) — a gate held by a captured fail carries the "not re-reviewed" label.
    // ⚠ changes existing test: D57 — the label also says a tracked code change is needed to clear it.
    expect(r.blockers).toEqual(['gate:code-review (captured fail, not re-reviewed: a tracked code change is needed to clear it)']);
  });

  // ⚠ changes existing test: D45 (fails only) — only an open captured fail makes an agent gate, so the row is a fail (it was a pass).
  it('a result with agent gates passes the ship schema', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'fail', findings: ZERO, ts: '2026-11-13T09:10:00.000Z' });
    expect(validate(loadPhaseSchema('ship', PLUGIN_ROOT), result(shipReview()))).toEqual({ ok: true });
  });
});

/**
 * D26 (user pick 2026-11-18, "Pass, but label it"): a required gate with no captured agent row keeps its timeline
 * line (`source: model`) and still passes, but the ship result must not look agent-verified. `gateEvidence` says
 * whether every gate (agent), some (partial) or none (model) came from a captured agent verdict, and
 * `uncapturedGates` names the gates that did not, so the complete notice can name them (like D15's evidenceTrust).
 */
describe('assembleShip: gate evidence label (D26)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  // ⚠ changes existing test: D45 dead code — rows no longer carry `start` (it was a pass row with start: match).
  // ⚠ changes existing test: D45 (fails only) — only an open captured fail backs a gate now, so the helper records a fail (it was a pass).
  function captured(gate: string): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate, verdict: 'fail', findings: ZERO, agent: 'a', session: 's', ts: '2026-11-13T09:10:00.000Z',
      tree: git('rev-parse', 'HEAD^{tree}'),
      trackedTree: git('rev-parse', 'HEAD^{tree}'),
    });
  }

  it('no captured row: passes, labelled model, every gate named', () => {
    allPass();
    const r = result(ship());
    expect(r.verdict).toBe('ready_to_merge');
    expect(r.gateEvidence).toBe('model');
    expect(r.uncapturedGates).toEqual(GATES);
    expect(r.sources).toMatchObject({ gateEvidence: 'code', uncapturedGates: 'code' });
  });

  it('some captured rows: labelled partial, naming only the uncaptured gates', () => {
    allPass();
    captured('security');
    const r = result(ship());
    expect(r.gateEvidence).toBe('partial');
    expect(r.uncapturedGates).toEqual(['code-review', 'performance']);
  });

  it('every gate captured: labelled agent, none named', () => {
    allPass();
    for (const g of GATES) captured(g);
    const r = result(ship());
    expect(r.gateEvidence).toBe('agent');
    expect(r.uncapturedGates).toEqual([]);
  });

  it('a labelled result passes the ship schema', () => {
    allPass();
    captured('security');
    expect(validate(loadPhaseSchema('ship', PLUGIN_ROOT), result(ship()))).toEqual({ ok: true });
  });
});

describe('assembleShip: security and pen-test gates fail on LOW or above (D27)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  // ⚠ changes existing test: D45 dead code — rows no longer carry `start` (it was a pass row with start: match).
  function captured(gate: string, verdict: 'pass' | 'fail', findings: Record<string, number>): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate, verdict, findings: { ...ZERO, ...findings }, agent: 'a', session: 's', ts: '2026-11-13T09:40:00.000Z',
      tree: git('rev-parse', 'HEAD^{tree}'),
      trackedTree: git('rev-parse', 'HEAD^{tree}'),
    });
  }

  function gateOf(name: string, fixed: Record<string, number> = {}): Record<string, unknown> | undefined {
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass', fixed: gate === name ? fixed : {} });
    const r = result(ship());
    return (r.gates as Array<Record<string, unknown>>).find((g) => g.gate === name);
  }

  // ⚠ changes existing test: D45 (fails only) — removed "security: an unfixed LOW finding fails, even when the agent said pass",
  //   "security: MEDIUM and LOW findings all fixed in the round pass", "security: a fix under the wrong severity does
  //   not clear a MEDIUM finding" and "code-review: an unfixed LOW finding with the agent passing still passes (D24)":
  //   each read D24/D27's counts from a captured pass, which no longer decides anything (see the D45 block).

  // ⚠ changes existing test: D32 (user pick, ship round 2) — D24/D27 fix counts never override a captured fail row.
  it("security: the agent's fail about a LOW finding that was fixed still fails (D32)", () => {
    captured('security', 'fail', { low: 1 });
    expect(gateOf('security', { low: 1 })).toMatchObject({ verdict: 'fail' });
  });

  it("security: with only INFO findings the agent's own fail counts", () => {
    captured('security', 'fail', { info: 2 });
    expect(gateOf('security')).toMatchObject({ verdict: 'fail' });
  });

  // Rule: D27, a captured pen-test fail blocks even though pen-test is optional and has no timeline line.
  // ⚠ changes existing test: D45 (fails only) — the row is a fail (it was a pass with an unfixed LOW finding, failed by D27's rule).
  it('pen-test: a captured fail with a LOW finding adds a failing pen-test gate and blocks', () => {
    allPass();
    captured('pen-test', 'fail', { low: 1 });
    const r = result(ship());
    expect((r.gates as Array<Record<string, unknown>>).find((g) => g.gate === 'pen-test')).toEqual({
      gate: 'pen-test', verdict: 'fail', findings: { ...ZERO, low: 1 }, fixed: ZERO, source: 'agent',
    });
    expect(r.verdict).toBe('blocked');
    // ⚠ changes existing test: D57 — the label also says a tracked code change is needed to clear it.
    expect(r.blockers).toEqual(['gate:pen-test (captured fail, not re-reviewed: a tracked code change is needed to clear it)']);
  });

  // ⚠ changes existing test: D45 (fails only) — a captured pass adds nothing (it was "a captured clean pass adds a passing pen-test gate").
  it('pen-test: a captured clean pass adds no pen-test gate', () => {
    allPass();
    captured('pen-test', 'pass', {});
    const r = result(ship());
    expect((r.gates as Array<Record<string, unknown>>).map((g) => g.gate)).toEqual(GATES);
    expect(r.verdict).toBe('ready_to_merge');
  });

  // ⚠ changes existing test: pen test F1 (round 3) — a fail from before the run start stays open (it was
  //   "pen-test: a row from before the run started adds nothing").
  it('pen-test: a fail from before the run started still adds a failing pen-test gate', () => {
    allPass();
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'pen-test', verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T08:00:00.000Z', tree: git('rev-parse', 'HEAD^{tree}'), trackedTree: git('rev-parse', 'HEAD^{tree}'),
    });
    const r = result(ship());
    expect((r.gates as Array<Record<string, unknown>>).find((g) => g.gate === 'pen-test')).toMatchObject({ verdict: 'fail' });
    expect(r.verdict).toBe('blocked');
  });

  // Only a captured pen-test row adds a gate; any other captured gate still needs its timeline line.
  it('a captured row for another gate with no line still gives gate_missing', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    captured('security', 'pass', {});
    expect(errorOf(ship())).toBe('gate_missing');
  });
});

/**
 * Round 1 security finding 4 (replay and re-roll): a captured row counts only when the tree it reviewed is the tree
 * being shipped (outside .oss), and a captured fail is erased only by a later pass taken after a NEWER timeline round line for that gate
 * (a real re-review), never by re-running the agent inside the same round.
 */
describe('assembleShip: captured rows cannot be replayed or re-rolled (finding 4)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  // ⚠ changes existing test: D45 dead code — rows no longer carry `start` (it was a pass row with start: match).
  function captured(verdict: 'pass' | 'fail', ts: string, tree = git('rev-parse', 'HEAD^{tree}')): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict, findings: ZERO, agent: 'a', session: 's', ts, tree, trackedTree: tree,
    });
  }

  function codeReview(): Record<string, unknown> | undefined {
    return (result(ship()).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');
  }

  function otherGates(round: number, ts: string): void {
    for (const gate of ['performance', 'security']) gateLine({ round, gate, verdict: 'pass', ts });
  }

  it('a fail then a pass in the same round still fails', () => {
    captured('fail', '2026-11-13T09:10:00.000Z');
    captured('pass', '2026-11-13T09:12:00.000Z');
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass', ts: '2026-11-13T09:20:00Z' });
    otherGates(1, '2026-11-13T09:20:00Z');
    expect(codeReview()).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // ⚠ changes existing test: D32 (user pick, ship round 2) — the round 2 pass clears the fail only on a changed tree, so the fix is committed.
  it('a fail in round 1, then a fix, a round 2 line and a pass on the fixed tree passes', () => {
    captured('fail', '2026-11-13T09:10:00.000Z');
    gateLine({ round: 1, gate: 'code-review', verdict: 'fail', ts: '2026-11-13T09:20:00Z' });
    otherGates(1, '2026-11-13T09:20:00Z');
    commitFile('b.txt', 'fixed\n', 'fix the finding');
    captured('pass', '2026-11-13T09:30:00.000Z');
    gateLine({ round: 2, gate: 'code-review', verdict: 'pass', ts: '2026-11-13T09:40:00Z' });
    otherGates(2, '2026-11-13T09:40:00Z');
    // ⚠ changes existing test: D45 (fails only) — the fix clears the fail and the round 2 line decides (`source: model`, was agent).
    expect(codeReview()).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  it("another gate's newer line is not a re-review of this gate: the fail stays", () => {
    captured('fail', '2026-11-13T09:10:00.000Z');
    otherGates(1, '2026-11-13T09:15:00Z');
    captured('pass', '2026-11-13T09:17:00.000Z');
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass', ts: '2026-11-13T09:20:00Z' });
    expect(codeReview()).toMatchObject({ verdict: 'fail' });
  });

  // ⚠ changes existing test: D32 (user pick, ship round 2) — a captured fail on any tree blocks until re-review.
  // ⚠ changes existing test: D45 (fails only) — the shipped code now differs from the failed code, so the fail is cleared and the line
  //   decides (it was "a fail captured on an older tree still blocks (D32)").
  it('a fail captured on an older tree is cleared once different code ships', () => {
    const old = git('rev-parse', 'HEAD^{tree}');
    captured('fail', '2026-11-13T09:10:00.000Z', old);
    commitFile('c.txt', 'y\n', 'more');
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass' });
    expect(codeReview()).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  it('a pass captured on an older tree is ignored', () => {
    const old = git('rev-parse', 'HEAD^{tree}');
    captured('pass', '2026-11-13T09:10:00.000Z', old);
    commitFile('c.txt', 'y\n', 'more');
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass' });
    expect(codeReview()).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // ⚠ changes existing test: D32 (user pick, ship round 2) — a captured fail with no tree still blocks; a pass with none is ignored.
  it('a fail with no tree (only a headSha) blocks; a pass with none is ignored', () => {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: ZERO, agent: 'a', session: 's', ts: '2026-11-13T09:10:00.000Z',
      headSha: git('rev-parse', 'HEAD'),
    });
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass' });
    expect(codeReview()).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a pass row with no tree (only a headSha) is ignored', () => {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'pass', findings: ZERO, agent: 'a', session: 's', ts: '2026-11-13T09:10:00.000Z',
      headSha: git('rev-parse', 'HEAD'),
    });
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass' });
    expect(codeReview()).toMatchObject({ verdict: 'pass', source: 'model' });
  });
});

/**
 * D32 (user pick, ship round 2): a captured FAIL from this run, on any tree, keeps its gate failed until a later pass
 * from the same gate's reviewer on a DIFFERENT reviewed tree (that pass's tree being the shipped one). A pass on the
 * unchanged tree never erases it, whatever round lines exist (pen F3; code-review LOW: an edit dropped a fail).
 */
describe('assembleShip: a captured fail blocks until re-review on a changed tree (D32)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  function captured(verdict: 'pass' | 'fail', ts: string, tree = git('rev-parse', 'HEAD^{tree}')): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict, findings: ZERO, agent: 'a', session: 's', ts, tree, trackedTree: tree,
      headSha: git('rev-parse', 'HEAD'),
    });
  }

  function codeReview(o: AssembleOutcome): Record<string, unknown> | undefined {
    return (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');
  }

  // ⚠ changes existing test: D45 (fails only) — a tracked edit is a change to the shipped code, so it clears the fail and the model
  //   line decides (it was "fail, then an edit, then a model pass line: still blocked, labelled not re-reviewed").
  //   With no edit the fail stays open, labelled not re-reviewed (the D45 block).
  it('fail, then a tracked edit, then a model pass line: cleared, the line decides', () => {
    captured('fail', '2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'edited\n', 'edit after the review');
    allPass(1);
    const o = ship();
    expect(codeReview(o)).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(result(o).verdict).toBe('ready_to_merge');
  });

  // Behaviour: re-running the reviewer on unchanged code cannot re-roll a fail away, even after a new round line.
  it('fail, then a same-tree pass after a round line: still blocked', () => {
    captured('fail', '2026-11-13T09:10:00.000Z');
    allPass(1);
    for (const gate of GATES) gateLine({ round: 2, gate, verdict: 'pass', ts: '2026-11-13T09:40:00Z' });
    captured('pass', '2026-11-13T09:45:00.000Z');
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // Behaviour: fixing the code clears the fail.
  // ⚠ changes existing test: D45 (fails only) — the gate keeps its line (`source: model`, was agent): the reviewer's pass decides nothing.
  it('fail, a fixed tree, then a reviewer pass on the shipped tree: passes', () => {
    captured('fail', '2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'fixed\n', 'fix the finding');
    captured('pass', '2026-11-13T09:30:00.000Z');
    allPass(1);
    const o = ship();
    expect(codeReview(o)).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(result(o).verdict).toBe('ready_to_merge');
  });

  // Rule: D24's fix counts never override a captured fail row.
  it("a fail about a high finding the round line says was fixed still blocks", () => {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', tree: git('rev-parse', 'HEAD^{tree}'), trackedTree: git('rev-parse', 'HEAD^{tree}'),
    });
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass', findings: { high: 1 }, fixed: { high: 1 } });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail' });
  });
});

/**
 * D36 (user pick, ship round 3), replaced by D45: a pass captured with no tree (a changed file over 50 MB, or the capture
 * deadline) used to clear an earlier fail on a new commit. Under D45 no pass clears anything: the fail clears only when
 * the shipped code differs from the failed code, and the gate then falls back to its line, `source: model` (D26).
 * ⚠ changes existing test: D45 (fails only) — the cases below now follow the code change, never the no-tree pass.
 */
describe('assembleShip: a pass with no tree clears nothing; the code change does (D36, D45)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  function row(verdict: 'pass' | 'fail', ts: string, extra: Record<string, unknown>): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict, findings: ZERO, agent: 'a', session: 's', ts, headSha: git('rev-parse', 'HEAD'), ...extra,
    });
  }
  const failHere = (ts: string): void => row('fail', ts, { tree: git('rev-parse', 'HEAD^{tree}'), trackedTree: git('rev-parse', 'HEAD^{tree}') });
  // ⚠ changes existing test: D45 dead code — the fixture row has no `start` field any more.
  const blindPass = (ts: string): void => row('pass', ts, { tree: '', trackedTree: '' });

  function codeReview(o: AssembleOutcome): Record<string, unknown> | undefined {
    return (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');
  }

  // Behaviour: a fix committed and re-reviewed (even if the capture could not hash the tree) unblocks the ship.
  it('fail on commit A, then a no-tree pass on commit B: not blocked, the gate falls back to its line (source model)', () => {
    failHere('2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'fixed\n', 'fix');
    blindPass('2026-11-13T09:30:00.000Z');
    allPass(1);
    const o = ship();
    expect(codeReview(o)).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(result(o).verdict).toBe('ready_to_merge');
    expect(result(o).uncapturedGates).toContain('code-review');
  });

  // Behaviour: re-running the reviewer on the same commit cannot erase its fail, even when no tree was captured.
  it('fail and a no-tree pass both on commit A: still blocked', () => {
    failHere('2026-11-13T09:10:00.000Z');
    blindPass('2026-11-13T09:30:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  /**
   * A real no-tree pass: a tracked file grown over 50 MB (both trees come out ''), then the stop, its verdict read from
   * a transcript under ~/.claude/projects (D41).
   * ⚠ changes existing test: D45 dead code — no SubagentStart capture runs first any more (captureStart is removed).
   * ⚠ changes existing test: D52 ("Record no row") — a capture that cannot build the reviewed tree (a file over 50 MB)
   *   now writes no row at all, so `captured` is false (it was true, with a no-tree pass row).
   */
  function realBlindPass(): void {
    featureDir();
    commitFile('big.bin', 'small\n', 'add a data file');
    const big = path.join(repo, 'big.bin');
    const fd = fs.openSync(big, 'w');
    fs.ftruncateSync(fd, 51 * 1024 * 1024);
    fs.closeSync(fd);
    const hook = { session_id: 's1', agent_id: 'a-blind', agent_type: 'oss:code-reviewer', cwd: repo };
    const text = '```oss-verdict\n' + JSON.stringify({ verdict: 'pass', findings: ZERO }) + '\n```';
    const out = captureVerdict({ ...hook, agent_transcript_path: agentTranscript(text) }, { now: () => new Date('2026-11-13T09:30:00.000Z') });
    expect(out.captured).toBe(false);
    git('checkout', '-q', '--', 'big.bin');
  }

  // ⚠ changes existing test: code review M1 (round 3) — the row was fabricated (`start: 'missing'` on a no-tree pass);
  //   it now comes from a real capture whose start snapshot ran past its deadline too, which used to record a false
  //   match ('' === '').
  // ⚠ changes existing test: D45 (fails only) — the fix commit changed the shipped code, so the fail is cleared whatever the pass's start
  //   (it was "a no-tree pass on a new commit whose start snapshot is empty too: still blocked").
  // ⚠ changes existing test: D45 dead code — there is no start snapshot any more: it was "... even when the no-tree pass
  //   after it had an empty start snapshot", and the twin test "a real no-tree pass on a new commit, started on that
  //   commit: not blocked" (now the same test) is removed.
  it('a fix commit clears the fail, whatever real no-tree pass follows', () => {
    failHere('2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'fixed\n', 'fix');
    realBlindPass();
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // Code review H1 (round 3): a pass captured BEFORE the fail never decides the gate.
  // ⚠ changes existing test: D45 (fails only) — a .oss-only commit is no code change, so the fail stays open, `source: agent` (it was
  //   cleared by the no-tree pass and "the model line decides").
  it('a counting pass, then a fail on the same tree, a .oss-only commit and a no-tree pass: the fail stays open', () => {
    const t = git('rev-parse', 'HEAD^{tree}');
    row('pass', '2026-11-13T09:05:00.000Z', { tree: t, trackedTree: t });
    row('fail', '2026-11-13T09:10:00.000Z', { tree: t, trackedTree: t });
    fs.writeFileSync(path.join(featureDir(), 'PROGRESS.md'), 'x\n');
    git('add', '-f', '.oss');
    git('commit', '-q', '-m', 'dev docs only');
    blindPass('2026-11-13T09:30:00.000Z');
    gateLine({ round: 1, gate: 'code-review', verdict: 'fail', findings: { high: 1 } });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    const o = ship();
    expect(codeReview(o)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(o).verdict).toBe('blocked');
    expect(result(o).uncapturedGates).not.toContain('code-review');
  });

  // ⚠ changes existing test: pen test F2 (round 3) — with no headSha nobody can tell a commit landed after the fail, so
  //   no no-tree pass clears it (it was "a fail with no headSha is cleared by a no-tree pass that has one").
  // ⚠ D43: still holds; such a fail is cleared only by a later counting pass with a real tree (see the pen F2 block).
  // ⚠ changes existing test: D48 (replaces D43) — a fail with neither tree nor headSha does not count, so the gate keeps
  //   its model line (it was "... is not cleared by a no-tree pass", verdict fail, source agent).
  it('a fail with neither tree nor headSha does not count, whatever pass follows', () => {
    row('fail', '2026-11-13T09:10:00.000Z', { headSha: '', tree: '', trackedTree: '' });
    commitFile('b.txt', 'fixed\n', 'fix');
    blindPass('2026-11-13T09:30:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });
});

/**
 * Pen test F2 (round 3): a fail row with no tree (the capture hit its deadline or a file over 50 MB) was "different" from
 * every counting pass's tree, so a same-code re-roll cleared it. Now such a fail is treated as D36 treats a no-tree pass:
 * only a later counting pass on a different commit (its headSha differs from the fail's) clears it, and a fail with no
 * headSha either is never cleared by a pass.
 */
describe('assembleShip: a fail with no tree clears only on a new commit (pen F2)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  function row(verdict: 'pass' | 'fail', ts: string, extra: Record<string, unknown>): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'security', verdict, findings: ZERO, agent: 'a', session: 's', ts, headSha: git('rev-parse', 'HEAD'), ...extra,
    });
  }
  const blindFail = (ts: string, extra: Record<string, unknown> = {}): void =>
    row('fail', ts, { tree: '', trackedTree: '', ...extra });
  const passHere = (ts: string): void =>
    row('pass', ts, { tree: git('rev-parse', 'HEAD^{tree}'), trackedTree: git('rev-parse', 'HEAD^{tree}') });

  const security = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'security');

  // Behaviour: a reviewer re-rolled on the same commit cannot erase a fail whose tree the capture could not hash.
  it('a no-tree fail, then a counting pass on the same commit: still blocked', () => {
    blindFail('2026-11-13T09:10:00.000Z');
    passHere('2026-11-13T09:30:00.000Z');
    allPass(1);
    const o = ship();
    expect(security(o)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(o).verdict).toBe('blocked');
  });

  // ⚠ changes existing test: D45 (fails only) — the fix commit clears the fail through its headSha's tree; the line decides (was agent).
  it('a no-tree fail, a fix commit, then a counting pass on the new commit: passes', () => {
    blindFail('2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'fixed\n', 'fix');
    passHere('2026-11-13T09:30:00.000Z');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // ⚠ changes existing test: D48 ("Record nothing", replaces D43 and D45's "stays open" for this case) — the capture no
  //   longer writes a row with neither tree nor headSha; such a row left from before (no released version wrote one)
  //   does not count, so the gate keeps its model line (D26). It replaces three tests that said "still blocked": "...
  //   a fix commit, then a counting pass with a tree", "... then a counting pass with a tree" and "... then a no-tree pass".
  it('D48: a fail with neither tree nor headSha does not count: the gate keeps its model line', () => {
    blindFail('2026-11-13T09:10:00.000Z', { headSha: '' });
    allPass(1);
    const o = ship();
    expect(security(o)).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(result(o).verdict).not.toBe('blocked');
  });

  // D48: a row with neither is skipped, so it does not hide an earlier captured fail that is still open.
  it('D48: a fail with neither tree nor headSha does not hide an earlier open fail', () => {
    row('fail', '2026-11-13T09:05:00.000Z', { tree: git('rev-parse', 'HEAD^{tree}'), trackedTree: git('rev-parse', 'HEAD^{tree}') });
    blindFail('2026-11-13T09:10:00.000Z', { headSha: '' });
    allPass(1);
    const o = ship();
    expect(security(o)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(o).verdict).toBe('blocked');
  });
});

/**
 * Pen test F1 (round 3): restarting the ship run cleared a captured fail, because rows older than the run start were
 * dropped. Now an open fail does not depend on the run start: every verdict row of the feature counts from the run
 * start of its last ready_to_merge ship result (the stored result bound to the ledger's last results row), or from the
 * first row when there is none. Timeline gate lines, the model's own, still count only from this run's start.
 */
describe('assembleShip: an open fail survives a restarted run (pen F1)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  function failAt(ts: string): void {
    const tree = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: 'a', session: 's', ts, tree,
      trackedTree: tree, headSha: git('rev-parse', 'HEAD'),
    });
  }

  /** A stored ship result of `verdict` from a run started at `startedAt`, bound in the ledger as the CLI binds it. */
  function storedShip(verdict: 'ready_to_merge' | 'blocked', startedAt: string, bound = true): void {
    const dir = path.join(featureDir(), 'results');
    fs.mkdirSync(dir, { recursive: true });
    const bytes = JSON.stringify({ v: 1, phase: 'ship', feature: FEATURE, startedAt, verdict });
    fs.writeFileSync(path.join(dir, 'ship.json'), bytes);
    openLedger(repo).appendRow(`results/${FEATURE}/ship`, {
      sha256: bound ? sha256(bytes) : sha256('other'), feature: FEATURE, phase: 'ship', startedAt, headSha: '', session: '',
    });
  }

  const codeReview = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');

  it('a fail captured in an earlier run with no ready_to_merge result since still blocks', () => {
    failAt('2026-11-12T09:00:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a fail captured after the last ready_to_merge result\'s run started still blocks', () => {
    storedShip('ready_to_merge', '2026-11-13T08:00:00.000Z');
    failAt('2026-11-13T08:30:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // ⚠ changes existing test: D51 (code review M1, pen L7) — every fail row is read, whatever ready_to_merge result came
  //   after it: a fail on code that still ships stays open (it was "a fail from before the last ready_to_merge
  //   result's run is not read", gate pass). Once the code changed, the old fail no longer haunts the next ship.
  it('a fail from before the last ready_to_merge result\'s run stays open on the same code, and clears once it changed', () => {
    failAt('2026-11-13T07:00:00.000Z');
    storedShip('ready_to_merge', '2026-11-13T08:00:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
    commitFile('b.txt', 'fixed\n', 'fix');
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // Rule: D51 (pen L7): a fail from an earlier run that shipped ready_to_merge re-opens when the code goes back to it.
  it('D51: a fail from an earlier ready_to_merge run re-opens when the code is reverted to the failed tree', () => {
    failAt('2026-11-13T07:00:00.000Z');
    commitFile('b.txt', 'fixed\n', 'fix');
    storedShip('ready_to_merge', '2026-11-13T08:00:00.000Z');
    git('revert', '--no-edit', 'HEAD');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // ⚠ changes existing test: code-review info 2 (gate round 6) — renamed: D51 left no cutoff to set, so the case is that
  //   no stored result, blocked or unbound, hides an open fail (it was "... sets no cutoff").
  it('D51: an open fail stays open whatever ship result is stored, blocked or not bound by the ledger', () => {
    failAt('2026-11-13T07:00:00.000Z');
    storedShip('blocked', '2026-11-13T08:00:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail' });
    storedShip('ready_to_merge', '2026-11-13T08:10:00.000Z', false);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail' });
  });

  // ⚠ changes existing test: D51 — every fail row is read, so there is no verdict cutoff left to freeze (D47's
  //   verdictsFrom): the result is a pure function of the rows and HEAD, and assemble and check agree without it. It was
  //   "assemble stores the cutoff it used as verdictsFrom" and "a given verdictsFrom is used instead of the stored
  //   result"; the schema keeps the field optional so results stored before round 7 still validate.
  it('assemble no longer writes verdictsFrom, with or without a ready_to_merge result stored', () => {
    allPass(1);
    expect(result(ship())).not.toHaveProperty('verdictsFrom');
    storedShip('ready_to_merge', '2026-11-13T08:00:00.000Z');
    expect(result(ship())).not.toHaveProperty('verdictsFrom');
  });

  // Rule: gate lines carry whole-second times, so a line from the run start's own second belongs to this run.
  it('a timeline gate line from the same second as the run start is read', () => {
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass', ts: '2026-11-13T09:00:00Z' });
    const r = result(assembleShip({ ...ctx(), startedAt: '2026-11-13T09:00:00.750Z' }, { base: 'main' }));
    expect((r.gates as Array<Record<string, unknown>>).map((g) => g.gate)).toEqual(GATES);
  });

  // Rule: the model's gate lines speak for this run only; a line from a run before is not today's review.
  it('a timeline gate line from before this run started is not read', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass', ts: '2026-11-13T08:59:00Z' });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    expect(ship()).toEqual({ ok: false, error: 'gate_missing', detail: 'code-review' });
  });
});

/**
 * Coordinator fix to finding 4 (2026-11-18): review agents run on the uncommitted working tree in ship Step 1, and ship
 * commits afterwards, so a captured row is bound to the reviewed TREE (working tree minus .oss), never HEAD.
 * ⚠ changes existing test: D45 (fails only) — this block recorded passes and checked whether each counted (`source:
 *   agent`) or not (`model`). Passes no longer count at all, so each case now records a real captured FAIL and checks
 *   whether it stays open (`fail`, `source: agent`: the shipped code is the failed code) or is cleared (`pass`, `source:
 *   model`: the shipped tracked code outside .oss differs). Each test's expectation is marked below.
 */
describe('assembleShip: a captured fail is bound to the reviewed tracked tree', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const FAIL_BLOCK = '```oss-verdict\n' + JSON.stringify({ verdict: 'fail', findings: { ...ZERO, medium: 1 } }) + '\n```';
  const OPEN = { verdict: 'fail', source: 'agent' };
  const CLEARED = { verdict: 'pass', source: 'model' };

  // ⚠ changes existing test: D45 dead code — review() no longer runs a SubagentStart capture first (it is removed).
  function review(opts: { duringReview?: () => void } = {}): void {
    featureDir();
    opts.duringReview?.();
    const out = captureVerdict(
      // ⚠ changes existing test: D41 — the verdict is read only from the agent transcript, never last_assistant_message.
      { session_id: 's1', agent_id: 'a1', agent_type: 'oss:code-reviewer', cwd: repo, agent_transcript_path: agentTranscript(FAIL_BLOCK) },
      { now: () => new Date('2026-11-13T09:10:00.000Z') },
    );
    expect(out.captured).toBe(true);
  }

  function codeReview(): Record<string, unknown> | undefined {
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: 'pass' });
    return (result(ship()).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');
  }

  // ⚠ changes existing test: D45 — a fail on code committed unchanged stays open (was: a pass that counts).
  it('a fail captured on an uncommitted tree that is then committed unchanged stays open', () => {
    fs.writeFileSync(path.join(repo, 'b.txt'), 'reviewed\n');
    review();
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'ship commit');
    expect(codeReview()).toMatchObject(OPEN);
  });

  // ⚠ changes existing test: D45 dead code — "a fail with no start snapshot still blocks" is removed: there is no start
  //   snapshot any more, and the test above already covers that blocking case.

  // ⚠ changes existing test: D45 — the fail is bound to its stop tree, which ships, so it stays open (was: a pass
  //   whose code changed while the agent ran does not count).
  it('a fail whose code changed while the agent ran stays open when its stop tree ships', () => {
    fs.writeFileSync(path.join(repo, 'b.txt'), 'seen at start\n');
    review({ duringReview: () => fs.writeFileSync(path.join(repo, 'b.txt'), 'swapped in before stop\n') });
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'ship commit');
    expect(codeReview()).toMatchObject(OPEN);
  });

  // ⚠ changes existing test: D45 — a later code change clears the fail (was: a pass row that does not count).
  it('a later code change clears the fail', () => {
    fs.writeFileSync(path.join(repo, 'b.txt'), 'reviewed\n');
    review();
    fs.writeFileSync(path.join(repo, 'b.txt'), 'changed after review\n');
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'ship commit');
    expect(codeReview()).toMatchObject(CLEARED);
  });

  // ⚠ changes existing test: D45 — a .oss-only change keeps the fail open (was: a pass that still counts).
  it('a change only under .oss after the review keeps the fail open', () => {
    fs.writeFileSync(path.join(repo, 'b.txt'), 'reviewed\n');
    review();
    fs.writeFileSync(path.join(featureDir(), 'PROGRESS.md'), '# done\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'ship commit with dev docs');
    expect(codeReview()).toMatchObject(OPEN);
  });

  // ⚠ changes existing test: D45 — untracked files are not shipped code, so leaving one out keeps the fail open (was:
  //   a pass that still counts).
  it('an untracked scratch file present at review, then left out of the commit, keeps the fail open', () => {
    fs.writeFileSync(path.join(repo, 'b.txt'), 'reviewed\n');
    fs.mkdirSync(path.join(repo, 'dist'));
    fs.writeFileSync(path.join(repo, 'dist', 'out.js'), 'build output\n');
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'notes\n');
    review();
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'ship commit');
    expect(codeReview()).toMatchObject(OPEN);
  });

  // ⚠ changes existing test: D45 — deleting a tracked file changes the shipped code, so it clears the fail (was: a
  //   pass that does not count).
  it('a tracked file deleted after the review clears the fail', () => {
    commitFile('keep.txt', 'tracked\n', 'tracked file');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'reviewed\n');
    review();
    git('rm', '-q', 'keep.txt');
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'ship commit');
    expect(codeReview()).toMatchObject(CLEARED);
  });

  // ⚠ changes existing test: D45 — the file was in the commit HEAD was at review (pen N4), so ship deleting it changes
  //   the shipped code and clears the fail (was: a pass that does not count).
  it('a committed file untracked with git rm --cached before the review, then deleted by ship, clears the fail', () => {
    commitFile('keep.txt', 'tracked\n', 'tracked file');
    git('rm', '-q', '--cached', 'keep.txt');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'reviewed\n');
    review();
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'ship commit deletes keep.txt');
    expect(codeReview()).toMatchObject(CLEARED);
  });

  // ⚠ changes existing test: D45 — a new file in the commit changes the shipped code (was: a pass that does not count).
  it('a new file added to the commit that was not in the reviewed tree clears the fail', () => {
    fs.writeFileSync(path.join(repo, 'b.txt'), 'reviewed\n');
    review();
    fs.writeFileSync(path.join(repo, 'unreviewed.ts'), 'export const x = 1;\n');
    git('add', 'b.txt', 'unreviewed.ts');
    git('commit', '-q', '-m', 'ship commit');
    expect(codeReview()).toMatchObject(CLEARED);
  });

  /** Commits b.txt, then writes a fail row with `extra()`'s fields, read after that commit. */
  function failRow(extra: () => Record<string, unknown>): void {
    commitFile('b.txt', 'x\n', 'add');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: ZERO, agent: 'a', session: 's', ts: '2026-11-13T09:10:00.000Z', ...extra(),
    });
  }

  // ⚠ changes existing test: D45 — with no trackedTree and no headSha the fail cannot be compared, so it stays open
  //   (was: a pass with tree but no trackedTree does not count).
  it('a fail with tree but no trackedTree and no headSha stays open', () => {
    failRow(() => ({ tree: git('rev-parse', 'HEAD^{tree}') }));
    expect(codeReview()).toMatchObject(OPEN);
  });

  // ⚠ changes existing test: D45 — a fail with no tree is compared through its headSha, here the shipped commit (was:
  //   a pass without tree does not count).
  it('a fail without tree, on the shipped commit, stays open', () => {
    failRow(() => ({ headSha: git('rev-parse', 'HEAD') }));
    expect(codeReview()).toMatchObject(OPEN);
  });

  // ⚠ changes existing test: D45 — a malformed tree is never passed to git and the fail stays open (was: a pass).
  it('a fail whose trackedTree is not a hex object id (an option, say) stays open and never reaches git', () => {
    failRow(() => ({ tree: '--output=planted', trackedTree: '--output=planted' }));
    expect(codeReview()).toMatchObject(OPEN);
    expect(fs.existsSync(path.join(repo, 'planted'))).toBe(false);
  });

  // ⚠ changes existing test: D55 — trees git no longer has, and no headSha to fall back to: the row is ignored and the
  //   gate keeps its model line (it was "stays open", D45).
  it('a fail whose trees are hex ids git does not have, with no headSha, is ignored', () => {
    failRow(() => ({ tree: 'a'.repeat(40), trackedTree: 'a'.repeat(40) }));
    expect(codeReview()).toMatchObject(CLEARED);
  });

  // Rule: only a missing object is dropped (D55); any other git error still keeps the fail open.
  it('a fail whose tree is an object git has but not a tree (a blob) stays open', () => {
    failRow(() => {
      const blob = git('rev-parse', 'HEAD:b.txt');
      return { tree: blob, trackedTree: blob, headSha: git('rev-parse', 'HEAD') };
    });
    expect(codeReview()).toMatchObject(OPEN);
  });
});

/**
 * D45 (user pick, gate round 4, "Fails only"): captured passes no longer decide or clear anything, since a pass can be
 * minted. Per gate, the newest captured fail (within the verdict cutoff) stays open until the shipped code, the tracked
 * tree outside .oss at HEAD, differs from the code that failed: its trackedTree, else its headSha's tree. A fail with
 * neither stays open. An open fail blocks (`source: agent`); with none, the gate keeps its timeline line (D26).
 */
describe('assembleShip: only a change to the shipped code clears a captured fail (D45)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const block = (verdict: 'pass' | 'fail'): string =>
    '```oss-verdict\n' + JSON.stringify({ verdict, findings: { ...ZERO, high: verdict === 'fail' ? 1 : 0 } }) + '\n```';
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  /** A real review: the stop, its verdict read from the agent transcript (D41). */
  // ⚠ changes existing test: D45 dead code — no SubagentStart capture runs first any more (captureStart is removed).
  function review(verdict: 'pass' | 'fail', at: string): void {
    featureDir();
    const hook = { session_id: 's1', agent_id: `a-${randomUUID()}`, agent_type: 'oss:code-reviewer', cwd: repo };
    const out = captureVerdict({ ...hook, agent_transcript_path: agentTranscript(block(verdict)) }, { now: () => new Date(at) });
    expect(out.captured).toBe(true);
  }

  /** A row written straight into the ledger, as a forger with ledger access could (security M1). */
  function row(verdict: 'pass' | 'fail', ts: string, extra: Record<string, unknown> = {}): void {
    const tree = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict, findings: { ...ZERO, high: verdict === 'fail' ? 1 : 0 }, agent: 'a', session: 's', ts,
      tree, trackedTree: tree, headSha: git('rev-parse', 'HEAD'), ...extra,
    });
  }

  const codeReview = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');

  function expectOpen(o: AssembleOutcome): void {
    expect(codeReview(o)).toMatchObject({ verdict: 'fail', source: 'agent' });
    // ⚠ changes existing test: D57 — the label also says a tracked code change is needed to clear it.
    expect(result(o).blockers).toEqual(['gate:code-review (captured fail, not re-reviewed: a tracked code change is needed to clear it)']);
  }

  function expectCleared(o: AssembleOutcome): void {
    expect(codeReview(o)).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(result(o).verdict).toBe('ready_to_merge');
  }

  // Pen M3a: a scratch file nobody ships made the re-roll's tree "different"; the code that ships is the failed code.
  it('pen M3a: an untracked scratch file, a re-roll that passes, then the file deleted: the fail stays open', () => {
    review('fail', '2026-11-13T09:10:00.000Z');
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'nothing\n');
    review('pass', '2026-11-13T09:20:00.000Z');
    fs.rmSync(path.join(repo, 'scratch.txt'));
    allPass(1);
    expectOpen(ship());
  });

  // Pen M3b: an empty commit is a new commit, not new code.
  it('pen M3b: an empty commit and a re-roll that passes do not clear a fail with a tree', () => {
    review('fail', '2026-11-13T09:10:00.000Z');
    git('commit', '-q', '--allow-empty', '-m', 'nothing');
    review('pass', '2026-11-13T09:20:00.000Z');
    allPass(1);
    expectOpen(ship());
  });

  it('pen M3b: an empty commit and a re-roll that passes do not clear a fail with no tree (only a headSha)', () => {
    row('fail', '2026-11-13T09:10:00.000Z', { tree: '', trackedTree: '' });
    git('commit', '-q', '--allow-empty', '-m', 'nothing');
    row('pass', '2026-11-13T09:20:00.000Z');
    row('pass', '2026-11-13T09:21:00.000Z', { tree: '', trackedTree: '' });
    allPass(1);
    expectOpen(ship());
  });

  // Security M1: a pass row written straight to the ledger, however well formed, changes nothing.
  it('security M1: a minted pass row does not clear an open fail', () => {
    row('fail', '2026-11-13T09:10:00.000Z');
    row('pass', '2026-11-13T09:20:00.000Z');
    allPass(1);
    expectOpen(ship());
  });

  it('security M1: a minted pass row neither overrides the model line nor labels the gate agent-backed', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'fail', findings: { high: 1 } });
    gateLine({ round: 1, gate: 'performance', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    row('pass', '2026-11-13T09:20:00.000Z');
    const o = ship();
    expect(codeReview(o)).toMatchObject({ verdict: 'fail', source: 'model' });
    expect(result(o).uncapturedGates).toEqual(GATES);
    expect(result(o).blockers).toEqual(['gate:code-review']);
  });

  it('security M1: a minted pen-test pass adds no gate', () => {
    allPass(1);
    row('pass', '2026-11-13T09:20:00.000Z', { gate: 'pen-test' });
    expect((result(ship()).gates as Array<Record<string, unknown>>).map((g) => g.gate)).toEqual(GATES);
  });

  // Behaviour: fixing the code the reviewer failed clears its fail; the gate falls back to its timeline line.
  it('a real tracked fix commit clears the fail (the gate keeps its line)', () => {
    review('fail', '2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'fixed\n', 'fix the finding');
    allPass(1);
    expectCleared(ship());
  });

  it('a real tracked fix commit clears a fail with no tree, through its headSha', () => {
    row('fail', '2026-11-13T09:10:00.000Z', { tree: '', trackedTree: '' });
    commitFile('b.txt', 'fixed\n', 'fix the finding');
    allPass(1);
    expectCleared(ship());
  });

  it('a change only under .oss does not clear the fail, with or without a tree, even with a re-roll', () => {
    row('fail', '2026-11-13T09:10:00.000Z');
    row('fail', '2026-11-13T09:11:00.000Z', { tree: '', trackedTree: '' });
    fs.writeFileSync(path.join(featureDir(), 'PROGRESS.md'), 'x\n');
    git('add', '-f', '.oss');
    git('commit', '-q', '-m', 'dev docs only');
    row('pass', '2026-11-13T09:20:00.000Z');
    allPass(1);
    expectOpen(ship());
  });

  // The newest fail decides: a re-review that fails the fixed code keeps the gate failed, with its findings.
  it('a newer fail on the fixed code keeps the gate failed with that fail\'s findings', () => {
    row('fail', '2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'fixed\n', 'fix');
    row('fail', '2026-11-13T09:20:00.000Z', { findings: { ...ZERO, critical: 2 } });
    allPass(1);
    const o = ship();
    expectOpen(o);
    expect(codeReview(o)).toMatchObject({ findings: { ...ZERO, critical: 2 } });
  });

  // ⚠ changes existing test: D48 ("Record nothing") — the edge reported to the coordinator is decided: a fail with
  //   neither tree nor headSha cannot be compared and does not count (it was "stays open, even after a fix commit").
  it('a fail with neither tree nor headSha does not count, even with no fix commit', () => {
    row('fail', '2026-11-13T09:10:00.000Z', { tree: '', trackedTree: '', headSha: '' });
    allPass(1);
    expectCleared(ship());
  });

  // Rule: D51 (code review M1, security L1/L2): every captured fail is checked against the shipped code, not only the
  //       newest, so going back to code a reviewer already failed ships nothing.
  it('D51: a revert to the first failed tree stays blocked after a second fail on the attempted fix', () => {
    row('fail', '2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'attempted fix\n', 'attempt');
    row('fail', '2026-11-13T09:20:00.000Z', { findings: { ...ZERO, critical: 2 } });
    git('revert', '--no-edit', 'HEAD');
    allPass(1);
    const o = ship();
    expectOpen(o);
    // The findings come from the newest fail still open (the first one: the second reviewed other code).
    expect(codeReview(o)).toMatchObject({ findings: { ...ZERO, high: 1 } });
  });

  it('D51: a real fix after two fails on two trees clears both', () => {
    row('fail', '2026-11-13T09:10:00.000Z');
    commitFile('b.txt', 'attempted fix\n', 'attempt');
    row('fail', '2026-11-13T09:20:00.000Z');
    commitFile('b.txt', 'real fix\n', 'fix');
    allPass(1);
    expectCleared(ship());
  });

  // Rule: D51 (security M2): a replace ref swaps what HEAD's tree reads as without changing the shipped commit, so it
  //       must not clear a fail: ship's git runs with GIT_NO_REPLACE_OBJECTS=1.
  it('D51: a git replace of HEAD with a decoy commit does not clear the fail', () => {
    commitFile('b.txt', 'reviewed bad\n', 'ship commit');
    row('fail', '2026-11-13T09:10:00.000Z');
    const shipped = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'something else\n');
    git('add', 'b.txt');
    const decoy = git('commit-tree', git('write-tree'), '-p', git('rev-parse', 'HEAD^'), '-m', 'decoy');
    git('reset', '-q', '--hard', shipped);
    git('replace', shipped, decoy);
    allPass(1);
    expectOpen(ship());
  });

  // ⚠ changes existing test: D55 (user pick, "Fall back, then drop") — a fail whose trees git no longer has and that
  //   has no headSha is ignored, as D48 does, so the gate falls back to its model line (it was "stays open").
  it('D55: a fail whose tree git does not have, with no headSha, is ignored: the gate keeps its model line', () => {
    row('fail', '2026-11-13T09:10:00.000Z', { tree: 'a'.repeat(40), trackedTree: 'a'.repeat(40), headSha: '' });
    allPass(1);
    expectCleared(ship());
  });
});

/**
 * Perf L2 (gate round 5), D51: a real fix touching about 20,000 paths overflowed the shipped-vs-reviewed diff's 1 MB
 * buffer, which read as "unknown" and kept the fail open. A large change still clears a fail, and a large deletion of
 * tracked code is still a change. The trees are built with git plumbing (one blob, an index from stdin), so it stays fast.
 */
describe('assembleShip: a fail clears on a fix that touches about 20,000 paths (perf L2)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const N = 20_000;
  const LONG = 'a-directory-with-a-long-name/another-nested-level';

  /** git with stdin, using a scratch index so neither the real index nor the working tree is touched. */
  function gitIn(input: string, ...args: string[]): string {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    env.GIT_INDEX_FILE = path.join(valueDir, 'scratch.index');
    return execFileSync('git', args, { cwd: repo, env, input, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }).trim();
  }

  /** Moves the branch to a new commit on top of HEAD with `tree` (plumbing only: HEAD moves, nothing is checked out). */
  function commitTree(tree: string): void {
    const commit = gitIn('', 'commit-tree', tree, '-p', 'HEAD', '-m', 'many files');
    git('update-ref', `refs/heads/feat/${FEATURE}/ship`, commit);
  }

  /** Commits HEAD's tree plus N files `<LONG>/<prefix>-<i>.txt` (all one blob). */
  function commitManyFiles(prefix: string): void {
    const blob = gitIn(`${prefix}\n`, 'hash-object', '-w', '--stdin');
    const lines: string[] = [];
    for (let i = 0; i < N; i++) lines.push(`100644 ${blob}\t${LONG}/${prefix}-${String(i).padStart(6, '0')}.txt`);
    gitIn('', 'read-tree', 'HEAD');
    gitIn(`${lines.join('\n')}\n`, 'update-index', '--index-info');
    commitTree(gitIn('', 'write-tree'));
  }

  function failHere(): void {
    const tree = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, headSha: git('rev-parse', 'HEAD'),
    });
  }

  const codeReview = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');

  it('a fix that adds 20,000 files clears the fail', () => {
    commitFile('b.txt', 'bad\n', 'bad');
    failHere();
    commitManyFiles('fix');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  }, 60_000);

  it('a fix that deletes 20,000 tracked files clears the fail', () => {
    commitFile('b.txt', 'feature\n', 'feature');
    const before = git('rev-parse', 'HEAD^{tree}');
    commitManyFiles('old');
    failHere();
    commitTree(before);
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  }, 60_000);
});

/**
 * D55 (user pick, gate round 6 pen M1, "Fall back, then drop"): capture writes its reviewed trees with no ref, so
 * git gc (two weeks later, or --prune=now) deletes them. A fail whose trees are gone is compared through its headSha's
 * tree; when that commit is gone too the row is ignored and the gate keeps its model line (as D48 does).
 */
describe('assembleShip: a fail whose reviewed trees git pruned (D55)', { timeout: 60_000 }, () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  /** The working tree the reviewer saw (b.txt edited, uncommitted), written as loose objects no ref keeps. */
  function reviewedTree(content: string): string {
    fs.writeFileSync(path.join(repo, 'b.txt'), content);
    git('add', 'b.txt');
    const tree = git('write-tree');
    git('reset', '-q');
    git('checkout', '-q', '--', 'b.txt');
    return tree;
  }

  function failRow(tree: string, headSha: string): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, headSha,
    });
  }

  function gcNow(): void {
    git('gc', '-q', '--prune=now');
  }

  const codeReview = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');

  // Behaviour: a team fixes a flagged change and ships after git gc ran; the fix is a tracked change, so the fail clears.
  it('a fix commit clears a fail whose trees were pruned, through its headSha', () => {
    const tree = reviewedTree('vuln\n');
    failRow(tree, git('rev-parse', 'HEAD'));
    commitFile('b.txt', 'fixed\n', 'ship with fix');
    gcNow();
    expect(() => git('cat-file', '-e', tree)).toThrow();
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // Behaviour: gc alone is not a fix; HEAD is still the commit reviewed, so the fail stays open.
  it('with no commit since review, a fail whose trees were pruned stays open', () => {
    const tree = reviewedTree('vuln\n');
    failRow(tree, git('rev-parse', 'HEAD'));
    gcNow();
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // Behaviour: trees and the review's commit both pruned (an amended commit, say): the row can no longer be compared,
  //   so it is ignored and the gate falls back to its model line.
  it('a fail whose trees and headSha commit were both pruned is ignored: the gate keeps its model line', () => {
    const tree = reviewedTree('vuln\n');
    const lost = git('commit-tree', tree, '-p', git('rev-parse', 'HEAD'), '-m', 'amended away');
    failRow(tree, lost);
    gcNow();
    expect(() => git('cat-file', '-e', lost)).toThrow();
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // Rule: an ignored row does not hide an older fail that is still open.
  it('an ignored pruned row does not hide an older open fail', () => {
    const t = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: { ...ZERO, medium: 2 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:05:00.000Z', tree: t, trackedTree: t, headSha: git('rev-parse', 'HEAD'),
    });
    const tree = reviewedTree('vuln\n');
    failRow(tree, git('commit-tree', tree, '-p', git('rev-parse', 'HEAD'), '-m', 'amended away'));
    gcNow();
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', findings: { ...ZERO, medium: 2 }, source: 'agent' });
  });
});

/**
 * Perf low 1 and code-review info 4 (gate round 6): every fail row cost 1-4 git processes, and Stop re-runs assemble
 * inside a 4 s budget. Rows sharing one reviewed state are compared once per assemble, and a gate's rows are walked
 * newest first, stopping at the first open one (its findings are the ones shown). The result is unchanged.
 */
describe('assembleShip: fail rows cost git processes per distinct reviewed state, not per row', { timeout: 60_000 }, () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const ROWS = 200;
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  function manyFails(): void {
    const tree = git('rev-parse', 'HEAD^{tree}');
    const headSha = git('rev-parse', 'HEAD');
    const ledger = openLedger(repo);
    for (let i = 0; i < ROWS; i++) {
      const ts = new Date(Date.parse('2026-11-13T09:00:00.000Z') + i * 1000).toISOString();
      ledger.appendRow(`verdicts/${FEATURE}`, {
        gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: `a${i}`, session: 's', ts, tree, trackedTree: tree, headSha,
      });
    }
  }

  function gitSpawnsOf(run: () => AssembleOutcome): { outcome: AssembleOutcome; n: number } {
    spawns.n = 0;
    const outcome = run();
    return { outcome, n: spawns.n };
  }

  const codeReview = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'code-review');

  // A generous bound: the diff and the ledger take a handful; one git process per row (the old cost) is 200 or more.
  const BOUND = 40;

  it(`${ROWS} open fails on the shipped code: still blocked, with far fewer git processes than rows`, () => {
    manyFails();
    allPass(1);
    const { outcome, n } = gitSpawnsOf(() => ship());
    expect(codeReview(outcome)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(n).toBeLessThan(BOUND);
  });

  it(`${ROWS} fails on one tree, all cleared by a fix: passes, with far fewer git processes than rows`, () => {
    manyFails();
    commitFile('b.txt', 'fixed\n', 'fix');
    allPass(1);
    const { outcome, n } = gitSpawnsOf(() => ship());
    expect(codeReview(outcome)).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(n).toBeLessThan(BOUND);
  });

  // Rule: the newest open row's findings are shown, also when rows share one timestamp (the later ledger row wins).
  it('same-time open fails show the later ledger row\'s findings', () => {
    const tree = git('rev-parse', 'HEAD^{tree}');
    for (const medium of [1, 3]) {
      openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
        gate: 'code-review', verdict: 'fail', findings: { ...ZERO, medium }, agent: 'a', session: 's',
        ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, headSha: git('rev-parse', 'HEAD'),
      });
    }
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail', findings: { ...ZERO, medium: 3 } });
  });
});

/**
 * Pen L2 (gate round 6): the CLAUDE.md branch strategy cuts features from origin/main while local main may lag behind
 * teammates' pushes, and a stale local base inflated the ship diff with their commits. When the ship-start snapshot's
 * same-name remote SHA contains the local tip and is ahead of it, the diff is taken from merge-base(that SHA, HEAD).
 * Blockers and verdicts do not change.
 */
describe('assembleShip: a stale local base does not inflate the diff (pen L2)', () => {
  /** A teammate's commit pushed to origin/main; the feature is cut from it while local main stays behind. */
  function staleMain(): string {
    git('checkout', '-q', '--detach', 'main');
    commitFile('mate.txt', Array.from({ length: 300 }, (_, i) => `${i}\n`).join(''), 'mate');
    const mate = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-B', `feat/${FEATURE}/ship`, mate);
    commitFile('f.txt', 'f\n', 'feature');
    return mate;
  }

  it('diffs against the snapshot SHA when it is ahead of the local base', () => {
    const mate = staleMain();
    allPass(1);
    const r = result(ship({ remoteRefs: new Map([['refs/remotes/origin/main', mate]]) }));
    expect(r.diff).toEqual({ base: mate, baseRef: 'main', files: 1, insertions: 1, deletions: 0 });
    expect(r.verdict).toBe('ready_to_merge');
    expect(r.blockers).toEqual([]);
  });

  // Rule: a snapshot behind the local base (local main has unpushed commits) never moves the base.
  it('keeps the local base when the snapshot SHA does not contain it', () => {
    const behind = git('rev-parse', 'main');
    const mate = staleMain();
    git('branch', '-f', 'main', mate);
    allPass(1);
    const r = result(ship({ remoteRefs: new Map([['refs/remotes/origin/main', behind]]) }));
    expect(r.diff).toEqual(result(ship()).diff);
    expect(r.diff).toMatchObject({ base: mate, files: 1 });
  });

  it('a snapshot ref of another name does not move the base', () => {
    const mate = staleMain();
    allPass(1);
    const r = result(ship({ remoteRefs: new Map([['refs/remotes/origin/release', mate]]) }));
    expect(r.diff).toMatchObject({ base: git('rev-parse', 'main'), files: 2 });
  });
});

/** Pen info 2 (gate round 6): with no local base branch, the refusal says how to create one (fixed text, no values). */
describe('assembleShip: a missing local base branch names the fix', () => {
  it('diff_unavailable carries a hint to create the local branch from its remote', () => {
    commitFile('f.txt', 'f\n', 'feature');
    git('update-ref', 'refs/remotes/origin/trunk', 'main');
    const o = ship({ base: 'trunk' });
    expect(o).toEqual({
      ok: false,
      error: 'diff_unavailable',
      detail: 'create the local branch from its remote (git branch <base> <remote>/<base>)',
    });
  });
});

/**
 * D58 (user pick, ship round 9, "Feature paths only"; pen MEDIUM, gate round 7): a captured fail is compared with HEAD
 * only on the feature's own paths (its diff from the merge base, plus what the reviewed tree changed against the
 * review-time merge base), so a teammate's commits brought in by a rebase or a merge never clear an unfixed fail.
 */
describe('assembleShip: only the feature\'s own paths clear a captured fail (D58)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const BRANCH = `feat/${FEATURE}/ship`;
  beforeEach(() => {
    commitFile('feature.txt', 'vuln\n', 'feature');
    commitFile('other.txt', 'other\n', 'feature 2');
  });

  /** The security agent fails the committed feature (tree, tracked tree and HEAD as capture records them). */
  function failOnHead(): void {
    const tree = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'security', verdict: 'fail', findings: { ...ZERO, medium: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, headSha: git('rev-parse', 'HEAD'),
    });
  }

  /** A teammate's commit lands on main. */
  function teammateCommit(): void {
    git('checkout', '-q', 'main');
    commitFile('mate.txt', 'mate\n', 'mate');
    git('checkout', '-q', BRANCH);
  }

  const security = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'security');

  // Behaviour: an honest model updates main and rebases; the flagged code is unchanged, so the fail stays open.
  it('a rebase onto a teammate\'s commit, with the flagged file unchanged, keeps the fail open', () => {
    failOnHead();
    teammateCommit();
    git('rebase', '-q', 'main');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a merge of main into the feature, with the flagged file unchanged, keeps the fail open', () => {
    failOnHead();
    teammateCommit();
    git('merge', '-q', '--no-edit', 'main');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a rebase, then a real fix to the flagged file, clears the fail', () => {
    failOnHead();
    teammateCommit();
    git('rebase', '-q', 'main');
    commitFile('feature.txt', 'fixed\n', 'fix');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // D49 within the feature: any tracked change to the feature's own code clears.
  it('a rebase, then a change to another feature file, clears the fail', () => {
    failOnHead();
    teammateCommit();
    git('rebase', '-q', 'main');
    commitFile('other.txt', 'changed\n', 'other change');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // Rule: a flagged change the feature has since reverted to the base content still counts as a change.
  it('a reviewed edit to a base file that the feature then drops clears the fail', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'flagged edit\n');
    git('add', 'a.txt');
    const tree = git('write-tree');
    git('reset', '-q');
    git('checkout', '-q', '--', 'a.txt');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'security', verdict: 'fail', findings: { ...ZERO, medium: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, headSha: git('rev-parse', 'HEAD'),
    });
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });
});

/**
 * Perf low F1 (gate round 7): D55's object checks ran before every comparison, so a cleared row cost about 3 git
 * processes. The comparison runs first, and a row is checked for pruned objects only when git could not compare it.
 */
describe('assembleShip: a cleared fail row costs about one git process (perf F1)', { timeout: 120_000 }, () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const ROWS = 200;
  beforeEach(() => commitFile('b.txt', 'x\n', 'add'));

  /** ROWS fails, each on its own reviewed tree (b.txt edited differently), written through a scratch index. */
  function distinctFails(): void {
    const idx = path.join(repo, '.git', 'scratch-index');
    const headSha = git('rev-parse', 'HEAD');
    const ledger = openLedger(repo);
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    for (let i = 0; i < ROWS; i++) {
      fs.copyFileSync(path.join(repo, '.git', 'index'), idx);
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, env, input: `v${i}\n`, encoding: 'utf-8' }).trim();
      execFileSync('git', ['update-index', '--cacheinfo', `100644,${blob},b.txt`], { cwd: repo, env: { ...env, GIT_INDEX_FILE: idx } });
      const tree = execFileSync('git', ['write-tree'], { cwd: repo, env: { ...env, GIT_INDEX_FILE: idx }, encoding: 'utf-8' }).trim();
      const ts = new Date(Date.parse('2026-11-13T09:00:00.000Z') + i * 1000).toISOString();
      ledger.appendRow(`verdicts/${FEATURE}`, {
        gate: GATES[i % 3], verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: `a${i}`, session: 's', ts, tree, trackedTree: tree, headSha,
      });
    }
  }

  it(`${ROWS} fails on ${ROWS} distinct reviewed trees, all cleared: passes, with at most 2.5 git processes per row`, () => {
    distinctFails();
    allPass(1);
    spawns.n = 0;
    const r = result(ship());
    expect(r.verdict).toBe('ready_to_merge');
    expect(spawns.n).toBeLessThanOrEqual(ROWS * 2.5);
  });
});

/** Code-review low (gate round 7): a fail row with only a headSha whose commit was pruned no longer blocks for good. */
describe('assembleShip: a headSha-only fail whose commit was pruned is ignored (D55)', { timeout: 60_000 }, () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  it('the commit was amended away and pruned with gc --prune=now: ignored, the gate keeps its model line', () => {
    commitFile('b.txt', 'vuln\n', 'feature');
    const lost = git('rev-parse', 'HEAD');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', headSha: lost,
    });
    fs.writeFileSync(path.join(repo, 'b.txt'), 'vuln, reworded\n');
    git('commit', '-q', '-a', '--amend', '-m', 'feature, amended');
    git('reflog', 'expire', '--expire-unreachable=now', '--all');
    git('gc', '-q', '--prune=now');
    expect(() => git('cat-file', '-e', lost)).toThrow();
    allPass(1);
    const g = (result(ship()).gates as Array<Record<string, unknown>>).find((x) => x.gate === 'code-review');
    expect(g).toMatchObject({ verdict: 'pass', source: 'model' });
  });
});

/**
 * Pen low 1, security info 3, code-review info (gate round 7): with several remotes, the diff base was the first
 * same-name ref in name order. It is now the most advanced candidate that contains the local tip and not HEAD.
 */
describe('assembleShip: the diff base is the most advanced same-name remote ref (pen L1)', () => {
  /** Upstream moved twice; the fork (origin) synced only the first move; the feature is cut from upstream's tip. */
  function forkAndUpstream(): { fork: string; upstream: string } {
    git('checkout', '-q', '--detach', 'main');
    commitFile('a1.txt', Array.from({ length: 100 }, (_, i) => `${i}\n`).join(''), 'a1');
    const fork = git('rev-parse', 'HEAD');
    commitFile('b1.txt', Array.from({ length: 100 }, (_, i) => `${i}\n`).join(''), 'b1');
    const upstream = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-B', `feat/${FEATURE}/ship`, upstream);
    commitFile('f.txt', 'f\n', 'feature');
    return { fork, upstream };
  }

  it('a fork behind upstream: the diff is the feature\'s 1 file and 1 insertion', () => {
    const { fork, upstream } = forkAndUpstream();
    allPass(1);
    const refs = new Map([['refs/remotes/origin/main', fork], ['refs/remotes/upstream/main', upstream]]);
    expect(result(ship({ remoteRefs: refs })).diff).toEqual({ base: upstream, baseRef: 'main', files: 1, insertions: 1, deletions: 0 });
  });

  // Rule: a same-name ref that already contains HEAD (the feature pushed there) is never the base.
  it('a same-name ref that already contains HEAD is skipped', () => {
    const { upstream } = forkAndUpstream();
    allPass(1);
    const refs = new Map([['refs/remotes/aaa/main', git('rev-parse', 'HEAD')], ['refs/remotes/upstream/main', upstream]]);
    expect(result(ship({ remoteRefs: refs })).diff).toMatchObject({ base: upstream, files: 1 });
  });
});

/** Code-review info (gate round 7): the create-the-branch hint is shown only for a name git accepts as a branch. */
describe('assembleShip: no branch hint for a name that is not a valid branch name', () => {
  it('a base name check-ref-format refuses gives diff_unavailable with no hint', () => {
    commitFile('f.txt', 'f\n', 'feature');
    expect(ship({ base: 'bad..name' })).toEqual({ ok: false, error: 'diff_unavailable' });
  });
});

/**
 * D61 (user pick, ship round 10, "Use live remote base"; security, code review and pen test, gate round 8): an honest
 * model fetches and rebases onto, or merges, an updated origin/main mid-run while local main stays stale. The live
 * refs/remotes/<r>/<base> that HEAD already contains and that fast-forwards the chosen base is the diff base, so the
 * teammate's files neither count in the diff nor clear an unfixed fail. It only narrows the feature's paths.
 */
describe('assembleShip: a live remote base that HEAD already contains (D61)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const BRANCH = `feat/${FEATURE}/ship`;
  beforeEach(() => commitFile('feature.txt', 'vuln\n', 'feature'));

  function failOnHead(): void {
    const tree = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'security', verdict: 'fail', findings: { ...ZERO, medium: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, headSha: git('rev-parse', 'HEAD'),
    });
  }

  /** A teammate's commit reaches origin/main through a fetch; local main stays where it was. */
  function upstreamMoves(): string {
    git('checkout', '-q', '--detach', 'main');
    commitFile('mate.txt', 'mate\n', 'mate');
    const u = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', u);
    git('checkout', '-q', BRANCH);
    return u;
  }

  const security = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'security');

  it('a rebase onto the updated origin/main, the snapshot holding the old main: the fail stays, the diff is the feature\'s', () => {
    const s0 = git('rev-parse', 'main');
    failOnHead();
    const u = upstreamMoves();
    git('rebase', '-q', 'origin/main');
    allPass(1);
    const r = result(ship({ remoteRefs: new Map([['refs/remotes/origin/main', s0]]) }));
    expect(security(ship({ remoteRefs: new Map([['refs/remotes/origin/main', s0]]) }))).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(r.diff).toEqual({ base: u, baseRef: 'main', files: 1, insertions: 1, deletions: 0 });
  });

  it('a rebase onto the updated origin/main with an empty snapshot: the fail stays', () => {
    failOnHead();
    upstreamMoves();
    git('rebase', '-q', 'origin/main');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a merge of the updated origin/main: the fail stays, the diff is the feature\'s', () => {
    const s0 = git('rev-parse', 'main');
    failOnHead();
    const u = upstreamMoves();
    git('merge', '-q', '--no-edit', 'origin/main');
    allPass(1);
    const o = ship({ remoteRefs: new Map([['refs/remotes/origin/main', s0]]) });
    expect(security(o)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(o).diff).toMatchObject({ base: u, files: 1 });
  });

  it('a snapshot that already holds the new upstream: unchanged, the fail stays', () => {
    failOnHead();
    const u = upstreamMoves();
    git('rebase', '-q', 'origin/main');
    allPass(1);
    const o = ship({ remoteRefs: new Map([['refs/remotes/origin/main', u]]) });
    expect(security(o)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(o).diff).toMatchObject({ base: u, files: 1 });
  });

  it('a rebase onto the updated origin/main, then a real fix: the fail clears', () => {
    failOnHead();
    upstreamMoves();
    git('rebase', '-q', 'origin/main');
    commitFile('feature.txt', 'fixed\n', 'fix');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // Rule: a live ref HEAD does not contain (upstream moved but the feature was not rebased) never moves the base.
  it('a fetched origin/main the feature has not taken in leaves the base at local main', () => {
    upstreamMoves();
    allPass(1);
    expect(result(ship()).diff).toMatchObject({ base: git('rev-parse', 'main'), files: 1 });
  });
});

/**
 * D62 (user pick, ship round 10, "Compare the feature's patch"; pen L1, gate round 8): a teammate edits the flagged file
 * elsewhere and the model rebases with no fix. For a feature path upstream also changed since review, the fail clears
 * only when the feature's own change to that path differs (patch-id of review base to reviewed tree, against merge
 * base to HEAD). Paths upstream did not touch keep the whole-file comparison (D58).
 */
describe('assembleShip: a flagged file that upstream also changed (D62)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const BRANCH = `feat/${FEATURE}/ship`;
  const lines = (edit: Record<number, string> = {}): string =>
    Array.from({ length: 30 }, (_, i) => `${edit[i + 1] ?? i + 1}\n`).join('');

  beforeEach(() => {
    git('checkout', '-q', 'main');
    commitFile('shared.txt', lines(), 'shared');
    git('checkout', '-q', BRANCH);
    git('rebase', '-q', 'main');
    commitFile('shared.txt', lines({ 15: 'VULN' }), 'feature');
    const tree = git('rev-parse', 'HEAD^{tree}');
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
      gate: 'security', verdict: 'fail', findings: { ...ZERO, medium: 1 }, agent: 'a', session: 's',
      ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, headSha: git('rev-parse', 'HEAD'),
    });
  });

  function mateEdits(edit: Record<number, string>): void {
    git('checkout', '-q', 'main');
    commitFile('shared.txt', lines(edit), 'mate');
    git('checkout', '-q', BRANCH);
  }

  const security = (o: AssembleOutcome): Record<string, unknown> | undefined =>
    (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'security');

  it('a teammate edits another line of the flagged file, the model rebases with no fix: the fail stays', () => {
    mateEdits({ 2: 'teammate' });
    git('rebase', '-q', 'main');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a teammate edits a line three above the flagged one (inside its diff context): the fail stays', () => {
    mateEdits({ 12: 'teammate' });
    git('rebase', '-q', 'main');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // ⚠ changes existing test: code-review L4 (gate round 9): the teammate also edits a second line, so the feature's
  // removed lines differ while its added (flagged) line does not.
  it('a conflict on the flagged line, resolved to the flagged code: the fail stays', () => {
    mateEdits({ 2: 'teammate2', 15: 'teammate15' });
    expect(() => git('rebase', '-q', 'main')).toThrow();
    fs.writeFileSync(path.join(repo, 'shared.txt'), lines({ 2: 'teammate2', 15: 'VULN' }));
    git('add', 'shared.txt');
    execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: repo, stdio: 'ignore', env: { ...process.env, GIT_EDITOR: 'true' } });
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // ⚠ changes existing test: D67 — upstream changed the flagged file since review, so even a real fix to it no longer
  // clears the fail (it was "the fail clears"); an override or a fix to another feature path does.
  it('a teammate edits another line, then a real fix to the flagged line: the fail stays (D67)', () => {
    mateEdits({ 2: 'teammate' });
    git('rebase', '-q', 'main');
    commitFile('shared.txt', lines({ 2: 'teammate', 15: 'safe' }), 'fix');
    allPass(1);
    expect(security(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });
});

/**
 * Code-review low 2 and pen info 1 (gate round 8): two same-name remotes that diverged (a fork-only commit), the feature
 * cut from upstream. The base is upstream's tip, chosen by topology, not commit time (ties and clock skew broke it).
 */
describe('assembleShip: diverged same-name remotes (code-review low 2, pen info 1)', () => {
  function diverged(forkDate: string): { fork: string; upstream: string } {
    const env = { ...process.env, GIT_COMMITTER_DATE: '2026-11-19T10:00:00+0000', GIT_AUTHOR_DATE: '2026-11-19T10:00:00+0000' };
    const at = (date: string, name: string, msg: string): string => {
      fs.writeFileSync(path.join(repo, name), Array.from({ length: 50 }, (_, i) => `${i}\n`).join(''));
      git('add', name);
      execFileSync('git', ['commit', '-q', '-m', msg], { cwd: repo, env: { ...env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
      return git('rev-parse', 'HEAD');
    };
    git('checkout', '-q', '--detach', 'main');
    const fork = at(forkDate, 'fork-only.txt', 'C');
    git('checkout', '-q', '--detach', 'main');
    for (const i of [1, 2]) at('2026-11-19T10:00:00+0000', `up${i}.txt`, `U${i}`);
    const upstream = at('2026-11-19T10:00:00+0000', 'up3.txt', 'U3');
    git('checkout', '-q', '-B', `feat/${FEATURE}/ship`, upstream);
    commitFile('f.txt', 'f\n', 'feature');
    return { fork, upstream };
  }

  for (const [label, date] of [['equal commit times', '2026-11-19T10:00:00+0000'], ['a fork commit dated later', '2026-11-19T12:00:00+0000']]) {
    it(`${label}: the diff base is upstream's tip, the diff is the feature's 1 file`, () => {
      const { fork, upstream } = diverged(date);
      allPass(1);
      const refs = new Map([['refs/remotes/origin/main', fork], ['refs/remotes/upstream/main', upstream]]);
      expect(result(ship({ remoteRefs: refs })).diff).toEqual({ base: upstream, baseRef: 'main', files: 1, insertions: 1, deletions: 0 });
    });
  }
});

/**
 * Code-review info 1 (gate round 8): with the review headSha unknown (null, or pruned), the review-time base is not
 * known, so only the feature's own paths count; a teammate's file brought in by a rebase no longer clears the fail.
 */
describe('assembleShip: a fail with no usable review headSha counts only the feature\'s paths (code-review info 1)', () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  for (const [label, headSha] of [['no headSha', undefined], ['a headSha git does not have', 'deadbeef'.repeat(5)]] as const) {
    it(`${label}, then a rebase onto a teammate's commit: the fail stays`, () => {
      commitFile('f.txt', 'vuln\n', 'feature');
      const tree = git('rev-parse', 'HEAD^{tree}');
      openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
        gate: 'security', verdict: 'fail', findings: { ...ZERO, medium: 1 }, agent: 'a', session: 's',
        ts: '2026-11-13T09:10:00.000Z', tree, trackedTree: tree, ...(headSha === undefined ? {} : { headSha }),
      });
      git('checkout', '-q', 'main');
      commitFile('mate.txt', 'mate\n', 'mate');
      git('checkout', '-q', `feat/${FEATURE}/ship`);
      git('rebase', '-q', 'main');
      allPass(1);
      const g = (result(ship()).gates as Array<Record<string, unknown>>).find((x) => x.gate === 'security');
      expect(g).toMatchObject({ verdict: 'fail', source: 'agent' });
    });
  }
});

/**
 * Perf low 1 (gate round 8): rows with distinct review heads whose flagged file was later deleted cost 2-4 git processes
 * each (a merge-base, then two path lists), 18.9 s at 200 rows on a big repo. A review head on the feature's own
 * history needs no merge-base, and "was this path tracked at review" is one batched object lookup.
 */
describe('assembleShip: distinct review heads with a deleted flagged file stay cheap (perf low 1, gate round 8)', { timeout: 120_000 }, () => {
  const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const ROWS = 200;

  it(`${ROWS} fails on ${ROWS} review heads, the flagged file then deleted: all cleared, at most 2.5 git processes per row`, () => {
    commitFile('other.txt', 'keep\n', 'feature');
    commitFile('flagged.txt', 'vuln\n', 'feature 2');
    const tree = git('rev-parse', 'HEAD^{tree}');
    const ledger = openLedger(repo);
    let head = git('rev-parse', 'HEAD');
    for (let i = 0; i < ROWS; i++) {
      head = git('commit-tree', tree, '-p', head, '-m', `review ${i}`);
      ledger.appendRow(`verdicts/${FEATURE}`, {
        gate: GATES[i % 3], verdict: 'fail', findings: { ...ZERO, high: 1 }, agent: `a${i}`, session: 's',
        ts: new Date(Date.parse('2026-11-13T09:00:00.000Z') + i * 1000).toISOString(), tree, trackedTree: tree, headSha: head,
      });
    }
    git('reset', '-q', '--hard', head);
    git('rm', '-q', 'flagged.txt');
    git('commit', '-q', '-m', 'drop the flagged file');
    allPass(1);
    spawns.n = 0;
    const r = result(ship());
    expect(r.verdict).toBe('ready_to_merge');
    expect(spawns.n).toBeLessThanOrEqual(ROWS * 2.5);
  });
});

/** Shared by the gate round 9 blocks below: the security agent fails the committed feature, as capture records it. */
const ZERO9 = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
const BRANCH9 = `feat/${FEATURE}/ship`;
function failOnHead9(tree = git('rev-parse', 'HEAD^{tree}'), headSha = git('rev-parse', 'HEAD'), gate = 'security', ts = '2026-11-13T09:10:00.000Z'): void {
  openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
    gate, verdict: 'fail', findings: { ...ZERO9, medium: 1 }, agent: 'a', session: 's', ts, tree, trackedTree: tree, headSha,
  });
}
/** A teammate's commit on main (`file` set to `content`); the feature branch is checked out again. */
function mateOnMain9(file: string, content: string): string {
  git('checkout', '-q', 'main');
  commitFile(file, content, `mate ${file}`);
  const s = git('rev-parse', 'HEAD');
  git('checkout', '-q', BRANCH9);
  return s;
}
const security9 = (o: AssembleOutcome): Record<string, unknown> | undefined =>
  (result(o).gates as Array<Record<string, unknown>>).find((g) => g.gate === 'security');

/**
 * Code-review high (gate round 9): the per-path lookup used `cat-file --batch-check=%(objectmode)`, which Apple's
 * Command Line Tools git 2.50.1 and Debian's 2.39.5 refuse ("bad cat-file format"), so on those machines a captured
 * fail could never clear. /usr/bin/git on macOS runs the Command Line Tools git when DEVELOPER_DIR points at them.
 */
/**
 * ⚠ changes existing test: info (gate round 10) — the older-git cases no longer skip silently. The git assemble runs is
 * /usr/bin/git (gitBin): either itself older than 2.53 (Debian, say), or Apple's shim, which runs the Command Line Tools
 * or an Xcode git when DEVELOPER_DIR points at it. With none of those older than 2.53, the cases fail with what to install.
 */
const OLDER_GIT_MISSING = 'no git older than 2.53 found at /usr/bin/git (directly, or through DEVELOPER_DIR=/Library/Developer/CommandLineTools or an Xcode app): install the Apple Command Line Tools (xcode-select --install) or a git older than 2.53 at /usr/bin/git';
const olderGit = ((): { developerDir: string | undefined } | null => {
  const older = (developerDir: string | undefined): boolean => {
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (developerDir === undefined) delete env.DEVELOPER_DIR;
      else env.DEVELOPER_DIR = developerDir;
      const m = /git version (\d+)\.(\d+)/.exec(execFileSync('/usr/bin/git', ['--version'], { env, encoding: 'utf-8' }));
      return m !== null && (Number(m[1]) < 2 || (Number(m[1]) === 2 && Number(m[2]) < 53));
    } catch {
      return false;
    }
  };
  const xcodes = fs.existsSync('/Applications')
    ? fs.readdirSync('/Applications').filter((a) => /^Xcode.*\.app$/.test(a)).map((a) => `/Applications/${a}/Contents/Developer`)
    : [];
  for (const dir of ['/Library/Developer/CommandLineTools', ...xcodes]) {
    if (fs.existsSync(`${dir}/usr/bin/git`) && older(dir)) return { developerDir: dir };
  }
  return older(undefined) ? { developerDir: undefined } : null;
})();
describe('assembleShip on an older git (Apple Command Line Tools git, code-review high, gate round 9)', () => {
  function withOlderGit<T>(fn: () => T): T {
    if (olderGit === null) throw new Error(OLDER_GIT_MISSING);
    const saved = process.env.DEVELOPER_DIR;
    if (olderGit.developerDir === undefined) delete process.env.DEVELOPER_DIR;
    else process.env.DEVELOPER_DIR = olderGit.developerDir;
    try {
      return fn();
    } finally {
      if (saved === undefined) delete process.env.DEVELOPER_DIR;
      else process.env.DEVELOPER_DIR = saved;
    }
  }

  it('an older git is found here', () => {
    expect(olderGit, OLDER_GIT_MISSING).not.toBeNull();
  });

  // ⚠ changes existing test: code-review L4 (gate round 10) — also asserts the deleted path was looked up with ls-tree,
  // not the --diff-filter=A path list (64 or fewer deletions).
  it('the fix deletes the flagged new file: the fail clears, through the ls-tree lookup', () => {
    commitFile('keep.txt', 'k\n', 'keep');
    commitFile('f.txt', 'vuln\n', 'feature');
    failOnHead9();
    git('rm', '-q', 'f.txt');
    git('commit', '-q', '-m', 'fix: drop the vulnerable file');
    allPass(1);
    spawns.args = [];
    expect(withOlderGit(() => security9(ship()))).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(spawns.args.some((a) => a.includes('ls-tree'))).toBe(true);
    expect(spawns.args.some((a) => a.includes('--diff-filter=A'))).toBe(false);
  });

  it('a teammate commit, a rebase, then a real fix: the fail clears', () => {
    commitFile('f.txt', 'vuln\n', 'feature');
    failOnHead9();
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    commitFile('f.txt', 'safe\n', 'fix');
    allPass(1);
    expect(withOlderGit(() => security9(ship()))).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  it('a teammate commit and a rebase with no fix: the fail stays', () => {
    commitFile('f.txt', 'vuln\n', 'feature');
    failOnHead9();
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    allPass(1);
    expect(withOlderGit(() => security9(ship()))).toMatchObject({ verdict: 'fail', source: 'agent' });
  });
});

/** Code-review low (gate round 9): a submodule (gitlink, mode 160000) is a present entry, not a lookup error. */
describe('assembleShip: submodule entries (code-review low, gate round 9)', () => {
  const gitlink = (sha: string): void => {
    git('update-index', '--add', '--cacheinfo', `160000,${sha},sub`);
  };

  it('the fix deletes a flagged submodule the feature added: the fail clears', () => {
    commitFile('keep.txt', 'k\n', 'keep');
    gitlink('1'.repeat(40));
    git('commit', '-q', '-m', 'add submodule');
    failOnHead9();
    git('rm', '-q', '--cached', 'sub');
    git('commit', '-q', '-m', 'fix: drop the submodule');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  it('a submodule bump on a feature path after a rebase onto a teammate commit: the fail clears', () => {
    git('checkout', '-q', 'main');
    gitlink('1'.repeat(40));
    git('commit', '-q', '-m', 'submodule on main');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    gitlink('2'.repeat(40));
    git('commit', '-q', '-m', 'feature bumps the submodule');
    failOnHead9();
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    gitlink('3'.repeat(40));
    git('commit', '-q', '-m', 'fix: bump again');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });
});

/**
 * D64 (user pick, ship round 11, "Use merge base with HEAD"; security G, code-review P9, pen fetchafter, gate round 9):
 * after a rebase onto origin/main, a later fetch moved origin/main past HEAD, the live base dropped it and the fail
 * cleared. The live base is now merge-base(<remote>/<base>, HEAD) for each same-name remote ref that contains the chosen
 * base, the most advanced one; it still only narrows the feature's paths.
 */
describe('assembleShip: the live base is the merge base of each same-name remote ref with HEAD (D64)', () => {
  beforeEach(() => commitFile('feature.txt', 'vuln\n', 'feature'));

  /** A teammate commit reaches `ref` through a fetch, on top of `on`; local main stays where it was. */
  function fetched(ref: string, on: string, file: string): string {
    git('checkout', '-q', '--detach', on);
    commitFile(file, `${file}\n`, `mate ${file}`);
    const u = git('rev-parse', 'HEAD');
    git('update-ref', ref, u);
    git('checkout', '-q', BRANCH9);
    return u;
  }

  it('a rebase onto origin/main, then a later fetch moves origin/main again: the fail stays, the diff is the feature\'s', () => {
    const s0 = git('rev-parse', 'main');
    failOnHead9();
    const u = fetched('refs/remotes/origin/main', 'main', 'mate.txt');
    git('rebase', '-q', 'origin/main');
    fetched('refs/remotes/origin/main', u, 'mate2.txt');
    allPass(1);
    const snapshot = new Map([['refs/remotes/origin/main', s0]]);
    const assembled = ship({ remoteRefs: snapshot });
    expect(security9(assembled)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(assembled).diff).toEqual({ base: u, baseRef: 'main', files: 1, insertions: 1, deletions: 0 });
    // ⚠ changes existing test: code-review L4 (gate round 10) — a fetch moves origin/main again between assemble and
    // check, so the test shows check (reassemble from the same snapshot) agrees with assemble after the remote moved.
    fetched('refs/remotes/origin/main', git('rev-parse', 'refs/remotes/origin/main'), 'mate3.txt');
    const checked = ship({ remoteRefs: snapshot });
    expect({ gates: result(checked).gates, diff: result(checked).diff }).toEqual({ gates: result(assembled).gates, diff: result(assembled).diff });
  });

  it('two diverged remotes that both contain the rebased-onto commit: the fail stays, the diff is the feature\'s', () => {
    failOnHead9();
    const u = fetched('refs/remotes/origin/main', 'main', 'mate.txt');
    git('update-ref', 'refs/remotes/upstream/main', u);
    git('rebase', '-q', 'origin/main');
    fetched('refs/remotes/origin/main', u, 'fork-only.txt');
    fetched('refs/remotes/upstream/main', u, 'upstream-only.txt');
    allPass(1);
    const o = ship();
    expect(security9(o)).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(o).diff).toEqual({ base: u, baseRef: 'main', files: 1, insertions: 1, deletions: 0 });
  });

  it('a rebase onto origin/main, a later fetch, then a real fix: the fail clears', () => {
    failOnHead9();
    const u = fetched('refs/remotes/origin/main', 'main', 'mate.txt');
    git('rebase', '-q', 'origin/main');
    fetched('refs/remotes/origin/main', u, 'mate2.txt');
    commitFile('feature.txt', 'fixed\n', 'fix');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });
});

/**
 * D65 (user pick, ship round 11, "Feature's added lines, exact"; security L, code-review M3/I6/I7, pen M2/L1, gate
 * round 9): for a feature path upstream also changed since review, the fail clears only when the feature's ordered
 * added lines (-U0, --inter-hunk-context=0, --text) or its mode lines differ, compared exactly but for a trailing CR.
 * patch-id ignored whitespace, hashed removed lines, followed diff.interHunkContext and treated -diff files as binary.
 */
// ⚠ changes existing test: D67 — renamed (was "a shared flagged file is compared by the feature's added lines (D65)"):
// D65's compare is removed, and every case here now stays open because upstream changed the flagged file.
describe('assembleShip: a shared flagged file upstream also changed stays open (D65 cases under D67)', () => {
  const numbered = (n: number, edit: Record<number, string> = {}, eol = '\n'): string =>
    Array.from({ length: n }, (_, i) => `${edit[i + 1] ?? `line ${i + 1}`}${eol}`).join('');

  /** `file` lands on main with `base`; the feature (rebased) sets it to `feature` and is failed. */
  function sharedFile(file: string, base: string, feature: string, extra: () => void = () => undefined): void {
    git('checkout', '-q', 'main');
    commitFile(file, base, `base ${file}`);
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    fs.writeFileSync(path.join(repo, file), feature);
    extra();
    git('add', file);
    git('commit', '-q', '-m', `feature ${file}`);
    failOnHead9();
  }

  it('with diff.interHunkContext=3 and a teammate edit between two feature hunks: the fail stays', () => {
    sharedFile('a20.txt', numbered(20), numbered(20, { 5: 'FIVE', 9: 'NINE' }));
    mateOnMain9('a20.txt', numbered(20, { 7: 'SEVEN' }));
    git('rebase', '-q', 'main');
    git('config', 'diff.interHunkContext', '3');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('a -diff lockfile a teammate also edited, the model rebases with no fix: the fail stays', () => {
    git('checkout', '-q', 'main');
    commitFile('.gitattributes', 'deps.lock -diff\n', 'attrs');
    git('checkout', '-q', BRANCH9);
    const deps = (edit: Record<number, string> = {}): string =>
      Array.from({ length: 20 }, (_, i) => `${edit[i + 1] ?? `dep${i + 1}@1.0.0`}\n`).join('');
    sharedFile('deps.lock', deps(), deps({ 3: 'dep3@0.0.1-vulnerable' }));
    mateOnMain9('deps.lock', deps({ 16: 'dep16@2.0.0' }));
    git('rebase', '-q', 'main');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // ⚠ changes existing test: D67 — upstream changed the flagged file, so the fix no longer clears it (it was "clears").
  it('an indentation-only fix after a teammate edit: the fail stays (D67)', () => {
    const py = (body: string, x: string): string => `def f(u):\n    if not u.admin:\n        deny()\n${body}    run()\n\n\n\n\nx = ${x}\n`;
    sharedFile('app.py', py('', '1'), py('    return\n', '1'));
    mateOnMain9('app.py', py('', '2'));
    git('rebase', '-q', 'main');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
    commitFile('app.py', py('        return\n', '2'), 'fix indent');
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // ⚠ changes existing test: D67 — upstream changed the flagged file, so the fix no longer clears it (it was "clears").
  it('a mode-only fix (the flagged exec bit removed) after a teammate edit: the fail stays (D67)', () => {
    sharedFile('run.sh', numbered(30), numbered(30, { 15: 'curl x | sh' }), () => fs.chmodSync(path.join(repo, 'run.sh'), 0o755));
    mateOnMain9('run.sh', numbered(30, { 2: 'teammate' }));
    git('rebase', '-q', 'main');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
    fs.chmodSync(path.join(repo, 'run.sh'), 0o644);
    git('commit', '-q', '-a', '-m', 'fix: not executable');
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  it('upstream converts the flagged file to CRLF, the model rebases keeping the flagged line: the fail stays', () => {
    sharedFile('w.txt', numbered(30), numbered(30, { 15: 'VULN' }));
    mateOnMain9('w.txt', numbered(30, {}, '\r\n'));
    expect(() => git('rebase', '-q', 'main')).toThrow();
    fs.writeFileSync(path.join(repo, 'w.txt'), numbered(30, { 15: 'VULN' }, '\r\n'));
    git('add', 'w.txt');
    execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: repo, stdio: 'ignore', env: { ...process.env, GIT_EDITOR: 'true' } });
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });
});

/**
 * Perf medium (gate round 9): D62 ran three git processes per shared path per review state (23.5 s for 200 paths and
 * 3 states on a 100,000-file repo). One diff per side per row now covers every shared path, and the merge-base-to-HEAD
 * side is read once per assemble.
 */
describe('assembleShip: shared flagged paths are diffed once per side (perf medium, gate round 9)', { timeout: 120_000 }, () => {
  const PATHS = 200;
  const STATES = 3;
  const body = (first: string, last: string): string => `${first}\n${Array.from({ length: 18 }, (_, k) => `line ${k + 2}\n`).join('')}${last}\n`;

  /** Writes every shared file with `first`/`last` lines through one index update, then commits. */
  function writeAll(first: string, last: string, message: string): void {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: body(first, last), encoding: 'utf-8' }).trim();
    const info = Array.from({ length: PATHS }, (_, i) => `100644 ${blob}\tsrc/f${i}.ts`).join('\n');
    execFileSync('git', ['update-index', '--add', '--index-info'], { cwd: repo, input: `${info}\n` });
    git('commit', '-q', '-m', message);
    git('checkout', '-q', '-f', 'HEAD');
  }

  it(`${PATHS} shared paths and ${STATES} review states, rebased with no fix: all stay open, a few git processes per row`, () => {
    git('checkout', '-q', 'main');
    writeAll('a', 'z', 'shared files');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    writeAll('a', 'FEAT', 'feature');
    const head = git('rev-parse', 'HEAD');
    const idx = path.join(repo, '.git', 'scratch-index');
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    for (let s = 0; s < STATES; s++) {
      fs.copyFileSync(path.join(repo, '.git', 'index'), idx);
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, env, input: `scratch ${s}\n`, encoding: 'utf-8' }).trim();
      execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},scratch-${s}.txt`], { cwd: repo, env: { ...env, GIT_INDEX_FILE: idx } });
      const tree = execFileSync('git', ['write-tree'], { cwd: repo, env: { ...env, GIT_INDEX_FILE: idx }, encoding: 'utf-8' }).trim();
      openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
        gate: GATES[s], verdict: 'fail', findings: { ...ZERO9, medium: 1 }, agent: `a${s}`, session: 's',
        ts: new Date(Date.parse('2026-11-13T09:10:00.000Z') + s * 1000).toISOString(), tree, trackedTree: git('rev-parse', 'HEAD^{tree}'), headSha: head,
      });
    }
    git('checkout', '-q', 'main');
    writeAll('UP', 'z', 'mate edits every shared file');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    allPass(1);
    spawns.n = 0;
    const r = result(ship());
    expect(r.blockers).toHaveLength(STATES);
    expect(spawns.n).toBeLessThanOrEqual(15 + STATES * 6);
  });
});

/**
 * Perf low (gate round 9): the probe lookup of the feature's own paths ran once per row; it is cached per
 * `<review base>:<path>`, so rows on a few off-history review heads cost about one git process each.
 */
describe('assembleShip: probe lookups are cached per review base (perf low, gate round 9)', { timeout: 120_000 }, () => {
  const ROWS = 60;
  const HEADS = 3;

  it(`${ROWS} cleared fails on ${HEADS} off-history review heads: at most 1.3 git processes per row`, () => {
    const heads: string[] = [];
    git('checkout', '-q', 'main');
    for (let h = 0; h < HEADS; h++) {
      commitFile(`hist${h}.txt`, `${h}\n`, `history ${h}`);
      heads.push(git('rev-parse', 'HEAD'));
    }
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    commitFile('flagged.txt', 'fixed\n', 'feature');
    const idx = path.join(repo, '.git', 'scratch-index');
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    for (let i = 0; i < ROWS; i++) {
      fs.copyFileSync(path.join(repo, '.git', 'index'), idx);
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, env, input: `vuln ${i}\n`, encoding: 'utf-8' }).trim();
      execFileSync('git', ['update-index', '--cacheinfo', `100644,${blob},flagged.txt`], { cwd: repo, env: { ...env, GIT_INDEX_FILE: idx } });
      const tree = execFileSync('git', ['write-tree'], { cwd: repo, env: { ...env, GIT_INDEX_FILE: idx }, encoding: 'utf-8' }).trim();
      failOnHead9(tree, heads[i % HEADS], GATES[i % 3], new Date(Date.parse('2026-11-13T09:00:00.000Z') + i * 1000).toISOString());
    }
    allPass(1);
    spawns.n = 0;
    expect(result(ship()).verdict).toBe('ready_to_merge');
    expect(spawns.n).toBeLessThanOrEqual(ROWS * 1.3);
  });
});

/** D67: the blocker of a gate held open because upstream changed a feature file since review (fixed text, never a path). */
// ⚠ changes existing test: D71 — rows don't record which file was flagged, so the text says "a file this feature changes"
const UPSTREAM_CHANGED = (gate: string): string =>
  `gate:${gate} (captured fail, not re-reviewed: upstream changed a file this feature changes; a recorded override or a fix elsewhere in the feature clears it)`;
const NOT_RE_REVIEWED_TEXT = (gate: string): string =>
  `gate:${gate} (captured fail, not re-reviewed: a tracked code change is needed to clear it)`;

/**
 * D67 (user pick, ship round 12, "Fail closed + override"; security N/K/L/M, pen unfixed_renamed, code-review T4, gate
 * round 10): when upstream changed a flagged path between the review-time base and the current merge base (content,
 * mode, deletion, or a rename to or from it), the fail stays open whatever the path holds now. It clears through a change
 * to another of the feature's own paths that upstream did not touch (D49). Paths upstream did not touch keep D58.
 */
describe('assembleShip: a flagged file upstream changed since review stays open (D67)', () => {
  const BASE = ['def handler(u):', '    check_auth(u)', '    validate(u)', '    run(u)', '', '', '', '', '', '', 'X = 1'];
  const MATE = BASE.map((l) => (l === 'X = 1' ? 'X = 2' : l));
  const text = (ls: string[]): string => `${ls.join('\n')}\n`;
  const blockers = (o: AssembleOutcome): unknown => result(o).blockers;

  /** main gets app.py; the feature (other.txt plus `feature` in app.py) is failed; a teammate sets app.py to `mate`; rebase. */
  function setup(feature: string[], mate: string[]): void {
    git('checkout', '-q', 'main');
    commitFile('app.py', text(BASE), 'base py');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'other.txt'), 'other\n');
    git('add', 'other.txt');
    commitFile('app.py', text(feature), 'feature');
    failOnHead9();
    mateOnMain9('app.py', text(mate));
    git('rebase', '-q', 'main');
    allPass(1);
  }

  it('K: the feature deletes a check; restoring it after a teammate edit keeps the fail open, saying upstream changed the file', () => {
    setup(BASE.filter((l) => !l.includes('check_auth')), MATE);
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
    commitFile('app.py', text(MATE), 'restore check');
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('L: the feature deletes a check and adds a log line; restoring the check keeps the fail open', () => {
    const f = BASE.filter((l) => !l.includes('check_auth'));
    f.splice(3, 0, '    log(u)');
    setup(f, MATE);
    const fixed = [...MATE];
    fixed.splice(4, 0, '    log(u)');
    commitFile('app.py', text(fixed), 'restore check');
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('M: the feature adds a check after run; moving it before run keeps the fail open', () => {
    const f = [...BASE];
    f.splice(4, 0, '    require_admin(u)');
    setup(f, MATE);
    const fixed = [...MATE];
    fixed.splice(3, 0, '    require_admin(u)');
    commitFile('app.py', text(fixed), 'move check before run');
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('N: a same-line conflict resolved by merging the teammate edit with the flagged code keeps the fail open', () => {
    git('checkout', '-q', 'main');
    commitFile('app.py', text(BASE), 'base py');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    commitFile('app.py', text(BASE.map((l) => (l === '    run(u)' ? '    run(u, verify=False)' : l))), 'feature');
    failOnHead9();
    mateOnMain9('app.py', text(MATE.map((l) => (l === '    run(u)' ? '    run(user=u)' : l))));
    expect(() => git('rebase', '-q', 'main')).toThrow();
    fs.writeFileSync(path.join(repo, 'app.py'), text(MATE.map((l) => (l === '    run(u)' ? '    run(user=u, verify=False)' : l))));
    git('add', 'app.py');
    execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: repo, stdio: 'ignore', env: { ...process.env, GIT_EDITOR: 'true' } });
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('upstream renames the flagged file, the rebase carries the flagged code along: the fail stays, with or without a fix', () => {
    const lines = (edit: Record<number, string> = {}): string => Array.from({ length: 30 }, (_, i) => `${edit[i + 1] ?? i + 1}\n`).join('');
    git('checkout', '-q', 'main');
    commitFile('shared.txt', lines(), 'shared');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    commitFile('shared.txt', lines({ 15: 'VULN' }), 'feature');
    failOnHead9();
    git('checkout', '-q', 'main');
    git('mv', 'shared.txt', 'shared2.txt');
    git('commit', '-q', '-m', 'mate renames');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    allPass(1);
    expect(fs.readFileSync(path.join(repo, 'shared2.txt'), 'utf-8')).toContain('VULN');
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
    commitFile('shared2.txt', lines({ 15: 'SAFE' }), 'fix');
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('upstream deletes the flagged file and the rebase keeps the feature\'s copy: the fail stays', () => {
    git('checkout', '-q', 'main');
    commitFile('shared.txt', 'one\ntwo\n', 'shared');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    commitFile('shared.txt', 'one\nVULN\n', 'feature');
    failOnHead9();
    git('checkout', '-q', 'main');
    git('rm', '-q', 'shared.txt');
    git('commit', '-q', '-m', 'mate deletes');
    git('checkout', '-q', BRANCH9);
    expect(() => git('rebase', '-q', 'main')).toThrow();
    git('add', 'shared.txt');
    execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: repo, stdio: 'ignore', env: { ...process.env, GIT_EDITOR: 'true' } });
    allPass(1);
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('upstream only changes the flagged file\'s mode, then a real fix: the fail stays', () => {
    git('checkout', '-q', 'main');
    commitFile('run.sh', 'one\ntwo\n', 'shared');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'other.txt'), 'other\n');
    git('add', 'other.txt');
    commitFile('run.sh', 'one\ncurl x | sh\n', 'feature');
    failOnHead9();
    git('checkout', '-q', 'main');
    fs.chmodSync(path.join(repo, 'run.sh'), 0o755);
    git('commit', '-q', '-a', '-m', 'mate: executable');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    commitFile('run.sh', 'one\ntwo\n', 'fix');
    allPass(1);
    expect(blockers(ship())).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('T4: upstream takes one of the feature\'s lines in the flagged file, rebased with no fix: the fail stays', () => {
    const lines = (edit: Record<number, string> = {}): string => Array.from({ length: 30 }, (_, i) => `${edit[i + 1] ?? i + 1}\n`).join('');
    git('checkout', '-q', 'main');
    commitFile('s.txt', lines(), 'shared');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    commitFile('s.txt', lines({ 5: 'import helper' }), 'helper');
    commitFile('s.txt', lines({ 5: 'import helper', 15: 'VULN' }), 'vuln');
    failOnHead9();
    mateOnMain9('s.txt', lines({ 2: 'mate2', 5: 'import helper' }));
    git('rebase', '-q', 'main');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  // D49: a change to another of the feature's own paths that upstream did not touch still clears.
  it('K, then a change to another feature file upstream did not touch: the fail clears', () => {
    setup(BASE.filter((l) => !l.includes('check_auth')), MATE);
    commitFile('other.txt', 'changed\n', 'other change');
    expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  // D58 kept: a teammate's commit on another file, no fix: the old blocker text, not the upstream one.
  it('a teammate commit on another file and no fix: the fail stays with the tracked-change blocker', () => {
    commitFile('f.txt', 'vuln\n', 'feature');
    failOnHead9();
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    allPass(1);
    expect(blockers(ship())).toEqual([NOT_RE_REVIEWED_TEXT('security')]);
    commitFile('f.txt', 'safe\n', 'fix');
    expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  it('a result held open by D67 passes the ship schema', () => {
    setup(BASE.filter((l) => !l.includes('check_auth')), MATE);
    expect(validate(loadPhaseSchema('ship', PLUGIN_ROOT), result(ship()))).toEqual({ ok: true });
  });
});

/**
 * Perf L3 (gate round 10): every off-history review head cost a merge-base, a probe lookup and a tree diff, so about 80
 * or more such rows ran past Stop's check deadline. The review bases come from one rev-list and the tree diffs from one
 * batched diff-tree process.
 */
describe('assembleShip: fail rows on distinct off-history review heads stay cheap (perf L3, gate round 10)', { timeout: 120_000 }, () => {
  const ROWS = 200;

  function offHistoryRows(): void {
    const old = git('rev-parse', 'main');
    commitFile('flagged.txt', 'vuln\n', 'feature');
    const tree = git('rev-parse', 'HEAD^{tree}');
    for (let i = 0; i < ROWS; i++) {
      const head = git('commit-tree', tree, '-p', old, '-m', `pre-rebase review ${i}`);
      failOnHead9(tree, head, GATES[i % 3], new Date(Date.parse('2026-11-13T09:00:00.000Z') + i * 1000).toISOString());
    }
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    allPass(1);
  }

  it(`${ROWS} open fails on ${ROWS} distinct off-history heads: still blocked, with a bounded number of git processes`, () => {
    offHistoryRows();
    spawns.n = 0;
    const r = result(ship());
    expect(r.blockers).toHaveLength(3);
    expect(spawns.n).toBeLessThanOrEqual(50);
  });

  it(`${ROWS} fails on ${ROWS} distinct off-history heads, all cleared by a fix: passes, with a bounded number of git processes`, () => {
    offHistoryRows();
    commitFile('flagged.txt', 'safe\n', 'fix');
    spawns.n = 0;
    expect(result(ship()).verdict).toBe('ready_to_merge');
    expect(spawns.n).toBeLessThanOrEqual(50);
  });
});

/** Code-review L3 and perf I1 (gate round 10): many same-name remote refs at one commit cost one merge-base, not one each. */
describe('assembleShip: the live base dedupes same-name remote refs by commit (code-review L3, perf I1)', () => {
  it('50 remotes whose main all point at the rebased-onto commit: one merge-base, the diff is the feature\'s', () => {
    commitFile('feature.txt', 'vuln\n', 'feature');
    git('checkout', '-q', '--detach', 'main');
    commitFile('mate.txt', 'mate\n', 'mate');
    const u = git('rev-parse', 'HEAD');
    git('checkout', '-q', BRANCH9);
    for (let i = 0; i < 50; i++) {
      git('update-ref', `refs/remotes/r${i}/main`, u);
      git('update-ref', `refs/remotes/r${i}/other`, u);
    }
    git('rebase', '-q', u);
    allPass(1);
    spawns.n = 0;
    spawns.args = [];
    const r = result(ship());
    expect(r.diff).toEqual({ base: u, baseRef: 'main', files: 1, insertions: 1, deletions: 0 });
    expect(spawns.args.filter((a) => a.includes('merge-base') && !a.includes('--independent')).length).toBeLessThanOrEqual(3);
    expect(spawns.n).toBeLessThanOrEqual(15);
  });
});

/**
 * Perf L1/L2 and code-review L1 (gate round 10) were costs of D65's batched -U0 diff (20,000 shared paths, 32 MB binaries,
 * a CR or U+2028 split of its text). D67 removed that diff; this keeps the shape fast and the fail open.
 */
describe('assembleShip: a large binary and 20,000 shared paths changed on both sides (perf L1/L2, D67)', { timeout: 120_000 }, () => {
  const PATHS = 20_000;

  /** A commit on `parent` whose tree is the parent's with every shared path, big.bin and `extra` set to `tag` (plumbing only). */
  function commitAll(parent: string, tag: string, extra: string[] = []): string {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    env.GIT_INDEX_FILE = path.join(repo, '.git', 'scratch-index');
    const g = (args: string[], input?: string | Buffer): string =>
      execFileSync('git', args, { cwd: repo, env, input, encoding: 'utf-8', maxBuffer: 1 << 26 }).trim();
    const blob = g(['hash-object', '-w', '--stdin'], `${tag}\n`);
    const big = Buffer.alloc(32 * 1024 * 1024, 0);
    big.write(tag, 0);
    big.write(tag, big.length - 64);
    const bigBlob = g(['hash-object', '-w', '--stdin'], big);
    g(['read-tree', parent]);
    const info = Array.from({ length: PATHS }, (_, i) => `100644 ${blob}\tsrc/d${i % 100}/f${i}.ts`);
    for (const p of ['big.bin', ...extra]) info.push(`100644 ${p === 'big.bin' ? bigBlob : blob}\t${p}`);
    g(['update-index', '--add', '--index-info'], `${info.join('\n')}\n`);
    return g(['commit-tree', g(['write-tree']), '-p', parent, '-m', tag]);
  }

  it('rebased with no fix: the fail stays open, quickly', () => {
    const base = commitAll(git('rev-parse', 'main'), 'base');
    git('update-ref', 'refs/heads/main', base);
    git('update-ref', `refs/heads/${BRANCH9}`, commitAll(base, 'feature'));
    failOnHead9();
    const mate = commitAll(base, 'mate', ['mate.txt']);
    git('update-ref', 'refs/heads/main', mate);
    // the rebase's resolution: upstream's commit with the feature's content on every shared path
    git('update-ref', `refs/heads/${BRANCH9}`, commitAll(mate, 'feature'));
    allPass(1);
    const t0 = Date.now();
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
});

/** Code-review L4 (gate round 10): a real fix to quoted-name paths upstream did not touch clears the fail. */
describe('assembleShip: a fix to paths with special names clears the fail (code-review L4, gate round 10)', () => {
  const NAMES = ['nl\nname.txt', 'q"uote.txt', 'tab\tname.txt', 'sp ace.txt', 'back\\slash.txt', 'ünï.txt'];

  function failOnNames(): void {
    for (const n of NAMES) fs.writeFileSync(path.join(repo, n), 'vuln\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'feature');
    failOnHead9();
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    allPass(1);
  }

  it('rebased with no fix: the fail stays', () => {
    failOnNames();
    expect(security9(ship())).toMatchObject({ verdict: 'fail', source: 'agent' });
  });

  for (const n of NAMES) {
    it(`a fix to ${JSON.stringify(n)} alone clears the fail`, () => {
      failOnNames();
      commitFile(n, 'safe\n', 'fix');
      expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
    });
  }
});

/** Info (gate round 10): config cannot hide a submodule fix from the comparison (the diffs pin their options). */
describe('assembleShip: diff options are pinned against repo config (info, gate round 10)', () => {
  it('with diff.ignoreSubmodules=all, a flagged submodule bump fixed by another bump clears the fail', () => {
    commitFile('keep.txt', 'k\n', 'keep');
    git('update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},sub`);
    git('commit', '-q', '-m', 'add submodule');
    failOnHead9();
    git('update-index', '--cacheinfo', `160000,${'2'.repeat(40)},sub`);
    git('commit', '-q', '-m', 'fix: bump the submodule');
    git('config', 'diff.ignoreSubmodules', 'all');
    allPass(1);
    expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });
});

/** Info (gate round 10): paths go on argv in chunks bounded by their UTF-8 bytes, not their UTF-16 length. */
describe('argvChunks', () => {
  it('1,000 paths of 100 three-byte characters (300 KB) take three chunks of at most 128 KB', () => {
    const paths = Array.from({ length: 1000 }, (_, i) => `${'日'.repeat(99)}${i % 10}`);
    const chunks = argvChunks(paths);
    expect(chunks.flat()).toEqual(paths);
    for (const c of chunks) expect(c.reduce((n, p) => n + Buffer.byteLength(p) + 1, 0)).toBeLessThanOrEqual(128 * 1024);
    expect(chunks.length).toBe(3);
  });
});

/**
 * D69 (user pick, ship round 12, "Let override clear it"): an overrides.json entry may name a gate. With a recorded
 * decision for this feature, it clears only that gate's open D67 rows (upstream changed the flagged file); never an
 * ordinary captured fail (D57) or a model gate line. The person still comes from the decision record.
 */
/**
 * D70 (user pick, ship round 13, "Ship pick, 'Override <gate>'"): a decision record the hook wrote during ship
 * (`command: "ship"`) whose chosen answer is exactly `Override <gate>`, answered at `answeredAt`. Only such a pick lets an
 * override clear that gate's D67 rows, and only rows captured before it was answered.
 */
function overridePick(gate: string, extra: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const options = [{ label: `Override ${gate} (Recommended)`, description: 'x' }, { label: 'Fix it', description: 'y' }];
  const line = JSON.stringify({
    v: 1, id, feature: FEATURE, questionKey: 'override?', answerIndex: 1, question: `Override the ${gate} fail?`, header: 'Override',
    options, recommended: `Override ${gate}`, choice: `Override ${gate}`, answerText: `Override ${gate}`, notes: null,
    kind: 'risk', command: 'ship', answeredAt: '2026-11-13T09:20:00Z', person: 'Pat', session: 's', ...extra,
  });
  fs.appendFileSync(path.join(featureDir(), 'decisions.ndjson'), `${line}\n`);
  openLedger(repo).appendRow(`decisions/${FEATURE}`, { id, feature: FEATURE, sha256: sha256(line) });
  return id;
}

describe('assembleShip: a recorded override naming the gate clears a D67 fail (D69)', () => {
  const BASE = ['def handler(u):', '    check_auth(u)', '    run(u)', '', '', '', '', '', 'X = 1'];
  const text = (ls: string[]): string => `${ls.join('\n')}\n`;

  /** The feature drops check_auth in app.py and is failed; a teammate edits app.py; the model rebases (a D67 row). */
  function d67Fail(gate = 'security', laterRowTs?: string): void {
    git('checkout', '-q', 'main');
    commitFile('app.py', text(BASE), 'base py');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'other.txt'), 'other\n');
    git('add', 'other.txt');
    commitFile('app.py', text(BASE.filter((l) => !l.includes('check_auth'))), 'feature');
    failOnHead9(undefined, undefined, gate);
    // D70: a second review of the same code, captured at laterRowTs (a D67 row too after the rebase)
    if (laterRowTs !== undefined) failOnHead9(undefined, undefined, gate, laterRowTs);
    mateOnMain9('app.py', text(BASE.map((l) => (l === 'X = 1' ? 'X = 2' : l))));
    git('rebase', '-q', 'main');
    allPass(1);
  }

  function override(entry: Record<string, unknown>): void {
    fs.writeFileSync(path.join(valueDir, 'overrides.json'), JSON.stringify([entry]));
  }

  // ⚠ changes existing test: D70 — the override's decision must be a ship pick answered `Override security`
  it('an override naming the gate clears a gate held only by D67 rows: ready_to_merge, person from the record', () => {
    d67Fail();
    const id = overridePick('security');
    override({ finding: 'MEDIUM: auth check, upstream moved it', decisionId: id, gate: 'security' });
    const r = result(ship());
    expect(r.verdict).toBe('ready_to_merge');
    expect(r.blockers).toEqual([]);
    expect(security9(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(r.overrides).toEqual([{ finding: 'MEDIUM: auth check, upstream moved it', decisionId: id, person: 'Pat', gate: 'security' }]);
    expect(validate(loadPhaseSchema('ship', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });

  // ⚠ changes existing test: D76 — a valid `Override performance` pick (a decision that does not count is now refused)
  it('an override naming another gate does not clear it', () => {
    d67Fail();
    override({ finding: 'x', decisionId: overridePick('performance'), gate: 'performance' });
    expect(result(ship()).blockers).toEqual([UPSTREAM_CHANGED('security')]);
  });

  it('an override with no gate does not clear it', () => {
    d67Fail();
    override({ finding: 'x', decisionId: decision('Pat').id });
    expect(result(ship()).blockers).toEqual([UPSTREAM_CHANGED('security')]);
  });

  // ⚠ changes existing test: D70 — a valid `Override security` pick, so only the ordinary fail can keep it blocked
  it('a gate with a D67 row and an ordinary open fail stays blocked, with the tracked-change text', () => {
    d67Fail();
    // an older review of the same gate on the rebased code, unchanged since: an ordinary (D57) open fail
    failOnHead9(undefined, undefined, 'security', '2026-11-13T09:05:00.000Z');
    override({ finding: 'x', decisionId: overridePick('security'), gate: 'security' });
    expect(result(ship()).blockers).toEqual([NOT_RE_REVIEWED_TEXT('security')]);
  });

  // ⚠ changes existing test: D70 — a valid `Override security` pick, so the test still shows the ordinary fail stays
  it('an override never clears an ordinary captured fail', () => {
    commitFile('f.txt', 'vuln\n', 'feature');
    failOnHead9();
    allPass(1);
    override({ finding: 'x', decisionId: overridePick('security'), gate: 'security' });
    expect(result(ship()).blockers).toEqual([NOT_RE_REVIEWED_TEXT('security')]);
  });

  // ⚠ changes existing test: D70 — a valid `Override security` pick, so the test still shows the model line stays
  it('an override never clears a failing model gate line', () => {
    commitFile('f.txt', 'work\n', 'feature');
    for (const gate of GATES) gateLine({ round: 1, gate, verdict: gate === 'security' ? 'fail' : 'pass' });
    override({ finding: 'x', decisionId: overridePick('security'), gate: 'security' });
    expect(result(ship()).blockers).toEqual(['gate:security']);
  });

  it('an override for an unrecorded decision id still refuses', () => {
    d67Fail();
    override({ finding: 'x', decisionId: randomUUID(), gate: 'security' });
    expect(errorOf(ship())).toBe('override_unrecorded');
  });

  it('an override naming an unknown gate refuses, naming the gate field', () => {
    d67Fail();
    override({ finding: 'x', decisionId: decision('Pat').id, gate: 'made-up' });
    const o = ship();
    expect(o.ok ? null : { error: o.error, detail: o.detail }).toEqual({ error: 'override_unrecorded', detail: 'gate' });
  });

  // ⚠ changes existing test: D70 — a valid `Override security` pick, and the result is asserted to be cleared
  it('check (reassembling with the stored overrides, gate included) agrees with assemble', () => {
    d67Fail();
    override({ finding: 'x', decisionId: overridePick('security'), gate: 'security' });
    const first = result(ship());
    expect(first.verdict).toBe('ready_to_merge');
    const stored = first.overrides as Array<Record<string, unknown>>;
    override(stored[0] as Record<string, unknown>);
    expect(result(ship())).toEqual(first);
  });

  describe('D70: only a ship pick answered `Override <gate>` counts, for rows captured before it', () => {
    // D76 (user pick, ship round 14, "Refuse it"): an entry naming a gate whose decision does not count under D70 is
    // refused like an unrecorded id (override_unrecorded, detail gate), never stored as a harmless listing.
    const refusedGate = (o: AssembleOutcome): unknown => (o.ok ? null : { error: o.error, detail: o.detail });
    const REFUSED = { error: 'override_unrecorded', detail: 'gate' };

    // ⚠ changes existing test: D76 — refused, no longer listed and ignored
    it('an unrelated ideate decision is refused (r11-sec A1)', () => {
      d67Fail();
      const id = overridePick('security', { question: 'Which storage format?', choice: 'JSON', answerText: 'JSON', command: 'ideate', kind: 'design' });
      override({ finding: 'x', decisionId: id, gate: 'security' });
      expect(refusedGate(ship())).toEqual(REFUSED);
    });

    // ⚠ changes existing test: D76 — refused, no longer listed and ignored
    it('an `Override security` answer given outside ship is refused', () => {
      d67Fail();
      override({ finding: 'x', decisionId: overridePick('security', { command: 'build' }), gate: 'security' });
      expect(refusedGate(ship())).toEqual(REFUSED);
    });

    // ⚠ changes existing test: D76 — refused, no longer listed and ignored (r12-sec L1: a "Fix it" id with a gate)
    it('a ship decision answered "Fix it" is refused, not stored (r11-sec A2, r12-sec L1)', () => {
      d67Fail();
      override({ finding: 'x', decisionId: overridePick('security', { choice: 'Fix it', answerText: 'Fix it' }), gate: 'security' });
      expect(refusedGate(ship())).toEqual(REFUSED);
    });

    // ⚠ changes existing test: D76 — refused, no longer listed and ignored
    it('a bare "Override" or a multi-select answer is refused', () => {
      d67Fail();
      override({ finding: 'x', decisionId: overridePick('security', { choice: 'Override', answerText: 'Override' }), gate: 'security' });
      expect(refusedGate(ship())).toEqual(REFUSED);
      override({ finding: 'x', decisionId: overridePick('security', { choice: ['Override security'] }), gate: 'security' });
      expect(refusedGate(ship())).toEqual(REFUSED);
    });

    // ⚠ changes existing test: D76 — refused, no longer listed and ignored
    it('`Override performance` named for security is refused', () => {
      d67Fail();
      override({ finding: 'x', decisionId: overridePick('performance'), gate: 'security' });
      expect(refusedGate(ship())).toEqual(REFUSED);
    });

    it('an entry without a gate keeps today\'s behaviour: listed, clears nothing', () => {
      d67Fail();
      const id = overridePick('security', { choice: 'Fix it', answerText: 'Fix it' });
      override({ finding: 'x', decisionId: id });
      const r = result(ship());
      expect(r.blockers).toEqual([UPSTREAM_CHANGED('security')]);
      expect(r.overrides).toEqual([{ finding: 'x', decisionId: id, person: 'Pat' }]);
    });

    it('`Override security` answered before a newer D67 row: that row stays open (r11-sec A3, r11-pen stale)', () => {
      d67Fail('security', '2026-11-13T09:30:00.000Z');
      override({ finding: 'x', decisionId: overridePick('security'), gate: 'security' });
      const r = result(ship());
      expect(r.verdict).toBe('blocked');
      expect(r.blockers).toEqual([UPSTREAM_CHANGED('security')]);
    });

    it('`Override security` answered after every D67 row clears them', () => {
      d67Fail('security', '2026-11-13T09:15:00.000Z');
      override({ finding: 'x', decisionId: overridePick('security'), gate: 'security' });
      const r = result(ship());
      expect(r.verdict).toBe('ready_to_merge');
      expect(r.blockers).toEqual([]);
    });

    // ⚠ changes existing test: D76 — refused, no longer listed and ignored
    it('a pick with no readable answered time is refused', () => {
      d67Fail();
      override({ finding: 'x', decisionId: overridePick('security', { answeredAt: 'soon' }), gate: 'security' });
      expect(refusedGate(ship())).toEqual(REFUSED);
    });

    it('a counted pick answered before a newer D67 row is listed, not refused, and check agrees', () => {
      d67Fail('security', '2026-11-13T09:30:00.000Z');
      const id = overridePick('security');
      override({ finding: 'x', decisionId: id, gate: 'security' });
      const first = result(ship());
      expect(first.verdict).toBe('blocked');
      expect(first.overrides).toEqual([{ finding: 'x', decisionId: id, person: 'Pat', gate: 'security' }]);
      override((first.overrides as Array<Record<string, unknown>>)[0] as Record<string, unknown>);
      expect(result(ship())).toEqual(first);
    });
  });
});

/**
 * D71 (user pick, ship round 13, "Honest text, override stays"; r11-sec probe C1): upstream touched only a shared feature
 * file (CHANGELOG.md), not the flagged vuln.py. Rows don't record which file was flagged, so the blocker says upstream
 * changed a file this feature changes, never "the flagged file". A D70-bound override still clears it.
 */
describe('assembleShip: the D67 blocker names a file this feature changes, not the flagged file (D71)', () => {
  it('upstream edits only the shared CHANGELOG: the new text, and an `Override security` pick clears it', () => {
    git('checkout', '-q', 'main');
    commitFile('CHANGELOG.md', 'a\n\n\n\n\n\nz\n', 'cl');
    git('checkout', '-q', BRANCH9);
    git('rebase', '-q', 'main');
    commitFile('vuln.py', 'eval(input())\n', 'feature vuln');
    commitFile('CHANGELOG.md', 'a feature\n\n\n\n\n\nz\n', 'feature cl');
    failOnHead9();
    mateOnMain9('CHANGELOG.md', 'a\n\n\n\n\n\nz mate\n');
    git('rebase', '-q', 'main');
    allPass(1);
    expect(result(ship()).blockers).toEqual([
      'gate:security (captured fail, not re-reviewed: upstream changed a file this feature changes; a recorded override or a fix elsewhere in the feature clears it)',
    ]);
    fs.writeFileSync(path.join(valueDir, 'overrides.json'), JSON.stringify([{ finding: 'x', decisionId: overridePick('security'), gate: 'security' }]));
    expect(result(ship())).toMatchObject({ verdict: 'ready_to_merge', blockers: [] });
  });
});

/**
 * Gate round 11 perf (D72): perf L1, after the first batched tree diff overflows its buffer no later batch tries one;
 * perf L2, batches are filled with distinct review states, not rows; perf I2, one history walk finds every review base.
 */
describe('assembleShip: batches after an overflow, by review state, one history walk (perf L1, L2, I2, gate round 11)', { timeout: 120_000 }, () => {
  /** `states` distinct off-history review heads of the feature, each failed by every gate (`gates` rows per state). */
  function offHistoryStates(states: number, gates: readonly string[]): void {
    const old = git('rev-parse', 'main');
    commitFile('flagged.txt', 'vuln\n', 'feature');
    const tree = git('rev-parse', 'HEAD^{tree}');
    let i = 0;
    for (let s = 0; s < states; s++) {
      const head = git('commit-tree', tree, '-p', old, '-m', `pre-rebase review ${s}`);
      for (const g of gates) failOnHead9(tree, head, g, new Date(Date.parse('2026-11-13T09:00:00.000Z') + (i++) * 1000).toISOString());
    }
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    allPass(1);
  }
  const isBatchDiff = (a: readonly string[]): boolean => a.includes('diff-tree') && a.includes('--stdin');

  it('the batched tree diff overflows once: no later batch tries it, and the result is unchanged', () => {
    offHistoryStates(40, ['security']);
    commitFile('flagged.txt', 'safe\n', 'fix');
    const expected = result(ship());
    spawns.overflow = isBatchDiff;
    spawns.args = [];
    expect(result(ship())).toEqual(expected);
    expect(spawns.args.filter(isBatchDiff).length).toBe(1);
  });

  it('201 rows on 67 review states x 3 gates, all cleared by a fix: batches hold distinct states (about 19 git calls, not 33)', () => {
    offHistoryStates(67, GATES);
    commitFile('flagged.txt', 'safe\n', 'fix');
    spawns.n = 0;
    expect(result(ship()).verdict).toBe('ready_to_merge');
    expect(spawns.n).toBeLessThanOrEqual(22);
  });

  it('one history walk finds the review bases of every batch', () => {
    offHistoryStates(40, ['security']);
    commitFile('flagged.txt', 'safe\n', 'fix');
    spawns.args = [];
    expect(result(ship()).verdict).toBe('ready_to_merge');
    expect(spawns.args.filter((a) => a.includes('rev-list') && a.includes('--boundary')).length).toBe(1);
  });
});

/**
 * Gate round 12 performance F1 + code-review L1 (D77): a review head git pruned (reflog expire, gc --prune=now) made the
 * one history walk fail as a whole, so every row's review base fell back to its own merge-base. Only the heads that
 * exist are walked (one cat-file --batch-check, never --ignore-missing: an unlisted head would count as its own base);
 * a missing head takes the per-row fallback (D55, unchanged).
 */
describe('assembleShip: one pruned review head does not undo the history walk (perf F1, gate round 12)', { timeout: 180_000 }, () => {
  /** 100 off-history review heads x 3 gates (300 fail rows), all kept by a ref except `prune` heads, which gc removes. */
  function offHistoryPruned(prune: number): void {
    const old = git('rev-parse', 'main');
    commitFile('flagged.txt', 'vuln\n', 'feature');
    const tree = git('rev-parse', 'HEAD^{tree}');
    const heads: string[] = [];
    let i = 0;
    for (let s = 0; s < 100; s++) {
      const head = git('commit-tree', tree, '-p', old, '-m', `pre-rebase review ${s}`);
      heads.push(head);
      for (const g of GATES) failOnHead9(tree, head, g, new Date(Date.parse('2026-11-13T09:00:00.000Z') + (i++) * 1000).toISOString());
    }
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    execFileSync('git', ['update-ref', '--stdin'], { cwd: repo, env, input: heads.slice(prune).map((h, n) => `create refs/keep/${n} ${h}\n`).join('') });
    mateOnMain9('mate.txt', 'mate\n');
    git('rebase', '-q', 'main');
    git('reflog', 'expire', '--expire=now', '--all');
    git('gc', '-q', '--prune=now');
    for (const h of heads.slice(0, prune)) expect(() => git('cat-file', '-e', h)).toThrow();
    commitFile('flagged.txt', 'safe\n', 'fix');
    allPass(1);
  }
  const isWalk = (a: readonly string[]): boolean => a.includes('rev-list') && a.includes('--boundary');

  it('300 cleared rows, one head pruned: about as many git calls as none pruned, and the per-row result', () => {
    offHistoryPruned(0);
    spawns.n = 0;
    expect(result(ship()).verdict).toBe('ready_to_merge');
    const nonePruned = spawns.n;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(repo);
    fs.mkdirSync(home);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'gc.auto', '0');
    git('config', 'maintenance.auto', 'false');
    commitFile('a.txt', 'one\ntwo\nthree\n', 'base');
    git('checkout', '-q', '-b', `feat/${FEATURE}/ship`);
    offHistoryPruned(1);
    // the per-row path: the history walk fails, so every row takes its own merge-base
    spawns.overflow = isWalk;
    const perRow = result(ship());
    spawns.overflow = null;
    spawns.n = 0;
    spawns.args = [];
    const walked = result(ship());
    expect(walked).toEqual(perRow);
    expect(walked.verdict).toBe('ready_to_merge');
    expect(spawns.args.filter(isWalk).length).toBe(1);
    expect(spawns.n).toBeLessThanOrEqual(nonePruned + 6);
  });
});

/**
 * Code-review L1 (gate round 11): two guards no test pinned.
 * (a) batchReviewBases takes a boundary commit as the review base only when the head reaches exactly one
 *     (`r.length === 1`); a head that merged main twice reaches several, and its base must be git's merge-base.
 * (b) D67 counts an upstream change to a path the feature changes now (`own.has(p) ||`), even one the reviewed tree
 *     did not touch.
 */
describe('assembleShip: a review head with several boundary commits, and a fix only in an upstream-changed path (code-review L1, gate round 11)', () => {
  it('(a) a review head that merged main twice, fixed after review in a path upstream did not touch since: the fail clears', () => {
    commitFile('flagged.txt', 'vuln\n', 'feature');
    mateOnMain9('u1.txt', 'one\n');
    git('merge', '-q', '--no-edit', 'main');
    // p.txt reaches the feature through its second merge of main, before the review
    mateOnMain9('p.txt', 'upstream p\n');
    git('merge', '-q', '--no-edit', 'main');
    failOnHead9();
    // the review base is merge-base(main, review head): main's tip, so upstream changed nothing since the review
    expect(git('merge-base', 'main', 'HEAD')).toBe(git('rev-parse', 'main'));
    commitFile('p.txt', 'fixed p\n', 'fix in p');
    allPass(1);
    expect(result(ship())).toMatchObject({ verdict: 'ready_to_merge', blockers: [] });
  });

  it('(b) a flagged file the feature did not fix, and a fix after review only in a file upstream changed: D67 text, and an override clears it', () => {
    commitFile('p.txt', 'base p\n', 'p on main');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--ff-only', BRANCH9);
    git('checkout', '-q', BRANCH9);
    commitFile('q.txt', 'vuln\n', 'feature');
    failOnHead9();
    mateOnMain9('p.txt', 'upstream p\n');
    git('rebase', '-q', 'main');
    commitFile('p.txt', 'feature p\n', 'fix only in p');
    allPass(1);
    expect(result(ship()).blockers).toEqual([UPSTREAM_CHANGED('security')]);
    fs.writeFileSync(path.join(valueDir, 'overrides.json'), JSON.stringify([{ finding: 'x', decisionId: overridePick('security'), gate: 'security' }]));
    expect(result(ship())).toMatchObject({ verdict: 'ready_to_merge', blockers: [] });
  });
});
