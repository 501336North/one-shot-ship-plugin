/**
 * @behavior The gate finds the repository git would use in a folder the way git does (fix round 4,
 *   K2), so a `.git` the agent planted can't move where the gate thinks git lands, and a git folder
 *   the agent wrote can't decide which branch a commit or push is checked against.
 * @business-rule git skips a `.git` folder that is not a valid git folder and keeps looking above
 *   it; a `.git` file must point at a valid git folder. The gate only vouches for a repository
 *   whose settings live in a folder named `.git` (protected from writes): an ordinary repo, a
 *   worktree (`<repo>/.git/worktrees/<name>`) or a submodule (`<repo>/.git/modules/<name>`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepo, repoTrust } from '../../src/tool-gate/repo-finder.js';
import { tick, withDeadline } from '../../src/tool-gate/deadline.js';
import { OverBudget } from '../../src/tool-gate/budget.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-repo-finder-')));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function repo(): string {
  const dir = tempDir();
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'i']);
  return dir;
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A folder that looks like a git folder to git: HEAD, objects/ and refs/. */
function fakeGitDir(dir: string): void {
  write(path.join(dir, 'HEAD'), 'ref: refs/heads/feat\n');
  fs.mkdirSync(path.join(dir, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('findRepo: where git lands', () => {
  it('finds the top of an ordinary repo from a subfolder', () => {
    const top = repo();
    fs.mkdirSync(path.join(top, 'src'));
    expect(findRepo(path.join(top, 'src'))).toMatchObject({ kind: 'repo', top });
  });

  it('skips an empty .git folder, as git does, and lands on the repo above it', () => {
    const top = repo();
    fs.mkdirSync(path.join(top, 'sub', '.git'), { recursive: true });
    expect(findRepo(path.join(top, 'sub'))).toMatchObject({ kind: 'repo', top });
  });

  it('lands on a folder whose .git folder is a valid git folder', () => {
    const top = repo();
    fakeGitDir(path.join(top, 'sub', '.git'));
    expect(findRepo(path.join(top, 'sub'))).toMatchObject({ kind: 'repo', top: path.join(top, 'sub') });
  });

  it('is unsure about a .git file that points at no git folder (git stops there with an error)', () => {
    const top = repo();
    write(path.join(top, 'sub', '.git'), 'gitdir: ../nowhere\n');
    expect(findRepo(path.join(top, 'sub')).kind).toBe('unsure');
  });

  it('is unsure about a folder that is itself a git folder (git reads it as a bare repo)', () => {
    const top = repo();
    fakeGitDir(path.join(top, 'bare'));
    expect(findRepo(path.join(top, 'bare')).kind).toBe('unsure');
  });

  it('finds no repo outside any repo', () => {
    expect(findRepo(tempDir())).toEqual({ kind: 'none' });
  });

  it("stops at the call's deadline with \"took too long\", not \"can't be read\" (fix part K11)", () => {
    // Given: a call whose deadline has passed by the time the walk takes its first step
    const top = repo();
    let looks = 0;
    const clock = (): number => (looks++ === 0 ? 0 : 1_000);

    // Then: the walk's OverBudget reaches the gate, which refuses the call as too complex
    expect(() =>
      withDeadline(10, clock, () => {
        for (let i = 0; i < 1_023; i++) tick();
        return findRepo(top);
      }),
    ).toThrow(OverBudget);
  });
});

describe('repoTrust: whether the gate vouches for the repository git uses in a folder', () => {
  it('vouches for an ordinary repo and its subfolders', () => {
    const top = repo();
    fs.mkdirSync(path.join(top, 'src'));
    expect(repoTrust(path.join(top, 'src'))).toBe('trusted');
  });

  it('vouches for a worktree, whose .git is a file', () => {
    const top = repo();
    const wt = path.join(tempDir(), 'wt');
    git(top, ['worktree', 'add', '-q', '-b', 'feat/wt', wt]);
    expect(repoTrust(wt)).toBe('trusted');
  });

  it('vouches for a worktree made inside the project', () => {
    const top = repo();
    git(top, ['worktree', 'add', '-q', '-b', 'feat/in', path.join(top, '.worktrees', 'in')]);
    expect(repoTrust(path.join(top, '.worktrees', 'in'))).toBe('trusted');
  });

  it('does not vouch for a .git file pointing at a git folder the agent wrote', () => {
    const top = repo();
    fakeGitDir(path.join(top, 'evil'));
    write(path.join(top, 'sub', '.git'), 'gitdir: ../evil\n');
    expect(repoTrust(path.join(top, 'sub'))).toEqual({ untrusted: expect.stringContaining('.git') });
  });

  it('does not vouch for a repo made with --separate-git-dir outside a .git folder', () => {
    const top = repo();
    git(top, ['init', '-q', `--separate-git-dir=${path.join(top, 'evilgit')}`, path.join(top, 'sub')]);
    expect(repoTrust(path.join(top, 'sub'))).not.toBe('trusted');
  });

  it('does not vouch for a .git folder whose settings come from another folder (commondir)', () => {
    const top = repo();
    fakeGitDir(path.join(top, 'evil'));
    fakeGitDir(path.join(top, 'sub', '.git'));
    write(path.join(top, 'sub', '.git', 'commondir'), '../../evil\n');
    expect(repoTrust(path.join(top, 'sub'))).not.toBe('trusted');
  });

  it('answers none outside any repo', () => {
    expect(repoTrust(tempDir())).toBe('none');
  });
});
