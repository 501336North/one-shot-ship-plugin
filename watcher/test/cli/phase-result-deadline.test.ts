/**
 * @behavior When complete's one time budget is already spent before the archived-feature lookup runs, `check ship`
 *           refuses as a slow repo (diff_unavailable with the run-git-gc hint), never with a merge or GitHub hint, even
 *           though this ship run recorded ready and the merge gate tested a head.
 * @business-rule D86 info a (gate round 16, perf I1 / code I2): the lookup is charged to the shared deadline that main()
 *           starts, and a lookup past it refuses DIFF_TIMEOUT.
 * @boundary main() of watcher/src/cli/phase-result.ts, called in process; git is real; only the clock is replaced, so
 *           every reading after the deadline is taken is past it (no production knob).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openLedger } from '../../src/phase-results/ledger.js';
import { DIFF_TIMEOUT } from '../../src/phase-results/assemble-ship.js';

vi.setConfig({ testTimeout: 60_000 });

let tmp: string;
let repo: string;
let savedHome: string | undefined;
let savedGhPath: string | undefined;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}

/** main() of the CLI; importing the module also runs it once on vitest's own argv (a usage refusal), which is undone. */
async function cliMain(): Promise<(argv: string[]) => number> {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const mod = await import('../../src/cli/phase-result.js');
  process.exitCode = undefined;
  stderr.mockRestore();
  return mod.main;
}

beforeEach(() => {
  savedHome = process.env.HOME;
  savedGhPath = process.env.OSS_GH_PATH;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-result-deadline-')));
  process.env.HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.HOME);
  // A gh that would say "merged" if anything asked it: the refusal must not come from the merge path.
  fs.mkdirSync(path.join(tmp, 'bin'));
  fs.writeFileSync(path.join(tmp, 'bin', 'gh'), '#!/bin/sh\necho "$*" >> "$(dirname "$0")/calls"\necho "[]"\n', { mode: 0o755 });
  process.env.OSS_GH_PATH = path.join(tmp, 'bin');
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('checkout', '-q', '-b', 'feat/mine/build');
  fs.mkdirSync(path.join(repo, '.oss/dev/completed/mine-2026-11-23/results'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.oss/dev/completed/mine-2026-11-23/results/ship.json'), '{}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'docs: archive');
  const head = git('rev-parse', 'HEAD');
  const ledger = openLedger(repo);
  const startedAt = '2026-11-23T01:00:00.000Z';
  ledger.appendRow('run/ship', { startedAt, session: 's', headSha: head, feature: 'mine' });
  ledger.appendRow('merge/ready', { feature: 'mine', headSha: head, sha256: 'a'.repeat(64), startedAt, at: '2026-11-23T01:05:00.000Z' });
  ledger.appendRow('merge/tested', { startedAt, head, main: git('rev-parse', 'main'), at: '2026-11-23T01:06:00.000Z' });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = savedHome;
  if (savedGhPath === undefined) delete process.env.OSS_GH_PATH;
  else process.env.OSS_GH_PATH = savedGhPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('check ship with complete\'s budget already spent (D86 info a)', () => {
  it('refuses diff_unavailable with DIFF_TIMEOUT and shows no merge hint', async () => {
    const main = await cliMain();
    const real = Date.now();
    let calls = 0;
    // The first reading is main()'s deadline; every later one is 11 s on, past the 10 s budget.
    vi.spyOn(Date, 'now').mockImplementation(() => (calls++ === 0 ? real : real + 11_000));
    const err: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const rc = main(['check', 'ship', '--repo', repo]);
    const text = err.join('');
    expect(rc).toBe(1);
    expect(text).toContain(`diff_unavailable: ${DIFF_TIMEOUT}`);
    expect(text).not.toMatch(/GitHub|gh auth|merged|git fetch/);
    expect(fs.existsSync(path.join(tmp, 'bin', 'calls'))).toBe(false);
  });
});
