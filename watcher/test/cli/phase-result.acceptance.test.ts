/**
 * @behavior At the end of a phase the model runs `oss-phase-result.sh assemble <phase>`: the plugin's own code builds
 *           the result from evidence, checks it against the phase schema and writes it, binding its bytes to this run
 *           in the owner-only ledger. `check <phase>` (what complete, start and archive ask) passes only for that
 *           exact file, from this run, still matching the evidence, with no unverified marker. Every refusal names
 *           its reason id, the field and the command that rebuilds the result.
 * @business-rule R-257 US-001/US-002 and D14: a missing, malformed, hand-written, edited, copied, stale or unverified
 *           result fails the phase; a failed assemble writes nothing (no results/ dir, so the D17 legacy pass still
 *           applies); the CLI never touches the network.
 * @boundary the committed bundle watcher/dist/cli/phase-result.cjs, spawned as hooks/oss-phase-result.sh runs it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ledgerKey, openLedger } from '../../src/phase-results/ledger.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// OSS_TEST_PHASE_RESULT_CLI: a bundle built from src outside dist (fix rounds build dist once, at the end).
const CLI = process.env.OSS_TEST_PHASE_RESULT_CLI ?? path.resolve(HERE, '../../dist/cli/phase-result.cjs');
const FEATURE = 'feat-a';
const OTHER = 'feat-b';
// ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
const GATES = ['code-review', 'performance', 'security'];

let tmp: string;
let repo: string;
let home: string;
let shimDir: string;
let netCalls: string;
let savedHome: string | undefined;

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && k !== 'CLAUDE_PROJECT_DIR') env[k] = v;
  return env;
}

/**
 * ⚠ changes existing test: D34 — a ship base ref created after the ship run started is refused (reflog creation time),
 *   and the runs here start at fixed 2026-11-13 times, so the fixture's git writes (and reflog entries) are dated before
 *   them. `gitNow` writes with the real clock.
 */
const FIXTURE_DATE = '2026-11-13T08:00:00Z';
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: { ...cleanEnv(), GIT_COMMITTER_DATE: FIXTURE_DATE }, encoding: 'utf-8' }).trim();
}

function gitNow(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: cleanEnv(), encoding: 'utf-8' }).trim();
}

function commitFile(name: string, content: string): void {
  fs.writeFileSync(path.join(repo, name), content);
  git('add', name);
  git('commit', '-q', '-m', `add ${name}`);
}

function activeDir(feature: string): string {
  return path.join(repo, '.oss', 'dev', 'active', feature);
}

function resultFile(feature: string, phase: string): string {
  return path.join(activeDir(feature), 'results', `${phase}.json`);
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Runs the committed CLI from the repo with the sandbox HOME and a PATH whose curl/gh/wget only record calls. */
function cli(...args: string[]): Run {
  const env = cleanEnv();
  env.HOME = home;
  env.PATH = `${shimDir}:${process.env.PATH ?? ''}`;
  env.CLAUDE_CODE_SESSION_ID = 'sess-accept-1';
  env.CLAUDE_PROJECT_DIR = '/nonexistent-project-dir';
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf-8', timeout: 20_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0 };
}

/** The start gate's ledger row (T10b writes it in production). */
function startRun(phase: string, startedAt: string, feature?: string): void {
  openLedger(repo).appendRow(`run/${phase}`, {
    startedAt, session: 'sess-accept-1', headSha: git('rev-parse', 'HEAD'), ...(feature === undefined ? {} : { feature }),
  });
}

/** The model's value folder ($HOME/.oss/run/<key>), created as `oss-value.sh dir` does. */
function valueDir(): string {
  const d = path.join(home, '.oss', 'run', ledgerKey(repo) as string);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(home, '.oss', 'run'), 0o700);
  return d;
}

