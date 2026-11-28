/**
 * @behavior `phase-result archived` (the lookup oss-timeline.sh files gate lines with) prints only the one completed
 *           folder this branch added for the feature its name names, and exits 0; with no such folder, two of them, or
 *           only another feature's folder it prints nothing and exits 1. An archive that is already on the remote's
 *           main (merged by an earlier PR) never counts as this branch's, whatever base the repo config names.
 * @business-rule complete-gaps D7 (the `archived` verb), D10 (ii) (a model-chosen `oss.shipBase` cannot reach an old,
 *           merged archive: the folder, in any letter case, must be absent at the fork point: the merge base of HEAD with
 *           origin's main (or a symbolic remote HEAD; local main or master with no remote), with the base, with each
 *           `<remote>/<base>`, and the merge base the added paths were measured from),
 *           D10 (v) (a direct unit test of the verb).
 * @boundary main() of watcher/src/cli/phase-result.ts, called in process from the repo as its cwd; git is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { archivedFeature, archiveIsNew } from '../../src/phase-results/feature.js';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

let repo: string;
let savedCwd: string;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}
function archive(folder: string): void {
  const dir = path.join(repo, '.oss', 'dev', 'completed', folder, 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ship.json'), `{"folder":"${folder}"}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', `docs: archive ${folder}`);
}

/** Runs `phase-result archived` from the repo; returns its exit code and what it printed. */
async function archived(): Promise<{ rc: number; out: string }> {
  const quiet = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const mod = await import('../../src/cli/phase-result.js');
  process.exitCode = undefined;
  const out: string[] = [];
  const o = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  process.chdir(repo);
  const rc = mod.main(['archived']);
  o.mockRestore();
  quiet.mockRestore();
  return { rc, out: out.join('') };
}

/** pen-t5: feature `mine` was archived and merged by an earlier PR; a new branch for it starts from that main. */
function oldArchiveMerged(): void {
  git('checkout', '-q', '-b', 'feat/mine/build');
  git('branch', 'oldbase');
  archive('mine-2026-01-01');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/mine/build');
  git('checkout', '-q', '-b', 'feat/mine/again');
  git('config', '--local', 'oss.shipBase', 'oldbase');
}

beforeEach(() => {
  savedCwd = process.cwd();
  repo = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archived-verb-'))), 'repo');
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
});
afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

describe('phase-result archived (D7, D10 v)', () => {
  it('prints only the folder name and exits 0 when this branch added one folder of its feature', async () => {
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-23');
    expect(await archived()).toEqual({ rc: 0, out: 'mine-2026-11-23\n' });
  });

  it('exits 1 and prints nothing when the branch added no completed folder', async () => {
    git('checkout', '-q', '-b', 'feat/mine/build');
    expect(await archived()).toEqual({ rc: 1, out: '' });
  });

  it('exits 1 and prints nothing when the branch added two folders of its feature', async () => {
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-23');
    archive('mine-2026-11-24');
    expect(await archived()).toEqual({ rc: 1, out: '' });
  });

  it('exits 1 and prints nothing when the only folder is another feature\'s', async () => {
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('other-2026-11-23');
    expect(await archived()).toEqual({ rc: 1, out: '' });
  });
});

