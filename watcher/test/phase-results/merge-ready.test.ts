/**
 * @behavior After an honest `/oss:ship --merge`, `complete` passes on the merged repo even though the feature folder is
 *           archived and the served merge step's run folder was cleaned up: the run's `merge/ready` row (what was
 *           checked) and `merge/tested` row (what the merge gate tested) stand in for the archived ship result. Any sign
 *           that what merged is not what was checked refuses.
 * @business-rule D78 (a blocked ship cannot pass complete), D83 (code review M1/L2, pen M1, security low, info c):
 *           - the rows belong to this ship run (same startedAt) and the ready row still names the bound result;
 *           - only `.oss/` paths change after the checked head (every merge against each parent, whatever the user's
 *             log settings say);
 *           - on main, the tested main is an ancestor of HEAD and not HEAD; on the feature branch (main checked out in
 *             another worktree), the tested main is a strict ancestor of origin/main;
 *           - all of mergedReady's git calls share one deadline inside complete's 15 s bound, from a budget the CLI
 *             starts in main() (D85 info e);
 *           D85: the completed folder whose result hashes to the ready row counts (an older archive does not block),
 *           and the feature-branch finish needs origin/main's tree to hold that archived result with the same bytes.
 * @boundary watcher/src/phase-results/merge-ready.ts (git is real; the process boundary is spied on only for the clock)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openLedger, type Ledger } from '../../src/phase-results/ledger.js';
import { mergedReady } from '../../src/phase-results/merge-ready.js';

vi.setConfig({ hookTimeout: 120_000, testTimeout: 120_000 });

/** A fake clock that each git process moves forward (info c): only the deadline test sets `step`. */
const clock = vi.hoisted(() => ({ step: 0, t: 0, timeouts: [] as Array<number | undefined> }));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const spawnSync: typeof real.spawnSync = ((...args: Parameters<typeof real.spawnSync>) => {
    clock.timeouts.push((args[2] as { timeout?: number } | undefined)?.timeout);
    const r = real.spawnSync(...args);
    clock.t += clock.step;
    return r;
  }) as typeof real.spawnSync;
  return { ...real, spawnSync };
});

const F = 'feat-x';
const STARTED = '2026-11-23T01:00:00.000Z';
let repo: string;
let home: string;
let savedHome: string | undefined;
let ledger: Ledger;
let readyHead: string;
let testedHead: string;
let testedMain: string;
let bytes: Buffer;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
function write(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), content);
}
function commitAll(msg: string): string {
  git('add', '-A');
  git('commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD');
}
/** served Step 8 + the merge gate: the ready row, the archive commit, the tested row (no run folder files at all). */
function shipped(): void {
  bytes = Buffer.from(JSON.stringify({ phase: 'ship', feature: F, verdict: 'ready_to_merge', gateEvidence: 'model', uncapturedGates: [] }));
  write(`.oss/dev/active/${F}/results/ship.json`, bytes.toString());
  readyHead = commitAll('feature work');
  ledger.appendRow('run/ship', { startedAt: STARTED, session: 's', headSha: readyHead, feature: F });
  ledger.appendRow(`results/${F}/ship`, { sha256: sha(bytes), feature: F, phase: 'ship', startedAt: STARTED, headSha: readyHead });
  ledger.appendRow('merge/ready', { feature: F, headSha: readyHead, sha256: sha(bytes), startedAt: STARTED, at: '2026-11-23T01:05:00.000Z' });
  fs.mkdirSync(path.join(repo, '.oss/dev/completed'), { recursive: true });
  fs.renameSync(path.join(repo, `.oss/dev/active/${F}`), path.join(repo, `.oss/dev/completed/${F}-2026-11-23`));
  write('.oss/reports/builds/r.md', 'report\n');
  testedHead = commitAll('docs: archive');
  testedMain = git('rev-parse', 'main');
  ledger.appendRow('merge/tested', { startedAt: STARTED, head: testedHead, main: testedMain, at: '2026-11-23T01:06:00.000Z' });
}
/** GitHub's squash merge, then served item 6 (switch to main). */
function squashToMain(): void {
  git('checkout', '-q', 'main');
  git('merge', '-q', '--squash', `feat/${F}/build`);
  git('commit', '-q', '-m', 'squash');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
}