function writeTasks(): void {
  fs.writeFileSync(
    path.join(valueDir(), 'tasks.json'),
    JSON.stringify([{ id: 'T1', title: 'first task', testIds: ['validate.test.ts:accepts'] }]),
  );
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function event(ts: string, result: 'red' | 'green'): string {
  return JSON.stringify({ ts, tool: 'Bash', kind: 'test-run', program: 'npm', result });
}

function writeEvents(lines: string[]): void {
  const d = path.join(repo, '.oss', 'tool-gates');
  fs.mkdirSync(d, { recursive: true });
  fs.appendFileSync(path.join(d, 'events.ndjson'), lines.map((l) => `${l}\n`).join(''));
}

/** Ledger-backed passing gate lines for the required gates, as oss-timeline.sh writes them. */
function passGates(feature: string): void {
  for (const gate of GATES) {
    const line = JSON.stringify({
      v: 1,
      id: randomUUID(),
      ts: '2026-11-13T09:30:00Z',
      kind: 'gate',
      feature,
      session: 'sess-accept-1',
      round: 1,
      gate,
      verdict: 'pass',
      findings: {},
      fixed: {},
      mode: 'full',
    });
    fs.appendFileSync(path.join(activeDir(feature), 'timeline.ndjson'), `${line}\n`);
    openLedger(repo).appendRow(`gates/${feature}`, { sha256: sha256(line) });
  }
}

function assembledPlan(): void {
  startRun('plan', '2026-11-13T09:00:00.000Z');
  writeTasks();
  const r = cli('assemble', 'plan');
  expect(r.status, r.stderr).toBe(0);
}

beforeEach(() => {
  savedHome = process.env.HOME;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-result-cli-')));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  shimDir = path.join(tmp, 'shims');
  netCalls = path.join(tmp, 'net.calls');
  for (const d of [home, repo, shimDir]) fs.mkdirSync(d, { recursive: true });
  for (const bin of ['curl', 'gh', 'wget']) {
    const p = path.join(shimDir, bin);
    fs.writeFileSync(p, `#!/bin/sh\necho "${bin} $*" >> "${netCalls}"\nexit 1\n`);
    fs.chmodSync(p, 0o755);
  }
  process.env.HOME = home;
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  commitFile('base.txt', 'base\n');
  // ⚠ changes existing test: D34 — a ship base must be an ancestor of origin's default branch, so the repo has one.
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'main'));
  git('checkout', '-q', '-b', `feat/${FEATURE}/build`);
  for (const f of [FEATURE, OTHER]) {
    fs.mkdirSync(activeDir(f), { recursive: true });
    fs.writeFileSync(path.join(activeDir(f), 'DESIGN.md'), '# Design\n\nStatus: COMMITTED\n');
  }
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('phase-result CLI: assemble', () => {
  it('writes a valid result bound to this run, clears the pending marker, and check then passes', () => {
    startRun('plan', '2026-11-13T09:00:00.000Z');
    writeTasks();
    openLedger(repo).writeMarker(`pending/${FEATURE}/plan`, { check: 'phase-result-missing', at: 'x' });

    const a = cli('assemble', 'plan');
    expect(a.status, a.stderr).toBe(0);
    expect(JSON.parse(a.stdout)).toEqual({ verification: 'verified', phase: 'plan' });
    expect(fs.existsSync(resultFile(FEATURE, 'plan'))).toBe(true);
    expect(openLedger(repo).hasMarker(`pending/${FEATURE}/plan`)).toBe(false);
    const row = openLedger(repo).lastRow(`results/${FEATURE}/plan`);
    expect(row).toMatchObject({
      sha256: createHash('sha256').update(fs.readFileSync(resultFile(FEATURE, 'plan'))).digest('hex'),
      feature: FEATURE,
      phase: 'plan',
      startedAt: '2026-11-13T09:00:00.000Z',
      session: 'sess-accept-1',
    });

    const c = cli('check', 'plan');
    expect(c.status, c.stderr).toBe(0);
    expect(JSON.parse(c.stdout)).toEqual({ verification: 'verified' });
  });

  it('a failed assemble exits 1, names the rule and the rebuild command, and creates no results/ dir', () => {
    startRun('plan', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'plan');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no_tasks');
    expect(r.stderr).toContain('oss-phase-result.sh assemble plan');
    expect(fs.existsSync(path.join(activeDir(FEATURE), 'results'))).toBe(false);
  });

  it('assemble with no started run refuses with no_run_started and writes nothing', () => {
    writeTasks();
    const r = cli('assemble', 'plan');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no_run_started');
    expect(fs.existsSync(path.join(activeDir(FEATURE), 'results'))).toBe(false);
  });
  // Behaviour: once the Stop hook marked a phase unverified, re-running assemble is the documented way out, so a
  //            successful assemble clears both unverified markers and check then passes.
  // Rule: R-257 ship fix round 1, finding 1 (HIGH): a marked phase could never pass check again.
  it('a successful assemble clears the ledger and repo unverified markers, and check then passes', () => {
    startRun('plan', '2026-11-13T09:00:00.000Z');
    writeTasks();
    openLedger(repo).writeMarker(`unverified/${FEATURE}/plan`, { reason: 'stop-check' });
    fs.mkdirSync(path.join(activeDir(FEATURE), 'results'), { recursive: true });
    fs.writeFileSync(path.join(activeDir(FEATURE), 'results', 'plan.unverified.json'), '{}');
    expect(cli('check', 'plan').status).toBe(1);

    const a = cli('assemble', 'plan');
    expect(a.status, a.stderr).toBe(0);
    expect(openLedger(repo).hasMarker(`unverified/${FEATURE}/plan`)).toBe(false);
    expect(fs.existsSync(path.join(activeDir(FEATURE), 'results', 'plan.unverified.json'))).toBe(false);
    const c = cli('check', 'plan');
    expect(c.status, c.stderr).toBe(0);
  });

  // Behaviour: the complete notice can name the ship gates whose verdict no review agent backed (D26).
  // Rule: D26, assemble ship prints gateEvidence and uncapturedGates beside verification.
  it('assemble ship prints gateEvidence and uncapturedGates for the complete notice', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    expect(JSON.parse(a.stdout)).toEqual({
      verification: 'verified',
      phase: 'ship',
      gateEvidence: 'model',
      uncapturedGates: GATES,
    });
    // oss-notify's complete gate runs check, so check ship prints the same label from the bound result.
    const c = cli('check', 'ship');
    expect(c.status, c.stderr).toBe(0);
    // ⚠ changes existing test: D35 — check ship also prints the verdict, so complete can refuse a blocked ship.
    expect(JSON.parse(c.stdout)).toEqual({
      verification: 'verified',
      gateEvidence: 'model',
      uncapturedGates: GATES,
      verdict: 'ready_to_merge',
    });
  });

  it('a failed assemble leaves the unverified markers in place', () => {
    startRun('plan', '2026-11-13T09:00:00.000Z');
    openLedger(repo).writeMarker(`unverified/${FEATURE}/plan`, { reason: 'stop-check' });
    expect(cli('assemble', 'plan').status).toBe(1);
    expect(openLedger(repo).hasMarker(`unverified/${FEATURE}/plan`)).toBe(true);
  });
});

