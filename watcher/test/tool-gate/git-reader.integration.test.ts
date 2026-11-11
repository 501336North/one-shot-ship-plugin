/**
 * @behavior The tool gate asks git which branch a directory is on, so it can refuse commits
 *   and pushes on a protected branch.
 * @business-rule A detached HEAD and a folder that is not a git repo have no branch, so the
 *   protected-branch rule treats them as "not on a protected branch".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitReaderFor, realGitReader } from '../../src/tool-gate/git-reader.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-git-reader-')));
  dirs.push(dir);
  return dir;
}

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** A throwaway git repo on `main` with one empty commit. */
function repoOnMain(): string {
  const repo = tempDir();
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Git Reader Test']);
  git(repo, ['config', 'user.email', 'git-reader-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  return repo;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('realGitReader: which branch a folder is on', () => {
  it('should return main for a repo on main', async () => {
    expect(await realGitReader.currentBranch(repoOnMain())).toBe('main');
  });

  it('should return the feature branch name for a repo on a feature branch', async () => {
    const repo = repoOnMain();
    git(repo, ['checkout', '-q', '-b', 'feat/x/build']);
    expect(await realGitReader.currentBranch(repo)).toBe('feat/x/build');
  });

  it('should return the branch for a subfolder of a repo', async () => {
    const repo = repoOnMain();
    fs.mkdirSync(path.join(repo, 'sub'));
    expect(await realGitReader.currentBranch(path.join(repo, 'sub'))).toBe('main');
  });

  it('should return the branch for a folder not made yet (an earlier part of the call makes it), from the nearest folder above it (fix round 4, K2)', async () => {
    const repo = repoOnMain();
    expect(await realGitReader.currentBranch(path.join(repo, 'new', 'deeper'))).toBe('main');
  });

  it('should return no branch for a detached HEAD', async () => {
    const repo = repoOnMain();
    git(repo, ['checkout', '-q', '--detach']);
    expect(await realGitReader.currentBranch(repo)).toBeNull();
  });

  it('should return no branch for a folder that is not a git repo', async () => {
    expect(await realGitReader.currentBranch(tempDir())).toBeNull();
  });

  it('should return no branch for a folder that does not exist', async () => {
    expect(await realGitReader.currentBranch(path.join(tempDir(), 'missing'))).toBeNull();
  });
});

describe('realGitReader: what a git clean would remove', () => {
  it('should list the untracked files and folders a clean with the same options would remove', async () => {
    const repo = repoOnMain();
    fs.mkdirSync(path.join(repo, '.oss', 'tool-gates'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.oss', 'tool-gates', 'cycle.json'), '{}');
    fs.writeFileSync(path.join(repo, 'notes.tmp'), 'x');
    expect(await realGitReader.wouldClean(repo, ['-d', '-x'], [])).toEqual(['.oss/', 'notes.tmp']);
  });

  it('should leave out ignored files unless -x or -X asks for them', async () => {
    const repo = repoOnMain();
    fs.writeFileSync(path.join(repo, '.gitignore'), '.oss/\n');
    git(repo, ['add', '.gitignore']);
    git(repo, ['commit', '-q', '-m', 'ignore']);
    fs.mkdirSync(path.join(repo, '.oss', 'tool-gates'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.oss', 'tool-gates', 'cycle.json'), '{}');
    expect(await realGitReader.wouldClean(repo, ['-d'], [])).toEqual([]);
    expect(await realGitReader.wouldClean(repo, ['-d', '-X'], [])).toEqual(['.oss/']);
  });

  it('should only look under the pathspecs, from the folder it runs in', async () => {
    const repo = repoOnMain();
    fs.mkdirSync(path.join(repo, 'build'));
    fs.writeFileSync(path.join(repo, 'build', 'keep.txt'), 'x');
    git(repo, ['add', 'build/keep.txt']);
    git(repo, ['commit', '-q', '-m', 'build']);
    fs.writeFileSync(path.join(repo, 'build', 'out.js'), 'x');
    fs.writeFileSync(path.join(repo, 'top.tmp'), 'x');
    expect(await realGitReader.wouldClean(repo, [], ['build'])).toEqual(['build/out.js']);
    expect(await realGitReader.wouldClean(path.join(repo, 'build'), [], [])).toEqual(['out.js']);
  });

  it('should never delete anything, even when the options ask to', async () => {
    const repo = repoOnMain();
    fs.writeFileSync(path.join(repo, 'keep.tmp'), 'x');
    await realGitReader.wouldClean(repo, ['--no-dry-run', '-f', '-f'], []);
    expect(fs.existsSync(path.join(repo, 'keep.tmp'))).toBe(true);
  });

  it('should give no answer for a name git prints in quotes, or outside a repo', async () => {
    const repo = repoOnMain();
    fs.writeFileSync(path.join(repo, 'odd"name'), 'x');
    expect(await realGitReader.wouldClean(repo, [], [])).toBeNull();
    expect(await realGitReader.wouldClean(tempDir(), [], [])).toBeNull();
  });
});

/** A shell script at `file`, made runnable. */
function script(file: string, body: string): string {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

/** Whether a process is gone (or only a zombie waiting to be reaped). */
function gone(pid: number): boolean {
  try {
    const stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return stat === '' || stat.startsWith('Z');
  } catch {
    return true;
  }
}

async function waitUntil(check: () => boolean, ms = 2000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

describe('realGitReader: never fails the gate, never runs repo programs, leaves nothing running (fix round 4, K1)', () => {
  it('should give no answer, not throw, when a word git is given holds a NUL byte', async () => {
    const repo = repoOnMain();
    await expect(realGitReader.wouldClean(repo, ['-e', 'a\u0000b'], [])).resolves.toBeNull();
    await expect(realGitReader.wouldClean(repo, [], ['a\u0000b'])).resolves.toBeNull();
    // a folder that can't exist is read from the nearest real folder above it (fix round 4, K2)
    await expect(realGitReader.currentBranch(`${repo}/a\u0000b`)).resolves.toBe('main');
  });

  it("should not run a repo's core.fsmonitor program while reading the branch or a dry run", async () => {
    const repo = repoOnMain();
    const marker = path.join(tempDir(), 'ran');
    const monitor = script(path.join(tempDir(), 'monitor.sh'), `echo ran >> '${marker}'`);
    git(repo, ['config', 'core.fsmonitor', monitor]);
    fs.writeFileSync(path.join(repo, 'notes.tmp'), 'x');

    expect(await realGitReader.wouldClean(repo, [], [])).toEqual(['notes.tmp']);
    expect(await realGitReader.currentBranch(repo)).toBe('main');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("should ignore the session's GIT_* variables, which could point git at another repo or add settings", async () => {
    const repo = repoOnMain();
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(tempDir(), 'not-a-repo');
    try {
      expect(await realGitReader.currentBranch(repo)).toBe('main');
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });

  it('should end git and every program it started when git runs past its time limit', async () => {
    const dir = tempDir();
    const pidFile = path.join(dir, 'child.pid');
    // A fake git that starts a child, records the child's pid (written whole, via a rename), then
    // waits 30 s for it. Run with `warm` it just exits.
    const slowGit = script(
      path.join(dir, 'git'),
      `[ "$1" = warm ] && exit 0\nsleep 30 & echo $! > '${pidFile}.tmp' && mv '${pidFile}.tmp' '${pidFile}'; wait`,
    );
    // macOS checks a newly written program the first time it runs, which can take 0.5-1 s and would
    // eat the whole time limit before the fake git starts its child. Run it once, untimed, first.
    execFileSync(slowGit, ['warm']);
    const reader = gitReaderFor(dir, slowGit);

    const started = performance.now();
    expect(await reader.currentBranch(dir, 1000)).toBeNull();
    // well short of the 30 s the fake git would run on its own
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(fs.existsSync(pidFile), 'the fake git started its child before the time limit').toBe(true);
    const child = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(child).toBeGreaterThan(0);
    expect(await waitUntil(() => gone(child), 5000)).toBe(true);
  }, 30_000);

  it('should give no answer when a dry run would list more than 2048 paths, so the gate falls back', async () => {
    const repo = repoOnMain();
    // a tracked file keeps git from listing the folder as one path
    fs.mkdirSync(path.join(repo, 'big'));
    fs.writeFileSync(path.join(repo, 'big', 'keep'), '');
    git(repo, ['add', 'big/keep']);
    git(repo, ['commit', '-q', '-m', 'keep']);
    for (let n = 0; n < 2100; n++) fs.writeFileSync(path.join(repo, 'big', `f${n}`), '');
    expect(await realGitReader.wouldClean(repo, [], [])).toBeNull();
  });

  it("should not ask git in a folder whose .git is a file planted below the project root (its settings are the agent's)", async () => {
    const repo = repoOnMain();
    const sub = path.join(repo, 'sub');
    git(repo, ['init', '-q', `--separate-git-dir=${path.join(repo, 'evilgit')}`, sub]);
    fs.writeFileSync(path.join(sub, 'notes.tmp'), 'x');

    expect(await gitReaderFor(repo).wouldClean(sub, [], [])).toBeNull();
  });

  it("should still ask git at the project root when the root's own .git is a file (a worktree)", async () => {
    const repo = repoOnMain();
    const worktree = path.join(tempDir(), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'feat/wt', worktree]);
    fs.writeFileSync(path.join(worktree, 'notes.tmp'), 'x');

    expect(await gitReaderFor(worktree).wouldClean(worktree, [], [])).toEqual(['notes.tmp']);
  });
});
