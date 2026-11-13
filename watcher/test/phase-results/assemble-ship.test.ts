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
import { loadPhaseSchema } from '../../src/phase-results/schemas.js';
import { validate } from '../../src/phase-results/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '../../..');
const FEATURE = 'phase-results';
const FAKE_KEY = 'sk-ant-api03-' + 'Ab1'.repeat(30);
const GATES = ['code-reviewer', 'performance-engineer', 'security-auditor'];

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
  });

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
    gateLine({ round: 1, gate: 'security-auditor', verdict: 'fail', findings: { high: 1 } });
    gateLine({ round: 2, gate: 'code-reviewer', verdict: 'pass', findings: { low: 2 }, fixed: { low: 1 } });
    gateLine({ round: 2, gate: 'performance-engineer', verdict: 'pass' });
    gateLine({ round: 2, gate: 'security-auditor', verdict: 'pass' });
    const r = result(ship());
    const gates = r.gates as Array<Record<string, unknown>>;
    expect(gates).toHaveLength(3);
    expect(gates[0]).toEqual({
      gate: 'code-reviewer',
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
    gateLine({ round: 1, gate: 'code-reviewer', verdict: 'pass' });
    gateLine({ round: 1, gate: 'performance-engineer', verdict: 'pass' });
    expect(errorOf(ship())).toBe('gate_missing');
  });

  // Behaviour: a gate line typed into the repo file by hand does not count as a review.
  // Rule: S2, only gate lines whose hash is in the private ledger count; a planted line is gate_missing.
  it('a planted gate line gives gate_missing', () => {
    gateLine({ round: 1, gate: 'code-reviewer', verdict: 'pass' });
    gateLine({ round: 1, gate: 'performance-engineer', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security-auditor', verdict: 'pass' }, { ledger: false });
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
    gateLine({ round: 1, gate: 'code-reviewer', verdict: 'pass' });
    gateLine({ round: 1, gate: 'performance-engineer', verdict: 'pass' });
    gateLine({ round: 1, gate: 'security-auditor', verdict: 'fail', findings: { high: 1 } });
    const r = result(ship());
    expect(r.verdict).toBe('blocked');
    expect(r.blockers).toEqual(['gate:security-auditor']);
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
