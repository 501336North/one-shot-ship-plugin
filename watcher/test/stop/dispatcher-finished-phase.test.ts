/**
 * @behavior A phase finished earlier in the session stays finished at Stop. In a normal chain, the next phase's
 *           activity (ship's final test run after build, a plan picker after ideate) never makes the finished phase's
 *           result look mismatched, so Stop does not block on it.
 * @business-rule R-257 ship fix round 5, finding 1 (code review M2), D42: a build or ideate result stores its evidence
 *           cutoff at assemble, and the re-check counts test runs and decisions only up to it.
 * @boundary dispatch() in src/stop/dispatch.ts with real temp git repos, a temp HOME (ledger) and the real phase-result
 *           CLI for the finished phase. The next phase's own check is a stand-in that passes: its answer is not the
 *           point, and a block on it would hide the finished phase (subjects are checked newest first).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { openLedger } from '../../src/phase-results/ledger.js';
import { dispatch, type StopInput } from '../../src/stop/dispatch.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// OSS_TEST_PHASE_RESULT_CLI: a bundle built from src outside dist (fix rounds build dist once, at the end).
const REAL_CLI = process.env.OSS_TEST_PHASE_RESULT_CLI ?? path.resolve(HERE, '../../dist/cli/phase-result.cjs');

let tmp: string;
let repo: string;

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && k !== 'CLAUDE_PROJECT_DIR') env[k] = v;
  return env;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: cleanEnv(), encoding: 'utf-8' }).trim();
}

function featureDir(): string {
  return path.join(repo, '.oss', 'dev', 'active', 'demo');
}

function startRun(phase: string): string {
  const startedAt = new Date().toISOString();
  openLedger(repo).appendRow(`run/${phase}`, { startedAt, session: 'sess-1', headSha: git('rev-parse', 'HEAD'), feature: 'demo' });
  return startedAt;
}

function assemble(phase: string): void {
  const r = spawnSync(process.execPath, [REAL_CLI, 'assemble', phase], {
    cwd: repo,
    env: { ...cleanEnv(), CLAUDE_CODE_SESSION_ID: 'sess-1' },
    encoding: 'utf-8',
  });
  expect(r.status, r.stderr).toBe(0);
}

/** What assemble leaves for the next phase (the stand-in CLI passes its check): a results file and a bound row. */
function bindNext(phase: string, startedAt: string): void {
  const f = path.join(featureDir(), 'results', `${phase}.json`);
  fs.writeFileSync(f, `${JSON.stringify({ feature: 'demo', phase })}\n`);
  const sha256 = createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  openLedger(repo).appendRow(`results/demo/${phase}`, { sha256, feature: 'demo', phase, startedAt, headSha: 'x', session: 'sess-1' });
}

/** The phase-result CLI: the real one for <finished>, a pass for any other phase. */
function cliFor(finished: string): string {
  const cli = path.join(tmp, 'cli.cjs');
  fs.writeFileSync(
    cli,
    `const a = process.argv.slice(2);\n` +
      `if (a[1] !== ${JSON.stringify(finished)}) process.exit(0);\n` +
      `const r = require("child_process").spawnSync(process.execPath, [${JSON.stringify(REAL_CLI)}, ...a], { stdio: "inherit" });\n` +
      `process.exit(r.status === null ? 2 : r.status);\n`,
  );
  return cli;
}

function input(): StopInput {
  return { sessionId: 'sess-1', stopHookActive: false, cwd: repo };
}

function testRun(result: string, ts: string): void {
  const f = path.join(repo, '.oss', 'tool-gates', 'events.ndjson');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `${JSON.stringify({ ts, tool: 'Bash', kind: 'test-run', program: 'npm', result })}\n`);
}

/** A picker answer as the decision hook records it: the repo line and its ledger hash row. */
function pick(id: string, answeredAt: string): void {
  const line = JSON.stringify({ v: 1, id, feature: 'demo', question: `Q ${id}?`, answerText: 'A', kind: 'design', answeredAt });
  fs.appendFileSync(path.join(featureDir(), 'decisions.ndjson'), `${line}\n`);
  const sha256 = createHash('sha256').update(line).digest('hex');
  openLedger(repo).appendRow('decisions/demo', { id, feature: 'demo', sha256 });
}

/** Waits into the next whole second: the hook stamps answeredAt in seconds, and the pick must read as after assemble. */
async function nextSecond(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1001 - (Date.now() % 1000)));
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-stop-finished-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git('add', 'base.txt');
  git('commit', '-q', '-m', 'base');
  fs.mkdirSync(path.join(featureDir(), 'results'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('a finished phase is not undone by the next phase (finding 1, D42)', () => {
  // User behaviour: /oss:build finishes, /oss:ship starts and runs the final tests, and the session stops: the build
  // is still finished, so the stop goes through.
  it('build, then a test run, then ship: the stop is allowed', async () => {
    git('checkout', '-q', '-b', 'feat/demo/build');
    startRun('build');
    testRun('red', new Date().toISOString());
    testRun('green', new Date().toISOString());
    await new Promise((r) => setTimeout(r, 10));
    assemble('build');
    testRun('green', new Date().toISOString());
    bindNext('ship', startRun('ship'));
    expect(await dispatch(input(), { phaseResultCli: cliFor('build') })).toBeNull();
  });

  // User behaviour: /oss:ideate finishes, /oss:plan asks a picker question, and the session stops: the ideate result
  // still holds, so the stop goes through.
  it('ideate, then a picker, then plan: the stop is allowed', async () => {
    git('checkout', '-q', '-b', 'feat/demo/ideate');
    fs.writeFileSync(path.join(featureDir(), 'DESIGN.md'), '# Design\n\nStatus: COMMITTED\n');
    startRun('ideate');
    pick('d-1', new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    assemble('ideate');
    await nextSecond();
    pick('d-2', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    bindNext('plan', startRun('plan'));
    await nextSecond();
    expect(await dispatch(input(), { phaseResultCli: cliFor('ideate') })).toBeNull();
  });
});
