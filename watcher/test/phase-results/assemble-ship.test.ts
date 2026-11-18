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
}

/** Appends a timeline gate line; `ledger: true` also writes its hash row, as oss-timeline.sh does. */
function gateLine(g: GateLine, opts: { ledger: boolean } = { ledger: true }): void {
  const line = JSON.stringify({
    v: 1,
    id: randomUUID(),
    ts: '2026-11-13T09:30:00Z',
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

  function captured(row: { gate: string; verdict: 'pass' | 'fail'; findings: Record<string, number>; ts: string }): void {
    openLedger(repo).appendRow(`verdicts/${FEATURE}`, { ...row, agent: 'agent-1', session: 'sess-1' });
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

  // Behaviour: an agent's verdict from an earlier ship run never speaks for this one.
  it('a captured row from before the ship run started is ignored', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'fail', findings: { ...ZERO, high: 1 }, ts: '2026-11-13T08:59:59.000Z' });
    const g = gatesOf(shipReview());
    expect(g['code-review']).toMatchObject({ verdict: 'pass', source: 'model' });
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

  // Behaviour: a later re-review reports the state after the fixes, so the newest captured row counts.
  it('the latest captured row of a gate wins', () => {
    gateLine({ round: 2, gate: 'code-review', verdict: 'fail' });
    gateLine({ round: 2, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'fail', findings: { ...ZERO, medium: 1 }, ts: '2026-11-13T09:10:00.000Z' });
    captured({ gate: 'code-review', verdict: 'pass', findings: ZERO, ts: '2026-11-13T09:40:00.000Z' });
    const r = result(shipReview());
    expect(gatesOf(shipReview())['code-review']).toMatchObject({ verdict: 'pass', findings: ZERO, source: 'agent' });
    expect(r.verdict).toBe('ready_to_merge');
  });

  // Behaviour: ship's rule holds for the agent too: unfixed critical or high findings fail the gate.
  // Rule: ship.md "Write fail whenever critical or high findings of that agent are left unfixed ... whatever the
  //       agent said" (coordinator correction 2026-11-18).
  it('a captured pass with high findings gives a failing gate, source agent, and blocks the ship', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'security', verdict: 'pass', findings: { ...ZERO, high: 2 }, ts: '2026-11-13T09:10:00.000Z' });
    const r = result(shipReview());
    expect(gatesOf(shipReview()).security).toMatchObject({ verdict: 'fail', findings: { ...ZERO, high: 2 }, source: 'agent' });
    expect(r.verdict).toBe('blocked');
    expect(r.blockers).toEqual(['gate:security']);
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
      { session_id: 's1', agent_id: 'a1', agent_type: 'oss:code-reviewer', cwd: repo, last_assistant_message: block },
      { now: () => new Date('2026-11-13T09:10:00.000Z') },
    );
    expect(out).toEqual({ captured: true, gate: 'code-review', feature: FEATURE });
    const r = result(ship());
    expect(gatesOf(ship())['code-review']).toMatchObject({ verdict: 'fail', findings: { ...ZERO, medium: 4 }, source: 'agent' });
    expect(r.blockers).toEqual(['gate:code-review']);
  });

  it('a result with agent gates passes the ship schema', () => {
    gateLine({ round: 1, gate: 'code-review', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security', verdict: 'pass' });
    captured({ gate: 'code-review', verdict: 'pass', findings: ZERO, ts: '2026-11-13T09:10:00.000Z' });
    expect(validate(loadPhaseSchema('ship', PLUGIN_ROOT), result(shipReview()))).toEqual({ ok: true });
  });
});
