/**
 * The other git repos and worktrees inside a readable repo root (R-266 round 11, SEC LOW-1): a root
 * that holds them (a dotfiles-style repo over a projects folder) must not make them readable, so both
 * review layers deny them (review-places.ts). Found as git sees them, with cheap calls only (round 12,
 * D-R12-2 "Skip ignored folders", PERF MEDIUM-1):
 * - nested repos in tracked and untracked-but-not-ignored places: `git ls-files --others
 *   --exclude-standard` prints a folder git stopped at because it is another repo with a trailing `/`.
 *   Ignored folders are never walked (no `--directory`: it would fold an untracked folder holding a
 *   repo into one entry). A clone inside an ignored folder stays readable: an accepted limit.
 * - submodules: the gitlinks (mode 160000) in the index.
 * - worktrees: each `<common dir>/worktrees/<name>/gitdir` names a worktree's `.git` file.
 * The two git calls run side by side, each on the decision's time left (round 14, D-R14-2), with
 * their temp folders under one per-user parent that a scan clears of stale ones (CR INFO-2). Round 15
 * (PERF INFO-1): in the CLI each git is started by the main thread in its own process group, which it
 * ends when the decision ends or the CLI is sent TERM; the output file is unlinked once open.
 * Nothing is cached (round 13, D-R13-1): git is asked on every call, so a repo cloned after a first
 * check is found on the next one, and no answer on disk can be forged. Accepted limit: a repo with tens
 * of thousands of untracked, not-ignored files may see a review call refused as timed out.
 * Both lists are read as a stream (round 13, CR I-a), keeping only the entries that name another repo,
 * so a large index never fails closed. Repos the session named as reviewed are not hidden.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitBinary } from '../gate-run/git-bin.js';
import { timeLeft } from './deadline.js';
import { killGroup, type GitTracker } from './git-reader.js';

/** Folders not walked for nested repos (build output and installed packages: large, never a project). */
const NOT_WALKED = ['node_modules', 'target', '.venv', 'venv', '__pycache__', '.gradle', 'Pods', 'DerivedData', '.build', '.tox'];
/** Bytes read from git's output at a time: what is held in memory however long the output is. */
const CHUNK_BYTES = 1024 * 1024;
const GITLINK = Buffer.from('160000 ');
const SLASH = '/'.charCodeAt(0);
/**
 * The most a git call may take (round 14, D-R14-2): the decision's time left (both calls run side by
 * side, so each may use all of it), and this bound outside a decision.
 */
const GIT_CAP_MS = 1000;
/** A scan's temp folder older than this was left by a killed call (round 14, CR INFO-2). */
const STALE_MS = 10 * 60 * 1000;
const TEMP_PREFIX = 'oss-nested-';

/** One git run's result: its exit status, what it printed (only the kept entries, NUL-ended), and whether it ran out of time. */
export interface GitResult {
  status: number | null;
  stdout: string;
  timedOut: boolean;
}

/**
 * One git run (round 14: may answer later, so two run side by side): `keep` sees each NUL-ended
 * entry's raw bytes, and only the kept ones are decoded (PERF INFO-D); `limitMs` is its time limit.
 */
export type GitRun = (args: readonly string[], cwd: string, keep: (entry: Buffer) => boolean, limitMs: number) => GitResult | Promise<GitResult>;

/** What git says: the nested repos, or that it ran out of time, or that it can't tell (the caller fails closed). */
export type NestedRepos = { kind: 'found'; repos: string[] } | { kind: 'timeout' } | { kind: 'unknown' };

export interface NestedOptions {
  /** Runs git; the real git when absent. */
  run?: GitRun;
  /** The folder the per-user temp parent is made in; os.tmpdir() when absent (tests give their own). */
  tempRoot?: string;
  /** The git program; the checked one (gitBinary) when absent (tests give a fake). */
  gitBin?: string;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith('GIT_')) env[name] = value;
  return { ...env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' };
}

/** The NUL-ended entries in the open file `fd` that `keep` accepts, read a chunk at a time. */
function keptEntries(fd: number, keep: (entry: Buffer) => boolean): string[] {
  const kept: string[] = [];
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let rest = Buffer.alloc(0);
  // from the start: git's writes left the shared file offset at the end
  let at = 0;
  for (let read = fs.readSync(fd, buffer, 0, CHUNK_BYTES, at); read > 0; read = fs.readSync(fd, buffer, 0, CHUNK_BYTES, at)) {
    at += read;
    let data = Buffer.concat([rest, buffer.subarray(0, read)]);
    for (let end = data.indexOf(0); end !== -1; end = data.indexOf(0)) {
      const entry = data.subarray(0, end);
      if (keep(entry)) kept.push(entry.toString('utf8'));
      data = data.subarray(end + 1);
    }
    rest = Buffer.from(data);
  }
  return kept;
}