/**
 * Pen N1 (round 2, MEDIUM): a run started where no feature resolved (say on feat/tmp/x) had its start gate skipped, so
 * back on the feature branch its assemble passed with no previous-phase result. assemble now re-applies the start-gate
 * rule (oss-notify.sh D16/D17) for a run row whose feature is "": a valid previous-phase result for the resolved
 * feature, unless the feature is legacy (no results/ folder and no ledger results rows).
 */
describe('phase-result CLI: a run started with no feature still needs the previous phase (pen N1)', () => {
  function buildEvents(): void {
    writeEvents([event('2026-11-13T09:01:00.000Z', 'red'), event('2026-11-13T09:02:00.000Z', 'green')]);
  }

  // Behaviour: switching branches to dodge the start gate does not let the next phase pass.
  it('the repro: build started on feat/tmp/x, assembled on the feature branch with no plan result, refuses no_prev_result', () => {
    // the feature is not legacy: its ideate went through results
    openLedger(repo).appendRow(`results/${FEATURE}/ideate`, { sha256: 'x'.repeat(64) });
    git('checkout', '-q', '-b', 'feat/tmp/x');
    startRun('build', '2026-11-13T09:00:00.000Z', '');
    git('checkout', '-q', `feat/${FEATURE}/build`);
    buildEvents();
    const r = cli('assemble', 'build');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no_prev_result');
    expect(fs.existsSync(resultFile(FEATURE, 'build'))).toBe(false);
  });

  it('with a valid plan result for the resolved feature, a no-feature build run assembles', () => {
    assembledPlan();
    startRun('build', '2026-11-13T09:00:00.000Z', '');
    buildEvents();
    const r = cli('assemble', 'build');
    expect(r.status, r.stderr).toBe(0);
  });

  // Rule: D17, a legacy feature (no results/ folder, no ledger results rows) starts without the gate, so it assembles.
  it('a legacy feature (no results/ and no ledger results rows) still assembles a no-feature run', () => {
    startRun('build', '2026-11-13T09:00:00.000Z', '');
    buildEvents();
    const r = cli('assemble', 'build');
    expect(r.status, r.stderr).toBe(0);
  });

  it('a results/ folder alone (no ledger rows) is not legacy: no_prev_result', () => {
    fs.mkdirSync(path.join(activeDir(FEATURE), 'results'), { recursive: true });
    startRun('ship', '2026-11-13T09:00:00.000Z', '');
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no_prev_result');
  });
});