beforeEach(() => {
  clock.step = 0;
  clock.t = 0;
  clock.timeouts = [];
  savedHome = process.env.HOME;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merge-ready-home-')));
  process.env.HOME = home;
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merge-ready-repo-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'gc.auto', '0');
  write('base.txt', 'base\n');
  commitAll('base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('checkout', '-q', '-b', `feat/${F}/build`);
  write('code.txt', 'one\n');
  ledger = openLedger(repo);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = savedHome;
  for (const d of [repo, home]) fs.rmSync(d, { recursive: true, force: true });
});

describe('mergedReady: an honest merge passes', () => {
  it('passes on main after the run folder is gone (served Step 10 removed head.txt and tested.txt)', () => {
    shipped();
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toMatchObject({ verdict: 'ready_to_merge' });
  });

  it('passes on the feature branch when main is checked out in another worktree and origin/main moved past the tested main', () => {
    shipped();
    // GitHub merged (origin/main moved); served item 6 could not switch, so HEAD stays on the feature branch.
    git('worktree', 'add', '-q', path.join(repo, '..', `${path.basename(repo)}-main`), 'main');
    const gh = git('commit-tree', `${testedHead}^{tree}`, '-p', testedMain, '-m', 'squash');
    git('update-ref', 'refs/remotes/origin/main', gh);
    try {
      expect(mergedReady(repo, ledger, STARTED)).toMatchObject({ verdict: 'ready_to_merge' });
    } finally {
      git('worktree', 'remove', '--force', path.join(repo, '..', `${path.basename(repo)}-main`));
    }
  });

  it('passes when the feature was archived before: the folder whose result hashes to the ready row counts (D85 code review L1)', () => {
    write(`.oss/dev/completed/${F}-2026-10-01/results/ship.json`, '{"phase":"ship","verdict":"blocked"}');
    commitAll('an earlier archive of the feature');
    git('branch', '-f', 'main', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    shipped();
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toMatchObject({ verdict: 'ready_to_merge' });
  });

  it('passes with a signed archive commit and log.showSignature=true (D83 security finding 2)', () => {
    const key = path.join(home, 'sign-key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
    git('config', 'gpg.format', 'ssh');
    git('config', 'user.signingkey', key);
    git('config', 'commit.gpgsign', 'true');
    git('config', 'log.showSignature', 'true');
    shipped();
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toMatchObject({ verdict: 'ready_to_merge' });
  });
});

describe('mergedReady: each refusal', () => {
  it('refuses when the archived result does not hash to the ready row (sha256 mismatch)', () => {
    shipped();
    fs.appendFileSync(path.join(repo, `.oss/dev/completed/${F}-2026-11-23/results/ship.json`), ' ');
    git('commit', '-q', '-am', 'edit');
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses when a later ship result was bound after the ready row (D83 security low: stale ready row)', () => {
    shipped();
    ledger.appendRow(`results/${F}/ship`, { sha256: 'b'.repeat(64), feature: F, phase: 'ship', startedAt: STARTED, headSha: readyHead });
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses when no tested row was recorded for this run', () => {
    shipped();
    ledger.appendRow('merge/tested', { startedAt: '2026-11-22T00:00:00.000Z', head: testedHead, main: testedMain, at: 'x' });
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses when the tested head is not covered by the ready row (the heads disagree)', () => {
    shipped();
    write('code.txt', 'changed after the check\n');
    const other = commitAll('code after the check');
    ledger.appendRow('merge/tested', { startedAt: STARTED, head: other, main: testedMain, at: '2026-11-23T01:07:00.000Z' });
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  // ⚠ changes existing test: D85 (code review L1, pen L2) — "refuses two completed folders" becomes "refuses when no
  //   completed folder holds the checked result"; a second folder from an earlier archive now passes (next describe).
  it('refuses when no completed folder of the feature holds the checked result', () => {
    shipped();
    fs.cpSync(path.join(repo, `.oss/dev/completed/${F}-2026-11-23`), path.join(repo, `.oss/dev/completed/${F}-2026-10-01`), { recursive: true });
    for (const d of ['2026-11-23', '2026-10-01']) fs.appendFileSync(path.join(repo, `.oss/dev/completed/${F}-${d}/results/ship.json`), ' ');
    git('add', '-A');
    git('commit', '-q', '-m', 'edit');
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses on the feature branch when the PR did not merge, though another commit moved origin/main (D85 pen L1)', () => {
    shipped();
    git('worktree', 'add', '-q', path.join(repo, '..', `${path.basename(repo)}-main`), 'main');
    const other = git('commit-tree', `${testedMain}^{tree}`, '-p', testedMain, '-m', 'another PR');
    git('update-ref', 'refs/remotes/origin/main', other);
    try {
      expect(mergedReady(repo, ledger, STARTED)).toBeNull();
    } finally {
      git('worktree', 'remove', '--force', path.join(repo, '..', `${path.basename(repo)}-main`));
    }
  });

  it('refuses on the feature branch when origin/main holds different bytes for the archived result (D85 pen L1)', () => {
    shipped();
    git('worktree', 'add', '-q', path.join(repo, '..', `${path.basename(repo)}-main`), 'main');
    const file = path.join(repo, `.oss/dev/completed/${F}-2026-11-23/results/ship.json`);
    fs.appendFileSync(file, ' ');
    git('add', '-A');
    git('commit', '-q', '-m', 'other bytes');
    const tree = git('rev-parse', 'HEAD^{tree}');
    git('reset', '-q', '--hard', 'HEAD~1');
    const gh = git('commit-tree', tree, '-p', testedMain, '-m', 'squash');
    git('update-ref', 'refs/remotes/origin/main', gh);
    try {
      expect(mergedReady(repo, ledger, STARTED)).toBeNull();
    } finally {
      git('worktree', 'remove', '--force', path.join(repo, '..', `${path.basename(repo)}-main`));
    }
  });

  it('refuses when the tested main is HEAD itself (nothing merged)', () => {
    shipped();
    git('checkout', '-q', 'main');
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses when the tested main is not an ancestor of HEAD', () => {
    shipped();
    squashToMain();
    const orphan = git('commit-tree', 'HEAD^{tree}', '-m', 'unrelated');
    git('reset', '-q', '--hard', orphan);
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses a code commit after the checked head', () => {
    shipped();
    write('code.txt', 'sneaky\n');
    const h = commitAll('code after the check');
    ledger.appendRow('merge/tested', { startedAt: STARTED, head: h, main: testedMain, at: '2026-11-23T01:07:00.000Z' });
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses a merge commit after the checked head that changes code, even with log.diffMerges=combined (D83 pen L3)', () => {
    shipped();
    git('config', 'log.diffMerges', 'combined');
    git('checkout', '-q', '-b', 'side', 'main');
    write('.oss/x/n', 'n\n');
    commitAll('side');
    git('checkout', '-q', `feat/${F}/build`);
    git('merge', '-q', '--no-ff', '--no-commit', 'side');
    git('rm', '-q', 'code.txt');
    git('commit', '-q', '-m', 'merge side');
    const h = git('rev-parse', 'HEAD');
    ledger.appendRow('merge/tested', { startedAt: STARTED, head: h, main: testedMain, at: '2026-11-23T01:07:00.000Z' });
    squashToMain();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });

  it('refuses a ready row from an earlier ship run (stale startedAt)', () => {
    shipped();
    squashToMain();
    expect(mergedReady(repo, ledger, '2026-11-23T02:00:00.000Z')).toBeNull();
  });

  it('refuses on the feature branch when origin/main has not moved past the tested main', () => {
    shipped();
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
  });
});

describe('mergedReady: one deadline for every git call (D83 info c)', () => {
  it('gives each git call only what is left of one 10 s budget, and stops once it is spent', () => {
    shipped();
    squashToMain();
    clock.timeouts = [];
    clock.t = 1_000_000;
    clock.step = 4_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock.t);
    expect(mergedReady(repo, ledger, STARTED)).toBeNull();
    expect(clock.timeouts.length).toBeGreaterThan(0);
    clock.timeouts.forEach((t, i) => expect(t).toBeLessThanOrEqual(10_000 - 4_000 * i));
    expect(clock.timeouts.length).toBeLessThanOrEqual(3);
  });

  it('takes the deadline of the budget the CLI started in main(), so a spent budget runs no git at all (D85 info e)', () => {
    shipped();
    squashToMain();
    clock.timeouts = [];
    expect(mergedReady(repo, ledger, STARTED, Date.now() - 1)).toBeNull();
    expect(clock.timeouts).toEqual([]);
  });
});