/**
 * The per-user parent of the scans' temp folders (round 14, CR INFO-2), made 0700; its folders older
 * than STALE_MS (left by a killed call) are removed. The temp root itself when the parent is not ours.
 */
function tempParent(tempRoot: string): string {
  const parent = path.join(tempRoot, `${TEMP_PREFIX}${process.getuid?.() ?? 'user'}`);
  try {
    fs.mkdirSync(parent, { mode: 0o700 });
  } catch {
    // already there: checked below
  }
  const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) return tempRoot;
  for (const name of fs.readdirSync(parent)) {
    const dir = path.join(parent, name);
    const age = Date.now() - (fs.lstatSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (name.startsWith(TEMP_PREFIX) && age > STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
  }
  return parent;
}

/** How a git run with its output to an open file ended. */
export interface FileRunResult {
  status: number | null;
  timedOut: boolean;
  failed: boolean;
}

/**
 * Runs git with its output to the open file `fd`, in its own process group (round 15, PERF INFO-1),
 * ended whole past `limitMs` and once it is done, so nothing it started keeps running; `tracker` is
 * told the group the moment it starts.
 */
export function runGitToFile(gitBin: string, args: readonly string[], cwd: string, fd: number, limitMs: number, tracker: GitTracker | null = null): Promise<FileRunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(gitBin, ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], { cwd, env: gitEnv(), detached: true, stdio: ['ignore', fd, 'ignore'] });
    } catch {
      resolve({ status: null, timedOut: false, failed: true });
      return;
    }
    const pid = child.pid;
    if (pid !== undefined) tracker?.started(pid);
    let done = false;
    const finish = (result: FileRunResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pid !== undefined) {
        killGroup(pid);
        tracker?.ended(pid);
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: null, timedOut: true, failed: false }), limitMs);
    child.once('error', () => finish({ status: null, timedOut: false, failed: true }));
    child.once('close', (status) => finish({ status, timedOut: false, failed: false }));
  });
}

/** How a scan's git is started: here, or (in the CLI's worker) by asking the main thread. */
type FileRunner = (gitBin: string, args: readonly string[], cwd: string, fd: number, limitMs: number) => Promise<FileRunResult>;
let fileRunner: FileRunner = (gitBin, args, cwd, fd, limitMs) => runGitToFile(gitBin, args, cwd, fd, limitMs);

/** The worker side of a thread's message port. */
interface Port {
  postMessage(value: unknown): void;
  on(event: 'message', listener: (value: unknown) => void): unknown;
}

/** What the worker asks the main thread to run: `fd` is the worker's open output file (threads share one file table). */
interface NestedGitAsk {
  id: number;
  gitBin: string;
  args: string[];
  cwd: string;
  fd: number;
  limitMs: number;
}

const isRecordValue = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function nestedAskOf(message: unknown): NestedGitAsk | null {
  const ask = isRecordValue(message) ? message.nestedGit : undefined;
  if (!isRecordValue(ask)) return null;
  const ok =
    typeof ask.id === 'number' &&
    typeof ask.gitBin === 'string' &&
    Array.isArray(ask.args) &&
    ask.args.every((a) => typeof a === 'string') &&
    typeof ask.cwd === 'string' &&
    Number.isInteger(ask.fd) &&
    typeof ask.limitMs === 'number';
  return ok ? (ask as unknown as NestedGitAsk) : null;
}

/**
 * In a worker (round 15, PERF INFO-1): the scan's gits are started by the main thread through `port`,
 * which puts each in its own process group and ends every group still running when it ends the
 * decision or is itself ended (TERM), so a git never outlives the CLI.
 */
export function nestedGitViaPort(port: Port): void {
  const waiting = new Map<number, (result: FileRunResult) => void>();
  let nextId = 0;
  port.on('message', (message) => {
    const result = isRecordValue(message) ? message.nestedResult : undefined;
    if (!isRecordValue(result) || typeof result.id !== 'number') return;
    waiting.get(result.id)?.({ status: typeof result.status === 'number' ? result.status : null, timedOut: result.timedOut === true, failed: result.failed !== false });
    waiting.delete(result.id);
  });
  fileRunner = (gitBin, args, cwd, fd, limitMs) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      port.postMessage({ nestedGit: { id, gitBin, args: [...args], cwd, fd, limitMs } });
    });
}

/**
 * On the main thread: runs a scan git the worker asked for (`message`), started at once (its group
 * known to `tracker` before anything else can end the decision), and hands back how it ended. False
 * when the message is no such ask.
 */
