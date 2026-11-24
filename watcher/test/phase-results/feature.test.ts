/**
 * @behavior A /oss:ship re-run after the archive commit finds its feature in the one `.oss/dev/completed/<F>-<date>/`
 *           folder this branch added, measured from the same base assemble ship diffs from, so a stale local main never
 *           makes other features' archives (merged in from origin/main) look like this branch's own. It never picks a
 *           folder that belongs to another feature, and a slow git is reported as a slow repo, not as "no feature".
 * @business-rule D84 (find the archived feature), D85 (gate round 15: the lookup takes assemble's base; a branch that
 *           names a feature only matches that feature's folder; zero or several folders say what to do; a git timeout
 *           maps to DIFF_TIMEOUT). D86 (gate round 16): a branch whose name names no feature gets no archived lookup at
 *           all; folders are filtered by the named feature before they are counted; a git-ignored archive is named as
 *           the reason; the lookup spends from the caller's deadline.
 * @boundary watcher/src/phase-results/feature.ts (git is real; the process boundary is replaced only to force a timeout)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { archivedFeature } from '../../src/phase-results/feature.js';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

/** When set, every git child "runs past its time limit" (spawnSync's ETIMEDOUT). */
const slow = vi.hoisted(() => ({ on: false }));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const spawnSync: typeof real.spawnSync = ((...args: Parameters<typeof real.spawnSync>) => {
    if (!slow.on) return real.spawnSync(...args);
    const error: NodeJS.ErrnoException = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' });
    return { pid: 0, output: [], stdout: '', stderr: '', status: null, signal: 'SIGTERM', error };
  }) as typeof real.spawnSync;
  return { ...real, spawnSync };
});

let repo: string;
let origin: string;
const NO_SNAPSHOT: ReadonlyMap<string, string> = new Map();

function git(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd, env, encoding: 'utf-8' }).trim();
}
function write(dir: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}
function commitAll(dir: string, msg: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}
function archive(dir: string, folder: string): void {
  write(dir, `.oss/dev/completed/${folder}/results/ship.json`, `{"folder":"${folder}"}\n`);
  commitAll(dir, `docs: archive ${folder}`);
}
/** Another feature's PR merged on GitHub: origin/main gains its archive; this clone's local main is not updated. */
function otherFeatureLandsOnOrigin(): void {
  const w = `${origin}-gh`;
  git(path.dirname(origin), 'clone', '-q', origin, w);
  git(w, 'config', 'user.email', 'g@example.com');
  git(w, 'config', 'user.name', 'g');
  git(w, 'config', 'commit.gpgsign', 'false');
  archive(w, 'other-2026-11-20');
  git(w, 'push', '-q', 'origin', 'main');
  fs.rmSync(w, { recursive: true, force: true });
  git(repo, 'fetch', '-q', 'origin');
}
/** The ship-start snapshot as oss-notify records it: every refs/remotes ref name to its SHA. */
function snapshot(): Map<string, string> {
  const out = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/');
  return new Map(out.split('\n').filter((l) => l !== '' && !l.includes('/HEAD ')).map((l) => l.split(' ') as [string, string]));
}

beforeEach(() => {
  slow.on = false;
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'feature-test-')));
  origin = path.join(top, 'origin.git');
  repo = path.join(top, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'commit.gpgsign', 'false');
  write(repo, 'base.txt', 'base\n');
  commitAll(repo, 'base');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin');
});
afterEach(() => {
  slow.on = false;
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

describe('archivedFeature: finds the branch\'s own archive', () => {
  it('resolves the one completed folder this branch added (D84)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    write(repo, 'code.txt', 'work\n');
    commitAll(repo, 'work');
    archive(repo, 'mine-2026-11-23');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: true, feature: 'mine', folder: 'mine-2026-11-23' });
  });

  it('still resolves it when the branch merged origin/main (another feature archived there) and local main is stale', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    write(repo, 'code.txt', 'work\n');
    commitAll(repo, 'work');
    otherFeatureLandsOnOrigin();
    git(repo, 'merge', '-q', '--no-edit', 'origin/main');
    archive(repo, 'mine-2026-11-23');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: true, feature: 'mine', folder: 'mine-2026-11-23' });
  });
});

