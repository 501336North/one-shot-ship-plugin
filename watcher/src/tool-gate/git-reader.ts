/**
 * Git reader for the tool gate: which branch a directory is on, and what a `git clean` would
 * remove. A collaborator, mocked in the rule tests. Runs git without a shell and with a short
 * timeout, and never throws: anything that goes wrong is "git can't tell" (null).
 *
 * The folder git runs in is the agent's choice, so git runs hardened: settings that run a program
 * during these reads are turned off on the command line (which beats any repo setting), the
 * session's `GIT_*` variables are dropped, and git runs in its own process group, ended whole at
 * the time limit so nothing it started keeps running. The CLI decides in a worker thread, which
 * can be ended at any moment: there, git is not started by the worker but asked of the main thread
 * (`setGitRunner`), which starts it, knows its process group the moment it starts, and ends every
 * group still running when it ends the decision (fix round 4, K2).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface GitReader {
  /** The short branch name, or null for a detached HEAD, a non-repo, or any error. */
  currentBranch(dir: string, timeoutMs?: number): Promise<string | null>;
  /**
   * The paths a `git clean` with these options and pathspecs would remove, as git prints them
   * (relative to `dir`; a folder ends with `/`), from a dry run. Null when git can't tell (an
   * error, a non-repo, a name git prints in quotes, too many paths to check).
   */
  wouldClean(dir: string, options: string[], pathspecs: string[], timeoutMs?: number): Promise<string[] | null>;
}

const TIMEOUT_MS = 1500;
/** What `git clean --dry-run` prints before each path it would remove (git's own wording, kept by `LC_ALL=C`). */
const WOULD_REMOVE = 'Would remove ';
/** Most paths a dry run may list before the gate stops checking them one by one (a work limit). */
const MAX_DRY_RUN_LINES = 2048;
/** Most output read from git (a read limit). */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * git settings that run a program during `symbolic-ref` or `clean --dry-run` (git syntax): the
 * file-system monitor hook. The untracked cache is off too so the dry run writes nothing back.
 * Hooks, `core.sshCommand`, pagers and editors are not used by these read commands.
 */
const HARDENING = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];

/** Told, as it happens, when a git process group starts and when it is gone. */
export interface GitTracker {
  started(pid: number): void;
  ended(pid: number): void;
}

/** Runs git and gives its stdout, or null (see runGit). */
export type GitRunner = (gitBin: string, args: string[], cwd: string, timeoutMs: number, maxLines: number) => Promise<string | null>;

const runHere: GitRunner = (gitBin, args, cwd, timeoutMs, maxLines) => runGit(gitBin, args, cwd, timeoutMs, maxLines);
let runner: GitRunner = runHere;

/** Sets how git is run (the worker asks the main thread); null puts back running it here. */
export function setGitRunner(next: GitRunner | null): void {
  runner = next ?? runHere;
}

/** Ends a process group (git and everything it started); quiet when it is already gone. */
export function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/** The session's environment without `GIT_*` (which could pick another repo or add settings), in the C locale. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith('GIT_')) env[name] = value;
  return { ...env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' };
}

/** git's stdout, or null on any error, a non-zero exit, the time limit, or more than `maxLines` lines. */
export function runGit(
  gitBin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxLines = Infinity,
  tracker: GitTracker | null = null,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(gitBin, [...HARDENING, ...args], { cwd, env: gitEnv(), detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const pid = child.pid;
    if (pid !== undefined) tracker?.started(pid);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let lines = 0;
    let done = false;
    const finish = (out: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pid !== undefined) {
        killGroup(pid);
        tracker?.ended(pid);
      }
      resolve(out);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      bytes += chunk.length;
      for (const byte of chunk) if (byte === 0x0a) lines++;
      if (bytes > MAX_OUTPUT_BYTES || lines > maxLines) finish(null);
    });
    child.once('error', () => finish(null));
    child.once('close', (code) => finish(code === 0 ? Buffer.concat(chunks).toString('utf8') : null));
  });
}

/**
 * Whether the repo `dir` belongs to is found through a `.git` FILE below the project root: its
 * git folder (and settings) can be anywhere the agent wrote, so the gate doesn't run git there.
 * The project root's own `.git` file (a worktree) is the user's.
 */
function redirectedRepo(dir: string, projectRoot: string | null): boolean {
  for (let at = dir; ; at = path.dirname(at)) {
    const stat = fs.lstatSync(path.join(at, '.git'), { throwIfNoEntry: false });
    if (stat !== undefined) return !stat.isDirectory() && at !== projectRoot;
    if (path.dirname(at) === at) return false;
  }
}

/**
 * `dir`, or the nearest folder above it that exists: a folder an earlier part of the same call makes
 * (`mkdir x && cd x && git commit`) is in the repo of the folder above it, which git will find there.
 */
function nearestFolder(dir: string): string {
  const isFolder = (p: string): boolean => {
    try {
      return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
    } catch {
      return false;
    }
  };
  let at = dir;
  while (!isFolder(at) && path.dirname(at) !== at) at = path.dirname(at);
  return at;
}

/** A git reader for a project (`null`: no project root, so every `.git` file counts as planted). */
export function gitReaderFor(projectRoot: string | null, gitBin = 'git'): GitReader {
  return {
    async currentBranch(dir, timeoutMs = TIMEOUT_MS) {
      const out = await runner(gitBin, ['symbolic-ref', '--short', '-q', 'HEAD'], nearestFolder(dir), timeoutMs, Infinity);
      const branch = out?.trim() ?? '';
      return branch === '' ? null : branch;
    },
    async wouldClean(dir, options, pathspecs, timeoutMs = TIMEOUT_MS) {
      try {
        if (redirectedRepo(dir, projectRoot)) return null;
      } catch {
        return null;
      }
      // `--dry-run` after the options, so no option (`--no-dry-run`) can turn it off.
      const args = ['-c', 'core.quotePath=false', 'clean', ...options, '--dry-run', '--', ...pathspecs];
      const out = await runner(gitBin, args, dir, timeoutMs, MAX_DRY_RUN_LINES);
      if (out === null) return null;
      const removed = out.split('\n').filter((line) => line.startsWith(WOULD_REMOVE)).map((line) => line.slice(WOULD_REMOVE.length));
      // a name with a quote, backslash or control character is printed quoted and escaped
      return removed.some((p) => p.startsWith('"')) ? null : removed;
    },
  };
}

/** A reader with no project root. */
export const realGitReader: GitReader = gitReaderFor(null);
