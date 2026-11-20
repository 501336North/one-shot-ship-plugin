/**
 * @behavior Ship diffs the feature against its PR base. A base counts only when origin had a branch of that same name
 *           at ship start whose recorded tip contains the base, and the base is neither the branch being shipped nor
 *           one of the feature's own phase branches.
 * @business-rule D46 (user pick, ship round 6, "Same-name origin ref"; pen M2a, security 2a): a base contained in some
 *           other origin ref (such as the pushed feature branch itself) no longer counts, so the model cannot pick a
 *           point inside the feature and hide part of it from the reviewed diff.
 * @boundary shipBaseAllowed in assemble-ship.ts, run against a real temp git repo (git is the only collaborator).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shipBaseAllowed } from '../../src/phase-results/assemble-ship.js';

const FEATURE = 'feat-a';
let repo: string;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}

function commit(name: string): string {
  fs.writeFileSync(path.join(repo, name), `${name}\n`);
  git('add', name);
  git('commit', '-q', '-m', name);
  return git('rev-parse', 'HEAD');
}

/** The ship-start snapshot: origin ref name to the SHA it had then. */
function refs(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries).map(([k, v]) => [`refs/remotes/origin/${k}`, v]));
}

/** D50: a snapshot of any remotes, keyed `<remote>/<branch>`. */
function remoteRefs(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries).map(([k, v]) => [`refs/remotes/${k}`, v]));
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-base-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  commit('base.txt');
  git('checkout', '-q', '-b', `feat/${FEATURE}/build`);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('shipBaseAllowed (D46)', () => {
  // Behaviour: an ordinary feature ships against main, which origin had at ship start.
  it('accepts main contained in origin/main', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main }))).toBe(true);
  });

  // Behaviour: a PR into an integration branch ships against it when origin has that branch.
  it('accepts an integration branch behind its own origin ref', () => {
    git('checkout', '-q', '-b', 'sprint', 'main');
    const old = commit('s1.txt');
    const pushed = commit('s2.txt');
    git('checkout', '-q', `feat/${FEATURE}/build`);
    git('branch', '-q', '-f', 'sprint', old);
    expect(shipBaseAllowed(repo, 'sprint', FEATURE, refs({ sprint: pushed }))).toBe(true);
  });

  // Rule (pen M2a): a base inside the pushed feature branch is contained in origin/feat/<f>/build, not in origin/wip.
  it('refuses a base whose tip is only in another origin ref', () => {
    const inside = commit('one.txt');
    const head = commit('two.txt');
    git('branch', 'wip', inside);
    expect(shipBaseAllowed(repo, 'wip', FEATURE, refs({ main: git('rev-parse', 'main'), [`feat/${FEATURE}/build`]: head }))).toBe(false);
  });

  it('refuses a base with no origin ref of the same name', () => {
    git('branch', 'other', 'main');
    expect(shipBaseAllowed(repo, 'other', FEATURE, refs({ main: git('rev-parse', 'main') }))).toBe(false);
  });

  // Rule: the branch being shipped is never its own base, even when origin has it.
  it('refuses the current branch', () => {
    git('checkout', '-q', '-b', 'topic', 'main');
    const head = commit('t.txt');
    expect(shipBaseAllowed(repo, 'topic', FEATURE, refs({ topic: head }))).toBe(false);
  });

  // Rule (security 2a): the feature's own phase branches are never a base, wherever they point.
  it('refuses one of the feature\'s phase branches, even moved with branch -f', () => {
    const plan = commit('plan.txt');
    commit('build.txt');
    git('branch', '-f', `feat/${FEATURE}/plan`, plan);
    expect(shipBaseAllowed(repo, `feat/${FEATURE}/plan`, FEATURE, refs({ [`feat/${FEATURE}/plan`]: plan }))).toBe(false);
  });

  it('refuses a branch named after the feature itself', () => {
    git('branch', FEATURE, 'main');
    expect(shipBaseAllowed(repo, FEATURE, FEATURE, refs({ [FEATURE]: git('rev-parse', 'main') }))).toBe(false);
  });

  // D50 (user pick, "Any remote, same name"): a repo whose remote is not called origin can ship.
  it('accepts main on a repo whose only remote is upstream (upstream/main)', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    expect(shipBaseAllowed(repo, 'main', FEATURE, remoteRefs({ 'upstream/main': main }))).toBe(true);
  });

  it('refuses a base when the remote only has a branch of another name', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    expect(shipBaseAllowed(repo, 'main', FEATURE, remoteRefs({ 'upstream/trunk': main }))).toBe(false);
  });

  it('accepts a base that only one of two remotes has', () => {
    const main = git('rev-parse', 'main');
    const head = commit('feature.txt');
    expect(shipBaseAllowed(repo, 'main', FEATURE, remoteRefs({ 'fork/feature': head, 'upstream/main': main }))).toBe(true);
  });

  // Rule: the remote part is one segment, so `build` never matches origin/feat/<f>/build (pen M2a stays closed).
  it('refuses a base that only matches the tail of a longer remote branch name', () => {
    const inside = commit('one.txt');
    const head = commit('two.txt');
    git('branch', 'build', inside);
    expect(shipBaseAllowed(repo, 'build', FEATURE, remoteRefs({ [`origin/feat/${FEATURE}/build`]: head }))).toBe(false);
  });

  it('does not refuse a branch whose name only contains the slug inside a segment', () => {
    git('branch', `feat/${FEATURE}-old/build`, 'main');
    const main = git('rev-parse', 'main');
    expect(shipBaseAllowed(repo, `feat/${FEATURE}-old/build`, FEATURE, refs({ [`feat/${FEATURE}-old/build`]: main }))).toBe(true);
  });
});

