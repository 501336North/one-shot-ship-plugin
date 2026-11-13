#!/usr/bin/env node
/**
 * Hand-run benchmark for the phase-result CLI (R-257 T9, F8): median of 5 runs of `assemble build` and `check build`
 * on a 10k-event fixture. Targets (REQUIREMENTS NFR): check < 300 ms, assemble < 2 s. Not a test: timings vary by
 * machine, so the tests assert only loose hang ceilings.
 *
 * Usage: node watcher/scripts/bench-phase-result.mjs   (after `npm run build:cli-bundle`; needs Node 22.6+ for the
 * ledger import's type stripping). Uses a temp HOME and a temp git repo; touches nothing else.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const watcherRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(watcherRoot, 'dist', 'cli', 'phase-result.cjs');
const RUNS = 5;
const EVENTS = 10_000;
const feature = 'bench-feature';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-phase-result-')));
const home = path.join(tmp, 'home');
const repo = path.join(tmp, 'repo');
fs.mkdirSync(home);
fs.mkdirSync(repo);
const env = { ...process.env, HOME: home };
for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
const git = (...args) => execFileSync('git', args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'ignore'] });

try {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'bench@example.invalid');
  git('config', 'user.name', 'bench');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', `feat/${feature}/build`);
  fs.mkdirSync(path.join(repo, '.oss', 'dev', 'active', feature), { recursive: true });
  fs.mkdirSync(path.join(repo, '.oss', 'tool-gates'), { recursive: true });

  const start = Date.parse('2026-11-13T09:00:00.000Z');
  const lines = [];
  for (let i = 0; i < EVENTS; i++) {
    const ts = new Date(start + i * 1000).toISOString();
    const result = i === 0 ? 'red' : i % 2 === 0 ? 'green' : 'red';
    lines.push(JSON.stringify({ ts, tool: 'Bash', kind: 'test-run', program: 'npm', result: i === EVENTS - 1 ? 'green' : result }));
  }
  fs.writeFileSync(path.join(repo, '.oss', 'tool-gates', 'events.ndjson'), `${lines.join('\n')}\n`);

  process.env.HOME = home;
  const { openLedger } = await import(path.join(watcherRoot, 'src', 'phase-results', 'ledger.ts'));
  openLedger(repo).appendRow('run/build', { startedAt: new Date(start).toISOString(), session: 'bench', headSha: '' });

  const time = (verb) => {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [cli, verb, 'build'], { cwd: repo, env, encoding: 'utf-8' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.status !== 0) throw new Error(`${verb} build exited ${r.status}: ${r.stderr}`);
    return ms;
  };
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  const assembles = [];
  const checks = [];
  for (let i = 0; i < RUNS; i++) {
    assembles.push(time('assemble'));
    checks.push(time('check'));
  }
  const fmt = (xs) => xs.map((x) => x.toFixed(0)).join(', ');
  console.log(`events: ${EVENTS}, runs: ${RUNS}`);
  console.log(`assemble build: median ${median(assembles).toFixed(0)} ms (target < 2000) [${fmt(assembles)}]`);
  console.log(`check build:    median ${median(checks).toFixed(0)} ms (target < 300) [${fmt(checks)}]`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
