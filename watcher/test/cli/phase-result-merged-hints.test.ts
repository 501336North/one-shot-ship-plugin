/**
 * @behavior After the PR merged and the feature folder is archived, a refused `check ship` (complete's check) says only
 *           what to do about its own cause. It never tells the user to rebuild the ship result with assemble: rebuilding
 *           breaks the ready row and the next complete refuses again (a loop). When the ready row no longer matches the
 *           ship result, it says to record the row again. It never shows the "name the branch" hint on main.
 * @business-rule D88 (gate round 17, pen medium; code I3, pen L1): merged-path refusals print only their cause's hint.
 * @boundary main() of watcher/src/cli/phase-result.ts, called in process; git is real; gh is a stub on the caller's PATH.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openLedger, type Ledger } from '../../src/phase-results/ledger.js';

vi.setConfig({ testTimeout: 60_000 });

const STARTED = '2026-11-23T01:00:00.000Z';
const READY_HINT = 'the ready row no longer matches the ship result: run oss-phase-result.sh check ship --record-ready, then send complete again';
let tmp: string;
let repo: string;
let ledger: Ledger;
let head: string;
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

/** `check ship` as complete runs it; returns its exit code and stderr. */
async function completeCheck(): Promise<{ rc: number; err: string }> {
  const main = await cliMain();
  const err: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const rc = main(['check', 'ship', '--repo', repo]);
  vi.restoreAllMocks();
  return { rc, err: err.join('') };
}

/** gh on the caller's PATH, exiting `rc` (4: not logged in). */
function ghExits(rc: number): void {
  fs.writeFileSync(path.join(tmp, 'bin', 'gh'), `#!/bin/sh\necho "$*" >> "$(dirname "$0")/calls"\nexit ${rc}\n`, { mode: 0o755 });
}

beforeEach(() => {
  savedHome = process.env.HOME;
  savedGhPath = process.env.OSS_GH_PATH;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-result-hints-')));
  process.env.HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.HOME);
  fs.mkdirSync(path.join(tmp, 'bin'));
  ghExits(0);
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
  const bytes = Buffer.from(JSON.stringify({ phase: 'ship', feature: 'mine', verdict: 'ready_to_merge', diff: { baseRef: 'main' } }));
  fs.mkdirSync(path.join(repo, '.oss/dev/completed/mine-2026-11-23/results'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.oss/dev/completed/mine-2026-11-23/results/ship.json'), bytes);
  git('add', '-A');
  git('commit', '-q', '-m', 'docs: archive');
  head = git('rev-parse', 'HEAD');
  const sha = createHash('sha256').update(bytes).digest('hex');
  ledger = openLedger(repo);
  ledger.appendRow('run/ship', { startedAt: STARTED, session: 's', headSha: head, feature: 'mine' });
  ledger.appendRow('results/mine/ship', { sha256: sha, feature: 'mine', phase: 'ship', startedAt: STARTED, headSha: head });
  ledger.appendRow('merge/ready', { feature: 'mine', headSha: head, sha256: sha, startedAt: STARTED, at: '2026-11-23T01:05:00.000Z' });
  ledger.appendRow('merge/tested', { startedAt: STARTED, head, main: git('rev-parse', 'main'), at: '2026-11-23T01:06:00.000Z' });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = savedHome;
  if (savedGhPath === undefined) delete process.env.OSS_GH_PATH;
  else process.env.OSS_GH_PATH = savedGhPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('complete after the merge: each refusal says only its own cause (D88)', () => {
  it('gh logged out: says to log in, and never says to rebuild with assemble', async () => {
    ghExits(4);
    const { rc, err } = await completeCheck();
    expect(rc).not.toBe(0);
    expect(err).toContain('gh is not installed or not logged in: run gh auth login, then send complete again');
    expect(err).not.toContain('assemble');
  });

  it('GitHub answers HTTP 404: says gh could not read the pull request, not "when online"', async () => {
    fs.writeFileSync(path.join(tmp, 'bin', 'gh'), '#!/bin/sh\necho "gh: Not Found (HTTP 404)" >&2\nexit 1\n', { mode: 0o755 });
    const { rc, err } = await completeCheck();
    expect(rc).not.toBe(0);
    expect(err).toContain('gh could not read this pull request: check gh auth status and access to');
    expect(err).not.toMatch(/when online|assemble/);
  });

  it('a ship result bound after the ready row: says to record the ready row again, not to rebuild', async () => {
    ledger.appendRow('results/mine/ship', { sha256: 'b'.repeat(64), feature: 'mine', phase: 'ship', startedAt: STARTED, headSha: head });
    const { rc, err } = await completeCheck();
    expect(rc).not.toBe(0);
    expect(err).toContain(READY_HINT);
    expect(err).not.toContain('assemble');
  });

  it('on main with a revoked ready row: no "name the branch" hint and no rebuild line', async () => {
    git('checkout', '-q', 'main');
    git('merge', '-q', '--squash', 'feat/mine/build');
    git('commit', '-q', '-m', 'squash');
    ledger.appendRow('merge/ready', { revoked: 'no_feature', at: '2026-11-23T01:07:00.000Z' });
    const { rc, err } = await completeCheck();
    expect(rc).not.toBe(0);
    expect(err).toContain('no_feature');
    expect(err).not.toMatch(/name the branch|assemble/);
  });
});