/**
 * D51 (security M2): git's replace refs and grafts can rewrite history for every reader without moving a ref. Every git
 * call ship makes runs with GIT_NO_REPLACE_OBJECTS=1 and GIT_GRAFT_FILE=/dev/null, so a base never pushed stays refused.
 */
describe('shipBaseAllowed ignores replace refs and grafts (D51, security M2)', () => {
  function neverPushedRelease(): ReadonlyMap<string, string> {
    git('update-ref', 'refs/remotes/origin/release', 'main');
    commit('feature.txt');
    git('branch', 'release', 'HEAD');
    return refs({ release: git('rev-parse', 'main') });
  }

  it('a git replace --graft that makes the remote commit a child of the base tip does not pass the base', () => {
    const snap = neverPushedRelease();
    git('replace', '--graft', git('rev-parse', 'main'), git('rev-parse', 'release'));
    expect(shipBaseAllowed(repo, 'release', FEATURE, snap)).toBe(false);
  });

  it('a .git/info/grafts file that does the same does not pass the base', () => {
    const snap = neverPushedRelease();
    fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.git', 'info', 'grafts'), `${git('rev-parse', 'main')} ${git('rev-parse', 'release')}\n`);
    expect(shipBaseAllowed(repo, 'release', FEATURE, snap)).toBe(false);
  });
});

/** Security info 4 (gate round 6): a local base branch that is a symbolic ref is refused (unsafe_base). */
describe('shipBaseAllowed refuses a symref base', () => {
  it('a local branch made a symref to main is refused, though main itself passes', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    git('symbolic-ref', 'refs/heads/alias', 'refs/heads/main');
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main, alias: main }))).toBe(true);
    expect(shipBaseAllowed(repo, 'alias', FEATURE, refs({ main, alias: main }))).toBe(false);
  });
});

/** Security info 2 (gate round 7): a branch ref file that is a filesystem symlink passed the symref refusal. */
describe('shipBaseAllowed refuses a symlinked branch ref', () => {
  it('refs/heads/<base> as a symlink to main\'s ref file is refused, though main itself passes', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    const heads = path.join(repo, '.git', 'refs', 'heads');
    expect(fs.existsSync(path.join(heads, 'main'))).toBe(true);
    fs.symlinkSync(path.join(heads, 'main'), path.join(heads, 'alias'));
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main, alias: main }))).toBe(true);
    expect(shipBaseAllowed(repo, 'alias', FEATURE, refs({ main, alias: main }))).toBe(false);
  });

  it('a base under a symlinked refs/heads folder is refused', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    const heads = path.join(repo, '.git', 'refs', 'heads');
    fs.mkdirSync(path.join(repo, '.git', 'elsewhere'));
    fs.copyFileSync(path.join(heads, 'main'), path.join(repo, '.git', 'elsewhere', 'main'));
    fs.symlinkSync(path.join(repo, '.git', 'elsewhere'), path.join(heads, 'team'));
    expect(shipBaseAllowed(repo, 'team/main', FEATURE, refs({ 'team/main': main }))).toBe(false);
  });
});

/**
 * Security low (gate round 8): a reftable repo keeps no refs/heads folder (`.git/refs/heads` is a file), so the
 * symlink walk hit ENOTDIR and refused every local base. A reftable repo skips the walk; ENOTDIR counts as no file.
 */
describe('shipBaseAllowed on a reftable repo (security low, gate round 8)', () => {
  it('accepts main contained in origin/main', () => {
    fs.rmSync(repo, { recursive: true, force: true });
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-base-rt-')));
    git('init', '-q', '--ref-format=reftable', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    const main = commit('base.txt');
    git('checkout', '-q', '-b', `feat/${FEATURE}/build`);
    commit('feature.txt');
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main }))).toBe(true);
  });
});

/** Security info 4 / code-review info 4 (gate round 8): a symlinked refs, refs/heads or packed-refs is refused. */
describe('shipBaseAllowed refuses a symlinked refs store', () => {
  function moveAndLink(rel: string): void {
    const p = path.join(repo, '.git', rel);
    const real = path.join(repo, '.git', `${rel.replace('/', '-')}-real`);
    fs.renameSync(p, real);
    fs.symlinkSync(real, p);
  }

  it('a symlinked refs/heads folder is refused', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    moveAndLink('refs/heads');
    expect(git('rev-parse', 'main')).toBe(main);
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main }))).toBe(false);
  });

  it('a symlinked refs folder is refused', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    moveAndLink('refs');
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main }))).toBe(false);
  });

  it('a symlinked packed-refs file is refused, though the packed base passes without the link', () => {
    const main = git('rev-parse', 'main');
    commit('feature.txt');
    git('pack-refs', '--all');
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main }))).toBe(true);
    moveAndLink('packed-refs');
    expect(shipBaseAllowed(repo, 'main', FEATURE, refs({ main }))).toBe(false);
  });
});
