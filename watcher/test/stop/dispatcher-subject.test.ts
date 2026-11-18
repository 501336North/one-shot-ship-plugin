/**
 * @behavior A stop is blocked only by the run THIS session started for the feature THIS checkout is on. A finished
 *           ship, another feature's run or another session's run never blocks, and leaves no marker. Moving into a
 *           nested repo does not escape the project's own run. A ledger the stop cannot read never yields a message
 *           about a phase called "current", and an oversized ledger fails open (unverified + systemMessage).
 * @business-rule R-257 ship fix round 1, findings 1, 2, 3 and 8 (ADR-1): the stop subject is the run row whose
 *           feature equals the resolved feature for the repo and branch and whose session equals the Stop input's
 *           session_id; the cwd's repo and the CLAUDE_PROJECT_DIR repo are both checked.
 * @boundary dispatch() in src/stop/dispatch.ts with real temp git repos and a temp HOME (ledger). The phase-result CLI
 *           (an external process) is replaced by a small script only where its answer is the point.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { openLedger } from '../../src/phase-results/ledger.js';
import { dispatch, type StopInput } from '../../src/stop/dispatch.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHASE_RESULT_CLI = path.resolve(HERE, '../../dist/cli/phase-result.cjs');

let tmp: string;
let repo: string;

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && k !== 'CLAUDE_PROJECT_DIR') env[k] = v;
  return env;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf-8' }).trim();
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', 'base.txt');
  git(dir, 'commit', '-q', '-m', 'base');
}

function activate(dir: string, feature: string): void {
  fs.mkdirSync(path.join(dir, '.oss', 'dev', 'active', feature), { recursive: true });
}

/** The run row oss-notify start writes (field contract: startedAt, session, headSha, feature). */
function startRun(dir: string, phase: string, feature: string, session = 'sess-1'): string {
  const startedAt = new Date().toISOString();
  openLedger(dir).appendRow(`run/${phase}`, { startedAt, session, headSha: git(dir, 'rev-parse', 'HEAD'), feature });
  return startedAt;
}

function input(over: Partial<StopInput> = {}): StopInput {
  return { sessionId: 'sess-1', stopHookActive: false, cwd: repo, ...over };
}

function markers(dir: string): string[] {
  const d = openLedger(dir).dir;
  const found: string[] = [];
  for (const kind of ['pending', 'unverified']) {
    const k = path.join(d, kind);
    if (fs.existsSync(k)) for (const f of fs.readdirSync(k, { recursive: true }) as string[]) found.push(`${kind}/${f}`);
  }
  return found;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-stop-subject-')));
  repo = path.join(tmp, 'repo');
  initRepo(repo);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the stop subject is this session and this feature (findings 1, 2)', () => {
  // Repro 1. User behaviour: after a clean ship the feature is archived and the user is back on main; every later
  // stop goes through, with no marker and no loop-guard message about a phase called "current".
  it('a ship run of an archived feature, back on main, never blocks', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/demo/ship');
    activate(repo, 'demo');
    startRun(repo, 'ship', 'demo');
    git(repo, 'checkout', '-q', 'main');
    fs.rmSync(path.join(repo, '.oss', 'dev', 'active', 'demo'), { recursive: true });
    expect(await dispatch(input(), { phaseResultCli: PHASE_RESULT_CLI })).toBeNull();
    expect(await dispatch(input({ stopHookActive: true }), { phaseResultCli: PHASE_RESULT_CLI })).toBeNull();
    expect(markers(repo)).toEqual([]);
  });

  // Repro 2. User behaviour: a new feature branch with no run of its own is not blocked by the last feature's ship.
  it("a new feature branch is not blocked by another feature's run", async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/demo/ship');
    activate(repo, 'demo');
    startRun(repo, 'ship', 'demo');
    git(repo, 'checkout', '-q', '-b', 'feat/next/ideate');
    activate(repo, 'next');
    expect(await dispatch(input(), { phaseResultCli: PHASE_RESULT_CLI })).toBeNull();
    expect(markers(repo)).toEqual([]);
  });

  // Finding 2. User behaviour: a second Claude session in the same repo is not blocked by the phase the first
  // session started.
  it('session s2 is not blocked by a run another session started', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/demo/plan');
    activate(repo, 'demo');
    startRun(repo, 'plan', 'demo', 'other-session');
    expect(await dispatch(input({ sessionId: 's2' }), { phaseResultCli: PHASE_RESULT_CLI })).toBeNull();
    expect(markers(repo)).toEqual([]);
  });

  // Rule: the run that matches both still blocks, even when a later run of another session exists.
  it("this session's own unfinished run still blocks", async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/demo/plan');
    activate(repo, 'demo');
    startRun(repo, 'plan', 'demo');
    startRun(repo, 'build', 'demo', 'other-session');
    const out = await dispatch(input(), { phaseResultCli: PHASE_RESULT_CLI });
    expect(out?.decision).toBe('block');
    expect(out?.reason).toContain('assemble plan');
  });
});

describe('a nested repo does not escape the project (finding 3)', () => {
  // User behaviour: `git init` in a subfolder and cd into it; the stop is still blocked by the project's own run.
  it('blocks when the cwd is a nested repo and the project dir has an unfinished run', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/demo/plan');
    activate(repo, 'demo');
    startRun(repo, 'plan', 'demo');
    const nested = path.join(repo, 'sub');
    initRepo(nested);
    const out = await dispatch(input({ cwd: nested, projectDir: repo }), { phaseResultCli: PHASE_RESULT_CLI });
    expect(out?.decision).toBe('block');
    expect(out?.reason).toContain('plan');
  });
});

