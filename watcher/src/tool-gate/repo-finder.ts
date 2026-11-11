/**
 * Finds the repository git would use in a folder, the way git finds it (fix round 4, K2), so the
 * gate can tell where `git rev-parse --show-toplevel` lands and which repository a commit or push
 * uses, without running git. Reads the disk only; never throws (anything unexpected is "unsure").
 *
 * git (setup.c) walks up from the real folder: at each level a `.git` folder that is a valid git
 * folder is the repository (an invalid one is skipped), a `.git` file must point at a valid git
 * folder (else git stops with an error), and a level that is itself a git folder is a bare repo.
 * A git folder is valid when it has `HEAD` (a symlink into `refs/`, `ref: refs/…`, or an object id)
 * and `objects/` and `refs/` folders, in the folder its `commondir` file names when it has one.
 *
 * The gate vouches for a repository (`repoTrust`) only when its settings live in a folder named
 * `.git`, which the protected paths cover (`**\/.git/config`): an ordinary repo, a worktree
 * (`<repo>/.git/worktrees/<name>`, sharing `<repo>/.git`) or a submodule (`<repo>/.git/modules/…`).
 * A `.git` file pointing anywhere else, or a git folder whose `commondir` leads elsewhere, means
 * settings (push targets, upstreams) and a `HEAD` the agent could have written.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readRegularFile } from './regular-file.js';
import { tick } from './deadline.js';
import { OverBudget } from './budget.js';

export type RepoFound =
  | { kind: 'repo'; top: string; gitDir: string; commonDir: string; viaFile: boolean }
  | { kind: 'none' }
  | { kind: 'unsure'; why: string };

/** Largest `.git`, `HEAD` or `commondir` file read (a read limit; real ones are one short line). */
const MAX_POINTER_BYTES = 4096;
/** What a `.git` file holds (git syntax): `gitdir: <path>`. */
const GITDIR_LINE = /^gitdir: (.+?)\r?\n?$/;
/** A valid `HEAD` file (git syntax): a symbolic ref into `refs/`, or an object id (SHA-1 or SHA-256). */
const HEAD_CONTENT = /^(?:ref:\s*refs\/.*|[0-9a-f]{40}|[0-9a-f]{64})\s*$/;
/** The folders a worktree's and a submodule's git folder sit in, inside the main `.git` (git layout). */
const WORKTREES = 'worktrees';
const MODULES = 'modules';
const GIT = '.git';

function isDir(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

function pointer(file: string): string | null {
  const read = readRegularFile(file, MAX_POINTER_BYTES);
  return typeof read === 'object' ? read.text : null;
}

/** The folder a git folder keeps its objects, refs and settings in: its `commondir`, else itself; null when unreadable. */
function commonDirOf(gitDir: string): string | null {
  const file = path.join(gitDir, 'commondir');
  if (fs.lstatSync(file, { throwIfNoEntry: false }) === undefined) return gitDir;
  const text = pointer(file);
  return text === null ? null : path.resolve(gitDir, text.trim());
}

/** Whether git takes `dir` for a git folder (setup.c `is_git_directory`). */
function isGitDir(dir: string): boolean {
  const head = path.join(dir, 'HEAD');
  const stat = fs.lstatSync(head, { throwIfNoEntry: false });
  if (stat === undefined) return false;
  if (stat.isSymbolicLink()) {
    if (!fs.readlinkSync(head).startsWith('refs/')) return false;
  } else {
    const text = pointer(head);
    if (text === null || !HEAD_CONTENT.test(text)) return false;
  }
  const common = commonDirOf(dir);
  return common !== null && isDir(path.join(common, 'objects')) && isDir(path.join(common, 'refs'));
}

function found(top: string, gitDir: string, viaFile: boolean): RepoFound {
  const commonDir = commonDirOf(gitDir);
  if (commonDir === null) return { kind: 'unsure', why: `${path.join(gitDir, 'commondir')} can't be read` };
  return { kind: 'repo', top, gitDir, commonDir, viaFile };
}

function walk(start: string): RepoFound {
  for (let dir = start; ; dir = path.dirname(dir)) {
    tick();
    const dotGit = path.join(dir, GIT);
    const stat = fs.lstatSync(dotGit, { throwIfNoEntry: false });
    if (stat?.isDirectory() === true) {
      if (isGitDir(dotGit)) return found(dir, dotGit, false);
      // git skips a `.git` folder that is not a git folder
    } else if (stat?.isFile() === true) {
      const match = GITDIR_LINE.exec(pointer(dotGit) ?? '');
      const gitDir = match === null ? null : path.resolve(dir, match[1]);
      if (gitDir === null || !isGitDir(gitDir)) return { kind: 'unsure', why: `${dotGit} points at no git folder` };
      return found(dir, gitDir, true);
    } else if (stat !== undefined) {
      return { kind: 'unsure', why: `${dotGit} is neither a folder nor a file` };
    }
    if (isGitDir(dir)) return { kind: 'unsure', why: `${dir} is itself a git folder` };
    if (path.dirname(dir) === dir) return { kind: 'none' };
  }
}

/** The repository git uses in `dir` (an existing folder; its real path is walked, as git does). */
export function findRepo(dir: string): RepoFound {
  try {
    return walk(fs.realpathSync(dir));
  } catch (error) {
    // past the call's deadline the walk stops: refused as too complex, not as unreadable (fix part K11)
    if (error instanceof OverBudget) throw error;
    return { kind: 'unsure', why: `${dir} can't be read` };
  }
}

/** True when `dir` is a folder named `.git` (whose settings the protected paths cover). */
function isDotGit(dir: string): boolean {
  return path.basename(dir) === GIT;
}

/** Whether the git folder a `.git` file points at is a worktree's or a submodule's inside a real `.git` folder. */
function ownGitFolder(gitDir: string, commonDir: string): boolean {
  const parent = path.dirname(gitDir);
  if (path.basename(parent) === WORKTREES) {
    const main = path.dirname(parent);
    return isDotGit(main) && fs.realpathSync(commonDir) === fs.realpathSync(main);
  }
  // a submodule's git folder: <repo>/.git/modules/<name>, with no commondir of its own
  return commonDir === gitDir && gitDir.includes(`${path.sep}${GIT}${path.sep}${MODULES}${path.sep}`);
}

/**
 * Whether the gate vouches for the repository git uses in `dir`: 'trusted', 'none' (no repo, so
 * git fails), or why not. A folder that doesn't exist yet (made earlier in the same call) is
 * judged from the nearest folder above it that does.
 */
export function repoTrust(dir: string): 'trusted' | 'none' | { untrusted: string } {
  let at = dir;
  while (!isDir(at) && path.dirname(at) !== at) {
    tick();
    at = path.dirname(at);
  }
  const repo = findRepo(at);
  if (repo.kind === 'none') return 'none';
  if (repo.kind === 'unsure') return { untrusted: repo.why };
  try {
    if (!repo.viaFile) {
      return repo.commonDir === repo.gitDir ? 'trusted' : { untrusted: `${path.join(repo.gitDir, 'commondir')} sends git to another .git folder's settings` };
    }
    const gitDir = fs.realpathSync(repo.gitDir);
    if (ownGitFolder(gitDir, repo.commonDir === repo.gitDir ? gitDir : repo.commonDir)) return 'trusted';
  } catch {
    // a path that can't be resolved is not vouched for
  }
  return { untrusted: `${path.join(repo.top, GIT)} points at a git folder outside a .git folder` };
}