describe('phase-result CLI: check refuses anything not bound to this run', () => {
  it('no result file gives missing', () => {
    startRun('plan', '2026-11-13T09:00:00.000Z');
    const r = cli('check', 'plan');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('missing');
    expect(r.stderr).toContain('oss-phase-result.sh assemble plan');
  });

  it('a hand-written schema-valid result gives unbound_result', () => {
    startRun('plan', '2026-11-13T09:00:00.000Z');
    fs.mkdirSync(path.join(activeDir(FEATURE), 'results'), { recursive: true });
    fs.writeFileSync(
      resultFile(FEATURE, 'plan'),
      JSON.stringify({
        v: 1,
        phase: 'plan',
        feature: FEATURE,
        startedAt: '2026-11-13T09:00:00.000Z',
        assembledAt: '2026-11-13T09:10:00.000Z',
        headSha: git('rev-parse', 'HEAD'),
        verification: 'verified',
        sources: { tasks: 'model' },
        claims: [],
        chain: [],
        tasks: [{ id: 'T1', title: 'forged', testIds: ['x.test.ts:y'] }],
      }),
    );
    const r = cli('check', 'plan');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unbound_result');
  });

  it('a result edited after assemble gives unbound_result', () => {
    assembledPlan();
    const file = resultFile(FEATURE, 'plan');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('first task', 'edited task'));
    const r = cli('check', 'plan');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unbound_result');
  });

  it('a result copied from another feature gives stale_result', () => {
    assembledPlan();
    fs.mkdirSync(path.join(activeDir(OTHER), 'results'), { recursive: true });
    fs.copyFileSync(resultFile(FEATURE, 'plan'), resultFile(OTHER, 'plan'));
    git('checkout', '-q', '-b', `feat/${OTHER}/build`);
    const r = cli('check', 'plan');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('stale_result');
  });

  it('a result from an older run gives stale_result', () => {
    assembledPlan();
    startRun('plan', '2026-11-13T11:00:00.000Z');
    const r = cli('check', 'plan');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('stale_result');
    expect(r.stderr).toContain('startedAt');
  });

  it('a code field that no longer matches the evidence gives evidence_mismatch', () => {
    startRun('build', '2026-11-13T09:00:00.000Z');
    writeEvents([event('2026-11-13T09:01:00.000Z', 'red'), event('2026-11-13T09:02:00.000Z', 'green')]);
    const a = cli('assemble', 'build');
    expect(a.status, a.stderr).toBe(0);
    writeEvents([event('2026-11-13T09:03:00.000Z', 'green')]);
    const r = cli('check', 'build');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('evidence_mismatch');
    expect(r.stderr).toContain('testRuns');
  });

  // Behaviour: a ship result whose code-owned fields were forged cannot pass, even with its sources map emptied.
  // Rule: round 2 security (MEDIUM): check compares a fixed per-phase list of code-owned evidence fields, never the
  //       stored `sources`, so `"sources":{}` does not skip the comparison.
  it('a bound result with sources {} and a changed verdict fails check with evidence_mismatch', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    const line = JSON.stringify({
      v: 1, id: randomUUID(), ts: '2026-11-13T09:31:00Z', kind: 'gate', feature: FEATURE, session: 'sess-accept-1',
      round: 1, gate: 'security', verdict: 'fail', findings: { high: 1 }, fixed: {}, mode: 'full',
    });
    fs.appendFileSync(path.join(activeDir(FEATURE), 'timeline.ndjson'), `${line}\n`);
    openLedger(repo).appendRow(`gates/${FEATURE}`, { sha256: sha256(line) });
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    const stored = JSON.parse(fs.readFileSync(resultFile(FEATURE, 'ship'), 'utf-8')) as Record<string, unknown>;
    expect(stored.verdict).toBe('blocked');
    const forged = JSON.stringify({ ...stored, sources: {}, verdict: 'ready_to_merge', blockers: [] });
    fs.writeFileSync(resultFile(FEATURE, 'ship'), forged);
    // the race outcome: the forged bytes got bound
    openLedger(repo).appendRow(`results/${FEATURE}/ship`, { ...openLedger(repo).lastRow(`results/${FEATURE}/ship`), sha256: sha256(forged) });
    const r = cli('check', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('evidence_mismatch');
  });

  // Behaviour: oss-notify's complete reads the ship verdict from check, so a verified but blocked ship never completes.
  // Rule: D35, `check ship` prints `"verdict":"<verdict>"` next to verification.
  it('check ship prints the verdict of a blocked ship', () => {
    commitFile('feature.txt', 'work\n');
    for (const gate of GATES) {
      const l = JSON.stringify({
        v: 1, id: randomUUID(), ts: '2026-11-13T09:30:00Z', kind: 'gate', feature: FEATURE, session: 'sess-accept-1',
        round: 1, gate, verdict: gate === 'security' ? 'fail' : 'pass', findings: {}, fixed: {}, mode: 'full',
      });
      fs.appendFileSync(path.join(activeDir(FEATURE), 'timeline.ndjson'), `${l}\n`);
      openLedger(repo).appendRow(`gates/${FEATURE}`, { sha256: sha256(l) });
    }
    startRun('ship', '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    const c = cli('check', 'ship');
    expect(c.status, c.stderr).toBe(0);
    expect(JSON.parse(c.stdout)).toMatchObject({ verification: 'verified', verdict: 'blocked' });
  });

  it('a ship result made before a new commit gives stale_result', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    expect(cli('check', 'ship').status).toBe(0);
    commitFile('later.txt', 'more\n');
    const r = cli('check', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('stale_result');
    expect(r.stderr).toContain('headSha');
  });

  it('a ship result with a recorded override still checks after the value file has aged out', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    const id = randomUUID();
    const line = JSON.stringify({ v: 1, id, feature: FEATURE, question: 'Defer the LOW finding?', person: 'Pat' });
    fs.appendFileSync(path.join(activeDir(FEATURE), 'decisions.ndjson'), `${line}\n`);
    openLedger(repo).appendRow(`decisions/${FEATURE}`, { id, feature: FEATURE, sha256: sha256(line) });
    const overrides = path.join(valueDir(), 'overrides.json');
    fs.writeFileSync(overrides, JSON.stringify([{ finding: 'LOW: naming', decisionId: id }]));
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(overrides, old, old);
    const r = cli('check', 'ship');
    expect(r.status, r.stderr).toBe(0);
  });

  it('a repo unverified marker or a ledger pending marker gives unverified', () => {
    assembledPlan();
    fs.writeFileSync(path.join(activeDir(FEATURE), 'results', 'plan.unverified.json'), '{}');
    const repoMarker = cli('check', 'plan');
    expect(repoMarker.status).toBe(1);
    expect(repoMarker.stderr).toContain('unverified');

    fs.rmSync(path.join(activeDir(FEATURE), 'results', 'plan.unverified.json'));
    expect(cli('check', 'plan').status).toBe(0);
    openLedger(repo).writeMarker(`pending/${FEATURE}/plan`, { check: 'phase-result-missing', at: 'x' });
    const ledgerMarker = cli('check', 'plan');
    expect(ledgerMarker.status).toBe(1);
    expect(ledgerMarker.stderr).toContain('unverified');
  });
});