describe('ledger problems at Stop (findings 1, 8)', () => {
  // User behaviour: a message never names a phase called "current". Rule: no phase known, none named.
  it('a linked run folder blocks without naming a phase "current"', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/demo/plan');
    activate(repo, 'demo');
    startRun(repo, 'plan', 'demo');
    const run = path.join(openLedger(repo).dir, 'run');
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.renameSync(run, elsewhere);
    fs.symlinkSync(elsewhere, run);
    for (const active of [false, true]) {
      const out = await dispatch(input({ stopHookActive: active }), { phaseResultCli: PHASE_RESULT_CLI });
      expect(JSON.stringify(out)).not.toContain('current');
      if (!active) expect(JSON.stringify(out)).toContain('unsafe_path');
    }
  });

  // User behaviour: an oversized ledger never blocks with "assemble", which cannot fix it; the phase is marked
  // unverified and the user is told.
  it('ledger_too_large from the check fails open: unverified marker and systemMessage', async () => {
    git(repo, 'checkout', '-q', '-b', 'feat/demo/plan');
    activate(repo, 'demo');
    const startedAt = startRun(repo, 'plan', 'demo');
    openLedger(repo).appendRow('results/demo/plan', { sha256: 'a', feature: 'demo', phase: 'plan', startedAt });
    const cli = path.join(tmp, 'too-large.cjs');
    fs.writeFileSync(
      cli,
      'process.stderr.write("phase-result: check plan: ledger_too_large; rebuild: oss-phase-result.sh assemble plan\\n"); process.exit(1);\n',
    );
    const out = await dispatch(input(), { phaseResultCli: cli });
    expect(out?.decision).toBeUndefined();
    expect(out?.systemMessage).toContain('plan');
    expect(out?.systemMessage).toContain('ledger_too_large');
    expect(openLedger(repo).readMarker('unverified/demo/plan')?.errorClass).toBe('ledger_too_large');
  });
});

describe('a run with no feature still binds its own session (D30)', () => {
  /** A stand-in for the phase-result CLI (an external process): records its arguments and answers <status>. */
  function fakeCheck(status: number): { cli: string; calls: string } {
    const cli = path.join(tmp, `check-${status}.cjs`);
    const calls = path.join(tmp, 'check.calls');
    fs.writeFileSync(
      cli,
      `require("fs").appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(" ") + "\\n"); process.exit(${status});\n`,
    );
    return { cli, calls };
  }

  // User behaviour: /oss:ideate started on main (no feature folder yet, so the run row has feature ""); the folder
  // and branch now exist and the ideate result is missing: this session cannot stop.
  it("blocks the same session's empty-feature run when a feature resolves and has no result", async () => {
    startRun(repo, 'ideate', '');
    git(repo, 'checkout', '-q', '-b', 'feat/demo/ideate');
    activate(repo, 'demo');
    const out = await dispatch(input(), { phaseResultCli: PHASE_RESULT_CLI });
    expect(out?.decision).toBe('block');
    expect(out?.reason).toContain('assemble ideate');
    expect(openLedger(repo).readMarker('pending/demo/ideate')).not.toBeNull();
  });

  // User behaviour: once the ideate result is assembled for that feature, the stop goes through.
  it("allows the same session's empty-feature run once the resolved feature's result is valid", async () => {
    const startedAt = startRun(repo, 'ideate', '');
    git(repo, 'checkout', '-q', '-b', 'feat/demo/ideate');
    activate(repo, 'demo');
    openLedger(repo).appendRow('results/demo/ideate', { sha256: 'a', feature: 'demo', phase: 'ideate', startedAt });
    const { cli, calls } = fakeCheck(0);
    expect(await dispatch(input(), { phaseResultCli: cli })).toBeNull();
    expect(fs.readFileSync(calls, 'utf-8')).toContain('check ideate');
  });

  // User behaviour: no feature can be resolved (on main with no or several feature folders), so no result can be
  // built: the stop goes through, marked unverified, and the user is told. Never "current", never a block.
  it('fails open when no feature resolves: allow, unverified marker, systemMessage', async () => {
    startRun(repo, 'ideate', '');
    for (const active of [false, true]) {
      const out = await dispatch(input({ stopHookActive: active }), { phaseResultCli: PHASE_RESULT_CLI });
      expect(out?.decision).toBeUndefined();
      expect(out?.systemMessage).toContain('ideate');
      expect(out?.systemMessage).toContain('no_feature');
      expect(JSON.stringify(out)).not.toContain('current');
    }
    expect(markers(repo).some((m) => m.startsWith('unverified/') && m.endsWith('ideate'))).toBe(true);
  });

  // Rule: another session's empty-feature run never blocks and leaves nothing behind.
  it("another session's empty-feature run allows with no marker", async () => {
    startRun(repo, 'ideate', '', 'other-session');
    expect(await dispatch(input(), { phaseResultCli: PHASE_RESULT_CLI })).toBeNull();
    git(repo, 'checkout', '-q', '-b', 'feat/demo/ideate');
    activate(repo, 'demo');
    expect(await dispatch(input(), { phaseResultCli: PHASE_RESULT_CLI })).toBeNull();
    expect(markers(repo)).toEqual([]);
  });
});