describe('archivedFeature: refusals say what to do', () => {
  it('never picks another feature\'s folder for a branch with no folder of its own (security medium)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/fix2/build');
    write(repo, 'code.txt', 'work\n');
    commitAll(repo, 'work');
    otherFeatureLandsOnOrigin();
    git(repo, 'merge', '-q', '--no-edit', 'origin/main');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: false, reason: 'none' });
  });

  it('refuses a single folder that is not the feature the branch name names, whatever the base', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/fix2/build');
    archive(repo, 'other-2026-11-20');
    expect(archivedFeature(repo, 'main', NO_SNAPSHOT)).toEqual({ ok: false, reason: 'none' });
  });

  // ⚠ changes existing test: D86 (code review low) — folders are filtered by the named feature before counting, so
  //   "several" now means several folders of this feature; another feature's folder no longer makes it refuse.
  it('refuses when this branch added several completed folders of its feature (it never guesses)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    archive(repo, 'mine-2026-11-23');
    archive(repo, 'mine-2026-11-24');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: false, reason: 'several' });
  });

  it('resolves its own folder when the branch also added another feature\'s folder (D86: filter, then count)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    archive(repo, 'mine-2026-11-23');
    archive(repo, 'other-2026-11-23');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: true, feature: 'mine', folder: 'mine-2026-11-23' });
  });

  it('says the archive is git-ignored when no folder shows and .oss/ is ignored (D86 pen low)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    write(repo, '.gitignore', '.oss/\n');
    commitAll(repo, 'ignore .oss');
    write(repo, '.oss/dev/completed/mine-2026-11-23/results/ship.json', '{}\n');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: false, reason: 'ignored' });
  });

  // D88 (code L1, pen I2): only a rule that really ignores the archive counts; a negated rule does not.
  it('does not call the archive git-ignored when a negation rule keeps .oss/dev/completed/ (D88)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    write(repo, '.gitignore', '.oss/dev/*\n!.oss/dev/completed/\n');
    commitAll(repo, 'ignore dev docs but not the archive');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: false, reason: 'none' });
  });

  it('calls the archive git-ignored when only its contents are ignored (.oss/dev/completed/*, D88)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    write(repo, '.gitignore', '.oss/dev/completed/*\n');
    commitAll(repo, 'ignore the archive contents');
    write(repo, '.oss/dev/completed/mine-2026-11-23/results/ship.json', '{}\n');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: false, reason: 'ignored' });
  });

  it('a spent deadline refuses as a timeout and runs no diff (D86 info a)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    archive(repo, 'mine-2026-11-23');
    expect(archivedFeature(repo, 'main', snapshot(), Date.now() - 1)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('reports a git timeout as a timeout, not as no feature (D85 info b)', () => {
    git(repo, 'checkout', '-q', '-b', 'feat/mine/build');
    archive(repo, 'mine-2026-11-23');
    slow.on = true;
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('archivedFeature: no feature in the branch name, no archived lookup (D86 security low, pen info)', () => {
  /** Feature a archived on feat/a/build (not merged); then `branch` is cut from it with code of its own. */
  function stackedOnArchive(branch: string): void {
    git(repo, 'checkout', '-q', '-b', 'feat/a/build');
    write(repo, 'a.js', '1\n');
    commitAll(repo, 'a');
    archive(repo, 'a-2026-11-20');
    git(repo, 'checkout', '-q', '-b', branch);
    write(repo, 'b.js', '2\n');
    commitAll(repo, 'b work');
  }

  for (const branch of ['hotfix-b', 'feat/b', 'b/build']) {
    it(`refuses ${branch}, stacked on another feature's archive (no_feature, never feature a)`, () => {
      stackedOnArchive(branch);
      expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: false, reason: 'unnamed' });
    });
  }

  it('resolves feat/a/build, which names its own archived feature', () => {
    stackedOnArchive('feat/a/build-fix');
    git(repo, 'checkout', '-q', 'feat/a/build');
    expect(archivedFeature(repo, 'main', snapshot())).toEqual({ ok: true, feature: 'a', folder: 'a-2026-11-20' });
  });
});
