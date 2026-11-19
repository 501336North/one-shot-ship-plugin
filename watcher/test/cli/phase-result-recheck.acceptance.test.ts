/**
 * @behavior A ship result's verdict must not change between assemble and the check that complete, start and archive
 *           run, nor flip when the ship is assembled again after a restarted run: every captured review-agent fail
 *           row is read each time and checked against the shipped code, so assemble and check see the same verdict.
 * @business-rule D47 (code review MEDIUM, gate round 4), amended by D51 (gate round 5): every captured fail row of
 *           the feature is checked against the shipped code, so the result is a pure function of the rows and HEAD and
 *           needs no stored cutoff. Assemble no longer writes `verdictsFrom`; a result stored with one (rounds 6-7)
 *           still validates and checks, the field ignored.
 * @boundary the phase-result CLI bundle (OSS_TEST_PHASE_RESULT_CLI, else the committed dist), spawned as
 *           hooks/oss-phase-result.sh runs it.
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
const GATES = ['code-review', 'performance', 'security'];
const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
const RUN_1 = '2026-11-13T09:00:00.000Z';
const RUN_2 = '2026-11-13T10:00:00.000Z';

let tmp: string;
let repo: string;
let home: string;
let savedHome: string | undefined;

// Helpers copied from phase-result.acceptance.test.ts (builder F owns that file).
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && k !== 'CLAUDE_PROJECT_DIR') env[k] = v;
  return env;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: { ...cleanEnv(), GIT_COMMITTER_DATE: '2026-11-13T08:00:00Z' }, encoding: 'utf-8' }).trim();
}

function commitFile(name: string, content: string): void {
  fs.writeFileSync(path.join(repo, name), content);
  git('add', name);
  git('commit', '-q', '-m', `add ${name}`);
}

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
const activeDir = (): string => path.join(repo, '.oss', 'dev', 'active', FEATURE);
const resultFile = (): string => path.join(activeDir(), 'results', 'ship.json');

function cli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = cleanEnv();
  env.HOME = home;
  env.CLAUDE_CODE_SESSION_ID = 'sess-recheck-1';
  env.CLAUDE_PROJECT_DIR = '/nonexistent-project-dir';
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf-8', timeout: 20_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The ship start's ledger row and its origin snapshot (D40/D46), as oss-notify start writes them. */
function startShip(startedAt: string): void {
  openLedger(repo).appendRow('run/ship', { startedAt, session: 'sess-recheck-1', headSha: git('rev-parse', 'HEAD') });
  openLedger(repo).writeMarker('run/ship.origin', { startedAt, refs: { 'refs/remotes/origin/main': git('rev-parse', 'refs/remotes/origin/main') } });
}

/** Ledger-backed gate lines, as oss-timeline.sh writes them. */
function gateLines(ts: string): void {
  for (const gate of GATES) {
    const line = JSON.stringify({
      v: 1, id: randomUUID(), ts, kind: 'gate', feature: FEATURE, session: 'sess-recheck-1', round: 1, gate,
      verdict: 'pass', findings: {}, fixed: {}, mode: 'full',
    });
    fs.appendFileSync(path.join(activeDir(), 'timeline.ndjson'), `${line}\n`);
    openLedger(repo).appendRow(`gates/${FEATURE}`, { sha256: sha256(line) });
  }
}

/** A captured review-agent fail on the current code. */
function capturedFail(ts: string): void {
  const tree = git('rev-parse', 'HEAD^{tree}');
  openLedger(repo).appendRow(`verdicts/${FEATURE}`, {
    gate: 'security', verdict: 'fail', findings: { ...ZERO, low: 1 }, agent: 'a', session: 's', ts, tree, trackedTree: tree,
    headSha: git('rev-parse', 'HEAD'), start: 'match',
  });
}

const stored = (): Record<string, unknown> => JSON.parse(fs.readFileSync(resultFile(), 'utf-8')) as Record<string, unknown>;

function assembled(): Record<string, unknown> {
  const a = cli('assemble', 'ship');
  expect(a.status, a.stderr).toBe(0);
  return stored();
}

function checked(): Record<string, unknown> {
  const c = cli('check', 'ship');
  expect(c.status, c.stderr).toBe(0);
  return JSON.parse(c.stdout) as Record<string, unknown>;
}

