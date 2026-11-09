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
import { realGitReader } from '../../src/tool-gate/git-reader.js';

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