describe('phase-result CLI: the ship base comes from repo config oss.shipBase, else main', () => {
  const INTEGRATION = 'feat/sprint/build';

  /**
   * Recuts the feature branch from an integration branch that already has commits main lacks.
   * ⚠ changes existing test: finding 7 (round 1 security) — base.txt is accepted only for a branch on origin (or
   *   oss.shipBase, or main), so the integration branch is also given its refs/remotes/origin ref unless `pushed` is false.
   */
  function featureFromIntegration(pushed = true): string {
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', INTEGRATION);
    commitFile('sprint1.txt', 'a\nb\nc\n');
    commitFile('sprint2.txt', 'd\ne\n');
    const cut = git('rev-parse', 'HEAD');
    if (pushed) git('update-ref', `refs/remotes/origin/${INTEGRATION}`, cut);
    // ⚠ changes existing test: D34 corrected — the pushed integration branch counts as a base through its own
    //   refs/remotes/origin ref (written above, before the run, with a reflog); origin/HEAD is no longer set.
    git('branch', '-q', '-D', `feat/${FEATURE}/build`);
    git('checkout', '-q', '-b', `feat/${FEATURE}/build`);
    return cut;
  }

  function shipResult(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(resultFile(FEATURE, 'ship'), 'utf-8')) as Record<string, unknown>;
  }

  // User behaviour: a feature cut from an integration branch ships with a diff of only its own commits.
  // Business rule: the ship base is the repo-local `oss.shipBase` (a local ref, never gh or fetch); check agrees.
  it('with oss.shipBase set to the integration branch, diff.base is its merge-base and totals cover only the feature', () => {
    const cut = featureFromIntegration();
    git('config', '--local', 'oss.shipBase', INTEGRATION);
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    expect(shipResult().diff).toEqual({ base: cut, baseRef: INTEGRATION, files: 1, insertions: 1, deletions: 0 });
    const c = cli('check', 'ship');
    expect(c.status, c.stderr).toBe(0);
  });

  // User behaviour: a repo with no ship base configured keeps shipping against main.
  // Business rule: unset `oss.shipBase` falls back to `main`.
  it('unset oss.shipBase still diffs against main', () => {
    featureFromIntegration();
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    expect(shipResult().diff).toEqual({ base: git('rev-parse', 'main'), baseRef: 'main', files: 3, insertions: 6, deletions: 0 });
  });

  // User behaviour: a bad ship base stops ship with a named refusal instead of a wrong diff.
  // Business rule: the configured value passes the ref checks or the result is refused; never a silent fallback.
  it('oss.shipBase set to an option-like value refuses with diff_unavailable and exit 1', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    git('config', '--local', 'oss.shipBase', '--output=x');
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('diff_unavailable');
    expect(fs.existsSync(path.join(repo, 'x'))).toBe(false);
  });

  // User behaviour: a branch already squash-merged into its integration branch cannot ship again.
  // Business rule: a tree equal to the configured base tip is `empty_diff`.
  it('a branch squash-merged into the integration branch gives empty_diff', () => {
    featureFromIntegration();
    git('config', '--local', 'oss.shipBase', INTEGRATION);
    commitFile('feature.txt', 'work\n');
    git('checkout', '-q', INTEGRATION);
    git('merge', '-q', '--squash', `feat/${FEATURE}/build`);
    git('commit', '-q', '-m', 'squash feature');
    // ⚠ changes existing test: D34 (corrected) — the squash commit is pushed, so the base tip is in its origin ref.
    git('update-ref', `refs/remotes/origin/${INTEGRATION}`, git('rev-parse', 'HEAD'));
    git('checkout', '-q', `feat/${FEATURE}/build`);
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('empty_diff');
  });
});

/**
 * D34 (user pick, ship round 2; pen F9): a ship base is accepted only when it is an ancestor of, or equal to, origin's
 * default branch tip (refs/remotes/origin/HEAD, else origin/main), and a base ref (or the oss.shipBase-named ref)
 * whose reflog says it was created after the ship run started is refused. Both refuse with unsafe_base.
 */
describe('phase-result CLI: the ship base must be an ancestor of origin\'s default branch (D34)', () => {
  function shipFeature(): void {
    commitFile('feature-1.txt', 'one\n');
    commitFile('feature-2.txt', 'two\n');
    passGates(FEATURE);
  }

  // Behaviour: a normal feature ships against main, which origin's default branch contains.
  it('a normal base (main, equal to origin/main) is accepted', () => {
    shipFeature();
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
  });

  // Behaviour: pointing oss.shipBase at part of the feature cannot hide that part from the diff.
  it('the shipBase repro: oss.shipBase naming a branch cut inside the feature refuses unsafe_base', () => {
    commitFile('feature-1.txt', 'one\n');
    git('branch', 'hide');
    commitFile('feature-2.txt', 'two\n');
    passGates(FEATURE);
    git('config', '--local', 'oss.shipBase', 'hide');
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
    expect(fs.existsSync(resultFile(FEATURE, 'ship'))).toBe(false);
  });

  it('the update-ref repro: main moved into the feature with update-ref refuses unsafe_base', () => {
    shipFeature();
    git('update-ref', 'refs/heads/main', git('rev-parse', 'HEAD~1'));
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });

  // Rule: a base ref created after the ship run started is refused, even when origin's default contains it.
  it('a base ref created after the ship run started refuses unsafe_base', () => {
    shipFeature();
    startRun('ship', '2026-11-13T09:00:00.000Z');
    gitNow('branch', 'late-base', 'main');
    git('config', '--local', 'oss.shipBase', 'late-base');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });

  it('a base ref with no reflog is judged by ancestry alone', () => {
    shipFeature();
    git('branch', 'quiet-base', 'main');
    fs.rmSync(path.join(repo, '.git', 'logs', 'refs', 'heads', 'quiet-base'), { force: true });
    git('config', '--local', 'oss.shipBase', 'quiet-base');
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
  });

  it('no origin default branch at all refuses unsafe_base', () => {
    shipFeature();
    git('update-ref', '-d', 'refs/remotes/origin/main');
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });
});