describe('an archive already on the remote\'s main is never this branch\'s (D10 ii, pen P5)', () => {
  it('refuses the old merged archive that oss.shipBase points back to (origin/main has it)', async () => {
    oldArchiveMerged();
    git('update-ref', 'refs/remotes/origin/main', 'main');
    expect(await archived()).toEqual({ rc: 1, out: '' });
    expect(archivedFeature(repo, 'oldbase', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('uses the remote HEAD when there is no origin/main (default branch trunk)', () => {
    oldArchiveMerged();
    git('update-ref', '-d', 'refs/remotes/origin/main');
    git('update-ref', 'refs/remotes/origin/trunk', 'main');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    expect(archivedFeature(repo, 'oldbase', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('still finds this branch\'s own archive that origin/main does not have yet', () => {
    oldArchiveMerged();
    git('update-ref', 'refs/remotes/origin/main', 'main');
    archive('mine-2026-11-27');
    expect(archivedFeature(repo, 'main', new Map())).toEqual({ ok: true, feature: 'mine', folder: 'mine-2026-11-27' });
  });
});

/** Writes a commit object with `text` and returns its id (git hash-object -w). */
function writeCommit(text: string): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: repo, env, input: text, encoding: 'utf-8' }).trim();
}

describe('the archive must be new at the fork point, and the check fails closed (complete-gaps round 2, D10 ii)', () => {
  it('R2-1: refuses an old merged archive when the branch commits one new file into it (pen A4)', async () => {
    oldArchiveMerged();
    git('config', '--local', '--unset', 'oss.shipBase');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    fs.writeFileSync(path.join(repo, '.oss', 'dev', 'completed', 'mine-2026-01-01', 'note.md'), 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'note');
    expect(await archived()).toEqual({ rc: 1, out: '' });
    expect(archivedFeature(repo, 'main', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R2-2: refuses when a remote is configured but origin/main and origin/HEAD are gone (pen A3)', () => {
    oldArchiveMerged();
    git('remote', 'add', 'origin', path.join(path.dirname(repo), 'nowhere.git'));
    git('update-ref', '-d', 'refs/remotes/origin/main');
    expect(archivedFeature(repo, 'oldbase', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R2-2: refuses when the only remote has another name (no origin refs)', () => {
    oldArchiveMerged();
    git('remote', 'add', 'upstream', path.join(path.dirname(repo), 'nowhere.git'));
    git('update-ref', '-d', 'refs/remotes/origin/main');
    git('update-ref', 'refs/remotes/upstream/main', 'main');
    expect(archivedFeature(repo, 'oldbase', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R2-2: refuses this branch\'s own new archive when git cannot walk origin/main\'s history (a git error fails closed)', () => {
    git('branch', 'fork');
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-27');
    const main = git('cat-file', 'commit', 'main');
    const broken = writeCommit(main.replace(/^tree .*$/m, (l) => `${l}\nparent ${'1'.repeat(40)}`).replace(/\n\n.*$/s, '\n\nbroken\n'));
    git('update-ref', 'refs/remotes/origin/main', broken);
    expect(archivedFeature(repo, 'fork', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R2-2: with no remote at all, keeps a new archive and refuses one that exists at the merge base with the lookup base', () => {
    git('update-ref', '-d', 'refs/remotes/origin/main');
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-27');
    expect(archivedFeature(repo, 'main', new Map())).toEqual({ ok: true, feature: 'mine', folder: 'mine-2026-11-27' });
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/mine/build');
    git('checkout', '-q', '-b', 'feat/mine/again');
    fs.writeFileSync(path.join(repo, '.oss', 'dev', 'completed', 'mine-2026-11-27', 'note.md'), 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'note');
    expect(archivedFeature(repo, 'main', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R2-3: a deadline already spent before the check is a timeout, not a pass', () => {
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-27');
    expect(archiveIsNew(repo, 'mine-2026-11-27', 'main', Date.now() - 1)).toBe('timeout');
    expect(archiveIsNew(repo, 'mine-2026-11-27', 'main', Date.now() + 30_000)).toBe('yes');
  });

  it('R2-4: the check never runs a gpg program from repo config (log.showSignature + gpg.program)', () => {
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-27');
    const signed = git('cat-file', 'commit', 'HEAD').replace(/^(committer .*)$/m,
      '$1\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEz\n -----END PGP SIGNATURE-----');
    git('update-ref', 'HEAD', writeCommit(`${signed}\n`));
    const marker = path.join(path.dirname(repo), 'gpg-ran');
    const prog = path.join(path.dirname(repo), 'fake-gpg.sh');
    fs.writeFileSync(prog, `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`, { mode: 0o755 });
    git('config', '--local', 'gpg.program', prog);
    git('config', '--local', 'log.showSignature', 'true');
    expect(archivedFeature(repo, 'main', new Map())).toEqual({ ok: true, feature: 'mine', folder: 'mine-2026-11-27' });
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe('the old merged archive stays refused however the refs are bent (complete-gaps round 4)', () => {
  it('R4-1: refuses a case-different copy of an old merged archive folder (case-insensitive disk)', () => {
    oldArchiveMerged();
    git('config', '--local', '--unset', 'oss.shipBase');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('checkout', '-q', '-b', 'feat/MINE/case');
    git('config', '--local', 'core.ignorecase', 'false');
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: 'x\n', encoding: 'utf-8' }).trim();
    git('update-index', '--add', '--cacheinfo', `100644,${blob},.oss/dev/completed/MINE-2026-01-01/note.md`);
    git('commit', '-q', '-m', 'case copy');
    expect(archivedFeature(repo, 'main', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R4-2: refuses an old archive merged into origin/<base> when the local base is stale', () => {
    git('checkout', '-q', '-b', 'develop');
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-01-01');
    git('checkout', '-q', '-b', 'merged', 'develop');
    git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/mine/build');
    git('update-ref', 'refs/remotes/origin/develop', 'merged');
    git('checkout', '-q', '-b', 'feat/mine/again', 'origin/develop');
    git('branch', '-q', '-D', 'merged');
    fs.writeFileSync(path.join(repo, '.oss', 'dev', 'completed', 'mine-2026-01-01', 'note.md'), 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'note');
    expect(archivedFeature(repo, 'develop', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R4-2: still finds this branch\'s own new archive on a non-main base with a newer origin/<base>', () => {
    git('checkout', '-q', '-b', 'develop');
    git('checkout', '-q', '-b', 'other');
    fs.writeFileSync(path.join(repo, 'other.txt'), 'o\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'other');
    git('update-ref', 'refs/remotes/origin/develop', 'other');
    git('checkout', '-q', '-b', 'feat/mine/build', 'origin/develop');
    archive('mine-2026-11-27');
    expect(archivedFeature(repo, 'develop', new Map())).toEqual({ ok: true, feature: 'mine', folder: 'mine-2026-11-27' });
  });

  it('R4-3: with the remote removed, an old shipBase cannot reach the archive merged into local main', () => {
    oldArchiveMerged();
    git('update-ref', '-d', 'refs/remotes/origin/main');
    expect(git('remote')).toBe('');
    expect(archivedFeature(repo, 'oldbase', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R4-3: with no remote and neither main nor master, the check refuses', () => {
    git('update-ref', '-d', 'refs/remotes/origin/main');
    git('branch', '-q', '-m', 'main', 'trunk');
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-27');
    expect(archiveIsNew(repo, 'mine-2026-11-27', 'trunk')).toBe('no');
  });

  it('R4-4: refuses when origin/HEAD is a direct ref to an old commit and origin/main is gone', () => {
    oldArchiveMerged();
    git('remote', 'add', 'origin', path.join(path.dirname(repo), 'nowhere.git'));
    git('update-ref', '-d', 'refs/remotes/origin/main');
    git('update-ref', '--no-deref', 'refs/remotes/origin/HEAD', 'oldbase');
    expect(archivedFeature(repo, 'oldbase', new Map())).toEqual({ ok: false, reason: 'none' });
  });

  it('R4-5: a partial clone never lazily fetches a missing object from its promisor remote', () => {
    git('checkout', '-q', '-b', 'feat/mine/build');
    archive('mine-2026-11-27');
    const marker = path.join(path.dirname(repo), 'fetched');
    const ssh = path.join(path.dirname(repo), 'fake-ssh.sh');
    fs.writeFileSync(ssh, `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`, { mode: 0o755 });
    git('remote', 'add', 'origin', 'ssh://example.invalid/x.git');
    git('config', '--local', 'core.sshCommand', ssh);
    git('config', '--local', 'core.repositoryformatversion', '1');
    git('config', '--local', 'extensions.partialClone', 'origin');
    git('config', '--local', 'remote.origin.promisor', 'true');
    const tree = git('rev-parse', 'main^{tree}');
    fs.rmSync(path.join(repo, '.git', 'objects', tree.slice(0, 2), tree.slice(2)));
    archiveIsNew(repo, 'mine-2026-11-27', 'main');
    expect(fs.existsSync(marker)).toBe(false);
  });
});