export function answerNestedGit(message: unknown, tracker: GitTracker, reply: (value: unknown) => void): boolean {
  const ask = nestedAskOf(message);
  if (ask === null) return false;
  void runGitToFile(ask.gitBin, ask.args, ask.cwd, ask.fd, ask.limitMs, tracker).then((result) => reply({ nestedResult: { id: ask.id, ...result } }));
  return true;
}

/**
 * Git's output goes to a private temp file under `parent`, read back as a stream: never held whole in
 * memory. The file (and its folder) is unlinked as soon as it is open (round 15, PERF INFO-1), so
 * nothing is left on disk however the CLI ends.
 */
function realGitRunIn(parent: string, gitBin?: string): GitRun {
  return async (args, cwd, keep, limitMs) => {
    const dir = fs.mkdtempSync(path.join(parent, TEMP_PREFIX));
    let fd: number;
    try {
      fd = fs.openSync(path.join(dir, 'out'), 'w+', 0o600);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    try {
      const run = await fileRunner(gitBin ?? gitBinary(), args, cwd, fd, limitMs);
      if (run.timedOut) return { status: run.status, stdout: '', timedOut: true };
      if (run.failed || run.status !== 0) return { status: run.status, stdout: '', timedOut: false };
      return { status: 0, stdout: keptEntries(fd, keep).map((entry) => `${entry}\0`).join(''), timedOut: false };
    } finally {
      fs.closeSync(fd);
    }
  };
}

/** The real git, its output under the per-user temp parent in os.tmpdir(). */
export const realGitRun: GitRun = (args, cwd, keep, limitMs) => realGitRunIn(tempParent(os.tmpdir()))(args, cwd, keep, limitMs);

function inside(p: string, root: string): boolean {
  return p.startsWith(`${root}/`);
}

/** The worktrees of the repo whose common git folder is `commonDir`, as their folders. */
function worktrees(commonDir: string): string[] {
  const dir = path.join(commonDir, 'worktrees');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      const text = fs.readFileSync(path.join(dir, name, 'gitdir'), 'utf8').trim();
      return path.isAbsolute(text) ? [fs.realpathSync(path.dirname(text))] : [];
    } catch {
      return [];
    }
  });
}

/** The repo-relative folders git sees as other repos: nested repos and submodules; both git calls run side by side (round 14, D-R14-2). */
async function askGit(top: string, run: GitRun): Promise<string[] | 'timeout' | 'unknown'> {
  const isRepo = (entry: Buffer): boolean => entry.length > 0 && entry[entry.length - 1] === SLASH;
  const isGitlink = (entry: Buffer): boolean => entry.subarray(0, GITLINK.length).equals(GITLINK);
  const limit = timeLeft(GIT_CAP_MS);
  const [others, stage] = await Promise.all([
    run(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...NOT_WALKED.map((name) => `:(exclude,glob)**/${name}/**`)], top, isRepo, limit),
    run(['ls-files', '--stage', '-z'], top, isGitlink, limit),
  ]);
  if (others.timedOut || stage.timedOut) return 'timeout';
  if (others.status !== 0 || stage.status !== 0) return 'unknown';
  const entries = (out: string, keep: (entry: Buffer) => boolean): string[] => out.split('\0').filter((entry) => keep(Buffer.from(entry, 'utf8')));
  const repos = entries(others.stdout, isRepo).map((entry) => entry.slice(0, -1));
  const links = entries(stage.stdout, isGitlink).map((entry) => entry.slice(entry.indexOf('\t') + 1));
  return [...repos, ...links];
}

/** The other repos and worktrees inside `top` (a real git toplevel, as it is on disk). */
export async function nestedRepos(top: string, dirs: { gitDir: string; commonDir: string }, named: readonly string[], opts: NestedOptions = {}): Promise<NestedRepos> {
  let real: string;
  try {
    real = fs.realpathSync(dirs.commonDir);
  } catch {
    return { kind: 'unknown' };
  }
  const entries = await askGit(top, opts.run ?? (opts.tempRoot === undefined && opts.gitBin === undefined ? realGitRun : realGitRunIn(tempParent(opts.tempRoot ?? os.tmpdir()), opts.gitBin)));
  if (entries === 'timeout') return { kind: 'timeout' };
  if (entries === 'unknown') return { kind: 'unknown' };
  const trees = worktrees(real).filter((dir) => inside(dir, top));
  const repos = [...new Set([...entries.map((entry) => path.join(top, entry)), ...trees])].filter((dir) => !named.includes(dir));
  return { kind: 'found', repos };
}