/**
 * D34 corrected (user re-pick, ship round 3): a base is also accepted when it is contained in an existing
 * refs/remotes/origin/<name> whose reflog shows it was created BEFORE this ship run started (an integration branch PRs
 * target). That remote ref with no reflog is refused; one created during the run (update-ref, fetch-to-self) is refused.
 */
describe('phase-result CLI: an integration-branch base on origin (D34 corrected)', () => {
  const INTEGRATION = 'feat/x/build';

  /** An integration branch ahead of main, fetched into refs/remotes/origin/ by a real fetch, then the feature on it. */
  function integration(fetchWith: (...args: string[]) => string = git): void {
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', INTEGRATION);
    commitFile('sprint.txt', 'sprint\n');
    fetchWith('fetch', '-q', '.', `refs/heads/${INTEGRATION}:refs/remotes/origin/${INTEGRATION}`);
    git('branch', '-q', '-D', `feat/${FEATURE}/build`);
    git('checkout', '-q', '-b', `feat/${FEATURE}/build`);
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    git('config', '--local', 'oss.shipBase', INTEGRATION);
  }

  it('a real fetch writes a reflog for the remote-tracking ref', () => {
    integration();
    expect(fs.existsSync(path.join(repo, '.git', 'logs', 'refs', 'remotes', 'origin', ...INTEGRATION.split('/')))).toBe(true);
  });

  // Behaviour: a feature whose PR targets an integration branch (ahead of origin/main) ships against it.
  it('an integration-branch base fetched before the run, ahead of origin/main, is accepted', () => {
    integration();
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    const r = JSON.parse(fs.readFileSync(resultFile(FEATURE, 'ship'), 'utf-8')) as Record<string, unknown>;
    expect((r.diff as Record<string, unknown>).baseRef).toBe(INTEGRATION);
  });

  it('the fetch-to-self repro: the remote ref made after the run started is refused', () => {
    startRun('ship', '2026-11-13T09:00:00.000Z');
    integration(gitNow);
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });

  it('the update-ref repro: the remote ref made with update-ref after the run started is refused', () => {
    integration();
    git('update-ref', '-d', `refs/remotes/origin/${INTEGRATION}`);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    gitNow('update-ref', `refs/remotes/origin/${INTEGRATION}`, git('rev-parse', INTEGRATION));
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });

  it('the remote ref with no reflog is refused', () => {
    integration();
    fs.rmSync(path.join(repo, '.git', 'logs', 'refs', 'remotes', 'origin', ...INTEGRATION.split('/')), { force: true });
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });

  it('a local base moved past its origin ref is refused', () => {
    integration();
    git('update-ref', `refs/heads/${INTEGRATION}`, git('rev-parse', 'HEAD'));
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });
});

/** Pen N3 (round 2, MEDIUM): every git the phase-result CLI runs is the fixed-path one, never a `git` on PATH. */
describe('phase-result CLI: git from a fixed path (pen N3)', () => {
  it('a fake git planted on PATH is never run by assemble or check ship', () => {
    shipFeatureForPath();
    const ran = path.join(tmp, 'fake-git.calls');
    fs.writeFileSync(path.join(shimDir, 'git'), `#!/bin/sh\necho "git $*" >> "${ran}"\nexit 1\n`);
    fs.chmodSync(path.join(shimDir, 'git'), 0o755);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    const c = cli('check', 'ship');
    expect(c.status, c.stderr).toBe(0);
    expect(fs.existsSync(ran) ? fs.readFileSync(ran, 'utf-8') : '').toBe('');
  });

  function shipFeatureForPath(): void {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
  }
});