beforeEach(() => {
  savedHome = process.env.HOME;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-result-recheck-')));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  for (const d of [home, repo]) fs.mkdirSync(d, { recursive: true });
  process.env.HOME = home;
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  commitFile('base.txt', 'base\n');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'main'));
  git('checkout', '-q', '-b', `feat/${FEATURE}/build`);
  fs.mkdirSync(activeDir(), { recursive: true });
  fs.writeFileSync(path.join(activeDir(), 'DESIGN.md'), '# Design\n\nStatus: COMMITTED\n');
  const values = path.join(home, '.oss', 'run', ledgerKey(repo) as string);
  fs.mkdirSync(values, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(home, '.oss', 'run'), 0o700);
  commitFile('feature.txt', 'work\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const label = (r: Record<string, unknown>): Record<string, unknown> => ({
  verdict: r.verdict, gateEvidence: r.gateEvidence, uncapturedGates: r.uncapturedGates,
});

describe('phase-result CLI: the ship verdict is stable across re-checks (D47, D51)', () => {
  // Reproduces the code-review repro (scratchpad r4-code-review/t/recheck.test.ts): run 1 shipped ready to merge, a
  // reviewer then failed the code, and run 2 (a restart) assembles, checks, re-assembles and checks again.
  it('assemble, check, re-assemble and check across a restarted run agree', () => {
    startShip(RUN_1);
    gateLines('2026-11-13T09:30:00Z');
    // ⚠ changes existing test: D51 — no verdictsFrom is written any more (it was null here, RUN_1 below).
    const first = assembled();
    expect(first).toMatchObject({ verdict: 'ready_to_merge' });
    expect(first).not.toHaveProperty('verdictsFrom');

    capturedFail('2026-11-13T09:45:00.000Z');
    startShip(RUN_2);
    gateLines('2026-11-13T10:30:00Z');
    const a1 = assembled();
    expect(a1).toMatchObject({ verdict: 'blocked' });
    expect(checked()).toEqual({ verification: 'verified', ...label(a1) });

    const a2 = assembled();
    expect(label(a2)).toEqual(label(a1));
    expect(checked()).toEqual({ verification: 'verified', ...label(a1) });
  });

  it('a fixed fail: assemble and check agree on ready_to_merge, and stay so on re-check', () => {
    startShip(RUN_1);
    gateLines('2026-11-13T09:30:00Z');
    assembled();
    capturedFail('2026-11-13T09:45:00.000Z');
    commitFile('feature.txt', 'fixed\n');
    startShip(RUN_2);
    gateLines('2026-11-13T10:30:00Z');
    const a = assembled();
    expect(a).toMatchObject({ verdict: 'ready_to_merge' });
    expect(checked()).toEqual({ verification: 'verified', ...label(a) });
    expect(checked()).toEqual({ verification: 'verified', ...label(a) });
  });

  // ⚠ changes existing test: D51 — the old-results case is now a result stored WITH verdictsFrom (rounds 6-7), which
  //   must still validate and check, the field ignored (it was "a stored result without verdictsFrom is still checked
  //   by the old rule"). A cutoff that would have hidden the open fail no longer does.
  it('a stored result with a verdictsFrom from before round 7 still validates and checks, the field ignored', () => {
    startShip(RUN_1);
    gateLines('2026-11-13T09:30:00Z');
    capturedFail('2026-11-13T09:10:00.000Z');
    const a = assembled();
    expect(a.verdict).toBe('blocked');
    const bytes = JSON.stringify({ ...a, verdictsFrom: '2026-11-13T09:20:00.000Z' });
    fs.writeFileSync(resultFile(), bytes);
    const row = openLedger(repo).lastRow(`results/${FEATURE}/ship`);
    openLedger(repo).appendRow(`results/${FEATURE}/ship`, { ...row, sha256: sha256(bytes) });
    expect(checked()).toEqual({ verification: 'verified', ...label(a) });
  });
});

/**
 * D58 (user pick, ship round 9, "Feature paths only"): a teammate's commit brought in by a rebase does not clear an
 * unfixed fail, and check (which re-assembles) agrees with assemble on the blocked verdict.
 */
describe('phase-result CLI: a rebase does not clear an unfixed fail, and check agrees (D58)', () => {
  it('assemble after a rebase onto a teammate\'s commit stays blocked, and check verifies it', () => {
    capturedFail('2026-11-13T09:10:00.000Z');
    git('checkout', '-q', 'main');
    commitFile('mate.txt', 'mate\n');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('checkout', '-q', `feat/${FEATURE}/build`);
    git('rebase', '-q', 'main');
    startShip(RUN_1);
    gateLines('2026-11-13T09:30:00Z');
    const a = assembled();
    expect(a).toMatchObject({ verdict: 'blocked' });
    expect(checked()).toEqual({ verification: 'verified', ...label(a) });
  });
});
