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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { assembleShip, DEFAULT_REQUIRED_GATES } from '../../src/phase-results/assemble-ship.js';
import type { AssembleContext, AssembleOutcome } from '../../src/phase-results/assemble-common.js';
import { openLedger } from '../../src/phase-results/ledger.js';
import { captureVerdict } from '../../src/phase-results/verdict-capture.js';
import { loadPhaseSchema } from '../../src/phase-results/schemas.js';
import { validate } from '../../src/phase-results/validate.js';

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

function ship(extra: { base?: string; requiredGates?: readonly string[] } = {}): AssembleOutcome {
  return assembleShip(ctx(), { base: 'main', ...extra });
}

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
    expect(r.blockers).toEqual(['gate:code-review (captured fail, not re-reviewed)']);
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
    expect(r.blockers).toEqual(['gate:pen-test (captured fail, not re-reviewed)']);
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
    expect(out.captured).toBe(true);
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

  // Behaviour: once the feature shipped ready to merge, an older fail does not haunt the next ship of the feature.
  it('a fail from before the last ready_to_merge result\'s run is not read', () => {
    failAt('2026-11-13T07:00:00.000Z');
    storedShip('ready_to_merge', '2026-11-13T08:00:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'pass', source: 'model' });
  });

  it('a blocked last result, or a stored result the ledger does not bind, sets no cutoff', () => {
    failAt('2026-11-13T07:00:00.000Z');
    storedShip('blocked', '2026-11-13T08:00:00.000Z');
    allPass(1);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail' });
    storedShip('ready_to_merge', '2026-11-13T08:10:00.000Z', false);
    expect(codeReview(ship())).toMatchObject({ verdict: 'fail' });
  });

  // Rule: D47 (code review MEDIUM) — the cutoff is frozen in the result at assemble, as D42's evidenceCutoff, so a check
  //       (re-assemble with the stored value) reads the same rows whatever ship result is stored by then.
  it('assemble stores the cutoff it used as verdictsFrom: the last ready_to_merge run start, or null for all rows', () => {
    allPass(1);
    expect(result(ship()).verdictsFrom).toBeNull();
    storedShip('ready_to_merge', '2026-11-13T08:00:00.000Z');
    expect(result(ship()).verdictsFrom).toBe('2026-11-13T08:00:00.000Z');
  });

  it('a given verdictsFrom is used instead of the stored result: a string cuts there, null reads every row', () => {
    failAt('2026-11-13T07:00:00.000Z');
    allPass(1);
    const at = (verdictsFrom: string | null): AssembleOutcome =>
      assembleShip({ ...ctx(), verdictsFrom }, { base: 'main' });
    expect(codeReview(at('2026-11-13T07:30:00.000Z'))).toMatchObject({ verdict: 'pass', source: 'model' });
    expect(result(at('2026-11-13T07:30:00.000Z')).verdictsFrom).toBe('2026-11-13T07:30:00.000Z');
    storedShip('ready_to_merge', '2026-11-13T08:00:00.000Z');
    expect(codeReview(at(null))).toMatchObject({ verdict: 'fail', source: 'agent' });
    expect(result(at(null)).verdictsFrom).toBeNull();
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

  // ⚠ changes existing test: D45 — git cannot compare an unknown object, so the fail stays open (was: a pass).
  it('a fail whose trackedTree is a hex id git does not have stays open', () => {
    failRow(() => ({ tree: 'a'.repeat(40), trackedTree: 'a'.repeat(40) }));
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
    expect(result(o).blockers).toEqual(['gate:code-review (captured fail, not re-reviewed)']);
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

  it('a fail whose tree git does not have stays open', () => {
    row('fail', '2026-11-13T09:10:00.000Z', { tree: 'a'.repeat(40), trackedTree: 'a'.repeat(40), headSha: '' });
    allPass(1);
    expectOpen(ship());
  });
});