describe('phase-result CLI: the ship base comes from the PR base value file base.txt (D19)', () => {
  const INTEGRATION = 'feat/sprint/build';

  /**
   * Recuts the feature branch from an integration branch that already has commits main lacks.
   * ⚠ changes existing test: finding 7 (round 1 security) — base.txt is accepted only for a branch on origin (or
   *   oss.shipBase, or main), so the integration branch is also given its refs/remotes/origin ref unless `pushed` is false.
   */
  function featureFromIntegration(pushed = true): string {
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', INTEGRATION);
    commitFile('sprint1.txt', 'a\nb\nc\n');
    commitFile('sprint2.txt', 'd\ne\n');
    const cut = git('rev-parse', 'HEAD');
    if (pushed) git('update-ref', `refs/remotes/origin/${INTEGRATION}`, cut);
    // ⚠ changes existing test: D34 corrected — the pushed integration branch counts as a base through its own
    //   refs/remotes/origin ref (written above, before the run, with a reflog); origin/HEAD is no longer set.
    git('branch', '-q', '-D', `feat/${FEATURE}/build`);
    git('checkout', '-q', '-b', `feat/${FEATURE}/build`);
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    return cut;
  }

  function writeBase(content: string): string {
    const f = path.join(valueDir(), 'base.txt');
    fs.writeFileSync(f, content);
    return f;
  }

  function shippedDiff(): Record<string, unknown> {
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    const r = JSON.parse(fs.readFileSync(resultFile(FEATURE, 'ship'), 'utf-8')) as Record<string, unknown>;
    return r.diff as Record<string, unknown>;
  }

  // User behaviour: a feature whose PR targets an integration branch ships with a diff of only its own commits,
  // without the user setting any repo config.
  // Business rule: base.txt naming an existing local branch is the ship base, recorded as diff.baseRef.
  it('base.txt naming the integration branch gives baseRef, its merge-base, and only the feature totals', () => {
    const cut = featureFromIntegration();
    writeBase(`${INTEGRATION}\n`);
    expect(shippedDiff()).toEqual({ base: cut, baseRef: INTEGRATION, files: 1, insertions: 1, deletions: 0 });
  });

  // User behaviour: a PR base must be a branch the team shares, so the model cannot pick a private local branch to
  //   shrink the reviewed diff.
  // Business rule: finding 7, base.txt naming a local-only branch (no origin ref, not oss.shipBase, not main) is refused.
  it('base.txt naming a local-only branch refuses with unsafe_base and writes no result', () => {
    featureFromIntegration(false);
    writeBase(`${INTEGRATION}\n`);
    const a = cli('assemble', 'ship');
    expect(a.status).toBe(1);
    expect(a.stderr).toContain('unsafe_base');
    expect(fs.existsSync(resultFile(FEATURE, 'ship'))).toBe(false);
  });

  // ⚠ changes existing test: D34 — a local-only base ahead of origin's default branch is refused even when it is
  //   oss.shipBase (it used to be accepted): the base must be an ancestor of origin's default branch tip.
  it('base.txt naming a local-only branch that equals oss.shipBase, ahead of origin\'s default, refuses unsafe_base', () => {
    featureFromIntegration(false);
    git('config', '--local', 'oss.shipBase', INTEGRATION);
    writeBase(`${INTEGRATION}\n`);
    const r = cli('assemble', 'ship');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unsafe_base');
  });

  it('base.txt naming main is accepted with no origin ref', () => {
    featureFromIntegration(false);
    writeBase('main\n');
    expect(shippedDiff().baseRef).toBe('main');
  });

  // User behaviour: a PR base the repo does not have locally does not stop ship; the repo setting applies.
  // Business rule: base.txt not naming a local branch falls back to oss.shipBase.
  it('base.txt naming a branch that does not exist locally falls back to oss.shipBase', () => {
    featureFromIntegration();
    git('config', '--local', 'oss.shipBase', INTEGRATION);
    writeBase('feat/gone/build\n');
    expect(shippedDiff().baseRef).toBe(INTEGRATION);
  });

  // User behaviour: with no repo setting either, ship keeps diffing against main.
  // Business rule: base.txt not naming a local branch, with oss.shipBase unset, falls back to main.
  it('base.txt naming a branch that does not exist locally, with no oss.shipBase, falls back to main', () => {
    featureFromIntegration();
    writeBase('feat/gone/build\n');
    expect(shippedDiff()).toMatchObject({ base: git('rev-parse', 'main'), baseRef: 'main' });
  });

  // User behaviour: a hostile base value cannot make git write files or change its behaviour.
  // Business rule: base.txt that fails the branch-name check falls back and never reaches git as an option.
  it('base.txt containing --output=x falls back to main and never reaches git as an option', () => {
    featureFromIntegration();
    writeBase('--output=x\n');
    expect(shippedDiff().baseRef).toBe('main');
    expect(fs.existsSync(path.join(repo, 'x'))).toBe(false);
  });

  // User behaviour: a malformed base value is ignored rather than half-read.
  // Business rule: base.txt must be exactly one line; two lines fall back.
  it('base.txt with two lines falls back', () => {
    featureFromIntegration();
    writeBase(`${INTEGRATION}\n${INTEGRATION}\n`);
    expect(shippedDiff().baseRef).toBe('main');
  });

  // User behaviour: the ship result stays valid after the short-lived value file is gone.
  // Business rule: check re-derives from the recorded diff.baseRef, never from base.txt.
  it('check passes after base.txt is deleted, using the recorded baseRef', () => {
    featureFromIntegration();
    const f = writeBase(`${INTEGRATION}\n`);
    expect(shippedDiff().baseRef).toBe(INTEGRATION);
    fs.rmSync(f);
    const c = cli('check', 'ship');
    expect(c.status, c.stderr).toBe(0);
  });

  // User behaviour: a result whose base branch has gone can no longer be trusted.
  // Business rule: the recorded baseRef must still be an existing local branch, else evidence_mismatch.
  it('check gives evidence_mismatch when the recorded baseRef branch is deleted', () => {
    featureFromIntegration();
    writeBase(`${INTEGRATION}\n`);
    expect(shippedDiff().baseRef).toBe(INTEGRATION);
    git('branch', '-q', '-D', INTEGRATION);
    const c = cli('check', 'ship');
    expect(c.status).toBe(1);
    expect(c.stderr).toContain('evidence_mismatch');
  });
});

describe('phase-result CLI: usage, --all, budgets', () => {
  it('an unknown phase or verb exits 2 with usage', () => {
    for (const args of [['check', 'deploy'], ['assemble', 'review'], ['frob', 'plan'], []]) {
      const r = cli(...args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr.toLowerCase()).toContain('usage');
    }
  });

  it('check ship --all prints one line per active feature and exits 0', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    const r = cli('check', 'ship', '--all');
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trim().split('\n').sort();
    expect(lines).toEqual([`${FEATURE} ok`, `${OTHER} missing`]);
  });

  // User behaviour: a feature whose ship was started again (say after more work) is not archived on the old result.
  // Business rule: finding 8, the archive rule needs the ship result of the feature's LAST ship run: its startedAt
  //   equals the last run/ship row naming that feature (the start gate writes `feature` on each run row). run/ship is
  //   per repo, so another feature's later ship run never blocks this one's archive.
  function shipRunOf(feature: string, startedAt: string): void {
    openLedger(repo).appendRow('run/ship', { startedAt, session: 'sess-accept-1', headSha: git('rev-parse', 'HEAD'), feature });
  }

  it('check ship --all refuses an older ship result once a later ship run of that feature started', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    shipRunOf(FEATURE, '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    shipRunOf(FEATURE, '2026-11-13T11:00:00.000Z');
    const r = cli('check', 'ship', '--all');
    expect(r.stdout).toContain(`${FEATURE} stale_result`);
  });

  it("check ship --all still archives after another feature's later ship run", () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    shipRunOf(FEATURE, '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    shipRunOf(OTHER, '2026-11-13T11:00:00.000Z');
    expect(cli('check', 'ship', '--all').stdout).toContain(`${FEATURE} ok`);
  });

  // Behaviour: a ship run started where no feature resolved may be this feature's re-ship, so the old result is stale.
  // Rule: pen N5 / code-review LOW 4 (round 2): a run/ship row with feature "" or no feature field, started after the
  //   result's startedAt, counts as the feature's later run.
  it('check ship --all refuses the result once a later ship run with feature "" started', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    shipRunOf(FEATURE, '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    shipRunOf('', '2026-11-13T11:00:00.000Z');
    expect(cli('check', 'ship', '--all').stdout).toContain(`${FEATURE} stale_result`);
  });

  it('check ship --all refuses the result once a later ship run with no feature field started', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    shipRunOf(FEATURE, '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    openLedger(repo).appendRow('run/ship', { startedAt: '2026-11-13T11:00:00.000Z', session: 's2', headSha: 'x' });
    expect(cli('check', 'ship', '--all').stdout).toContain(`${FEATURE} stale_result`);
  });

  it('a no-feature ship run from before the result does not make it stale', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    openLedger(repo).appendRow('run/ship', { startedAt: '2026-11-13T08:00:00.000Z', session: 's0', headSha: 'x', feature: '' });
    shipRunOf(FEATURE, '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    expect(cli('check', 'ship', '--all').stdout).toContain(`${FEATURE} ok`);
  });

  // Rule: the no-feature run row the result itself came from (same startedAt) is its own run, not a later one.
  it('a result from a no-feature ship run archives even after an older ship run of the feature', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    shipRunOf(FEATURE, '2026-11-13T08:00:00.000Z');
    // the build result the start gate (pen N1) asks for
    openLedger(repo).appendRow('run/build', { startedAt: '2026-11-13T07:00:00.000Z', session: 's', headSha: 'x', feature: FEATURE });
    writeEvents([event('2026-11-13T07:01:00.000Z', 'red'), event('2026-11-13T07:02:00.000Z', 'green')]);
    expect(cli('assemble', 'build').status).toBe(0);
    shipRunOf('', '2026-11-13T09:00:00.000Z');
    const a = cli('assemble', 'ship');
    expect(a.status, a.stderr).toBe(0);
    expect(cli('check', 'ship', '--all').stdout).toContain(`${FEATURE} ok`);
  });

  it('check --repo checks the named repo, not the cwd', () => {
    assembledPlan();
    const env = cleanEnv();
    env.HOME = home;
    env.PATH = `${shimDir}:${process.env.PATH ?? ''}`;
    const r = spawnSync(process.execPath, [CLI, 'check', 'plan', '--repo', repo], { cwd: tmp, env, encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
  });

  it('stays under loose hang ceilings: check < 1.5 s, assemble < 6 s', () => {
    startRun('plan', '2026-11-13T09:00:00.000Z');
    writeTasks();
    const a = cli('assemble', 'plan');
    expect(a.status, a.stderr).toBe(0);
    expect(a.ms).toBeLessThan(6000);
    const c = cli('check', 'plan');
    expect(c.status, c.stderr).toBe(0);
    expect(c.ms).toBeLessThan(1500);
  });

  it('never calls a network binary (curl, gh, wget) on assemble or check, ship included', () => {
    commitFile('feature.txt', 'work\n');
    passGates(FEATURE);
    startRun('ship', '2026-11-13T09:00:00.000Z');
    expect(cli('assemble', 'ship').status).toBe(0);
    expect(cli('check', 'ship').status).toBe(0);
    expect(cli('check', 'ship', '--all').status).toBe(0);
    expect(fs.existsSync(netCalls)).toBe(false);
  });
});
