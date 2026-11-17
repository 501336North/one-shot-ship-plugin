/**
 * A repo's fingerprint for the review-run check (R-266, ADR-007, ADR-009, ADR-011): what a review
 * agent could change that ships, recorded at the run's start and compared at its end.
 *
 * - The tracked files as a git tree: through a temporary index seeded with a copy of the real one (so
 *   unchanged files are not hashed again; the copy keeps the real index's times so git's racy-entry check
 *   holds) and `git add -u`, with the assume-unchanged / skip-worktree flags cleared so a flagged file's
 *   edit is still seen. The real index is never written, and nothing is written to the repo's object
 *   store: new objects go to this run's own object folder (the repo's store is an alternate). Every
 *   configured filter is switched off for the check (clean/smudge `cat`, no process), so a filter program
 *   swapped during the run cannot hide a change. OSS's own run files under `.oss/` (OSS_RUN_FILES) are
 *   left out; every other file under `.oss/` is checked.
 * - The untracked, non-ignored files, path by path: a blob id from `git hash-object --no-filters` (no
 *   object written), or for a file over 8 MB its stat (size, mtime, ctime, inode), a symlink by its target
 *   text, anything else (FIFO, socket) by its type. An untracked nested repo (often another session's
 *   live worktree, e.g. under .claude/worktrees) is recorded like a gitlink: its branch and HEAD commit
 *   only (one read-only `rev-parse`; its index and work tree are never read), so a new commit or a
 *   branch switch in it voids the run, while edits in its work tree are not seen. The tool gate refuses
 *   a review agent's direct writes there; writes by an interpreter it runs are the recorded limit.
 * - The git state outside the work tree: HEAD, every ref, the index's flags and staged entries, config
 *   (and the worktree's config.worktree), the hooks folder (core.hooksPath when the repo sets it), info/,
 *   the worktree list and the user's own git config files, each kept as a value or a sha256 so a change
 *   can be named. Only regular files are read: a FIFO or device is recorded by its type, never opened
 *   for reading.
 * - Ignored files are not checked (build output, user decision), except dependency folders. Recorded
 *   limit: a .gitignore that hides its own new file, planted through an interpreter, goes unseen.
 * - Gitignored dependency folders: every file under each `node_modules` folder git lists as ignored
 *   (workspace packages too; a node_modules inside another ignored tree is not entered; a symlinked one is
 *   walked at its real path, and one that cannot be resolved fails the check), by a short hash of size,
 *   mtime, ctime and inode (lstat; a symlink inside by its target text, never followed), tool caches
 *   (`.cache`, `.vite*`) skipped. Walked with fs in parallel, the time budget checked as it goes.
 * - Nested repos (gitlinks: submodules, embedded repos) the same way, their names prefixed by their path.
 *
 * At the end the git state is compared first: when config, hooks or info/ changed, the change is named
 * without running `git add`, so a filter or rule added during the run never runs and cannot mask a change.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { git, gitOrNull, remaining, type Budget, type GitOptions } from './git.js';
import { writePrivateFile } from './run-store.js';

/** OSS's own run files under the top-level `.oss/`, left out of the check (ADR-011). Everything else is checked. */
export const OSS_RUN_FILES: readonly string[] = [
  '.oss/logs/**',
  '.oss/workflow.log',
  '.oss/sessions/**',
  '.oss/locks/**',
  '.oss/run/**',
  '.oss/session-context.md',
  '.oss/workflow-state.json',
  '.oss/health-workflow-state.json',
  '.oss/queue.json',
  '.oss/current-project',
  '.oss/timeline-outbox/**',
  '.oss/tool-gates/**',
  '.oss/.iron-laws-*',
  '.oss/dev/timeline-unfiled.ndjson',
  '.oss/dev/active/*/timeline.ndjson',
  '.oss/dev/completed/*/timeline.ndjson',
];

// The untracked listing treats the run files as ignored (an excludes file, so an untracked log folder is
// never hashed). Tracked run files are dropped from the temporary index before the tree is written.
const RUN_FILE_IGNORE_RULES = `${OSS_RUN_FILES.map((glob) => `/${glob}`).join('\n')}\n`;
const RUN_FILE_PATHS = ['--', ...OSS_RUN_FILES.map((glob) => `:(top,glob)${glob}`)];

/** Git-state items that change how `git add` reads the work tree: when one changed, `git add` is not run. */
const RISKY_ITEMS: readonly string[] = ['config', 'config.worktree', '.git/hooks', '.git/info'];
/** The user's own git config files (from HOME), named together as `user config`. */
const USER_CONFIG_FILES: readonly string[] = ['.gitconfig', '.config/git/config', '.config/git/attributes', '.config/git/ignore'];
const MAX_DIR_ENTRIES = 2000;
const MAX_NESTING = 5;
const BIG_FILE_BYTES = 8 * 1024 * 1024;
const WALK_CONCURRENCY = 64;

export interface RepoPrint {
  tree: string;
  state: Record<string, string>;
  nested: Record<string, RepoPrint>;
  /** The gitignored node_modules folders walked (paths from the repo top). */
  depDirs: string[];
  /** Per folder under them: `name/hash/name/hash…` (hash of size, mtime, ctime, inode, or a link target). */
  deps: Record<string, string>;
  /** Untracked, non-ignored files: path → `blob:<id>`, `stat:<key>` (over 8 MB), `link:<target>`, `type:<kind>` or `repo:<HEAD> <branch>`. */
  untracked: Record<string, string>;
}

export interface PrintContext {
  budget: Budget;
  /** This run's own folder (temporary index, excludes, object copy); the caller removes it after the stop. */
  runDir: string;
  /** The user's HOME (from the hook's env). */
  home: string;
}

interface Layout {
  top: string;
  index: string;
  head: string;
  config: string;
  configWorktree: string;
  hooks: string;
  info: string;
  objects: string;
}

function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** A short, fast (non-cryptographic) hash: FNV-1a, 32 bits, as 8 hex digits. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function statKey(stats: fs.Stats): string {
  return `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;
}

function layout(folder: string, budget: Budget): Layout {
  const [top, index, head, config, configWorktree, hooks, info, objects] = git(
    folder,
    [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      ...['index', 'HEAD', 'config', 'config.worktree', 'hooks', 'info', 'objects'].flatMap((name) => ['--git-path', name]),
    ],
    budget,
  ).split('\n');
  return { top, index, head, config, configWorktree, hooks, info, objects };
}

function typeOf(stats: fs.Stats): string {
  if (stats.isFIFO()) return 'fifo';
  if (stats.isSocket()) return 'socket';
  if (stats.isCharacterDevice()) return 'char-device';
  if (stats.isBlockDevice()) return 'block-device';
  if (stats.isDirectory()) return 'dir';
  if (stats.isSymbolicLink()) return 'link';
  return 'other';
}

type Entry = { kind: 'none' } | { kind: 'file'; data: Buffer } | { kind: 'link'; target: string } | { kind: 'other'; type: string };

/**
 * A file's content only when it is a regular file: a FIFO, socket or device is never opened for reading
 * (it could block the check). Without `follow`, a symlink is recorded by its target text.
 */
function readRegular(file: string, follow: boolean): Entry {
  let stats: fs.Stats | undefined;
  try {
    stats = follow ? fs.statSync(file, { throwIfNoEntry: false }) : fs.lstatSync(file, { throwIfNoEntry: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTDIR' || (err as NodeJS.ErrnoException).code === 'ELOOP') return { kind: 'none' };
    throw err;
  }
  if (stats === undefined) return { kind: 'none' };
  if (stats.isSymbolicLink()) return { kind: 'link', target: fs.readlinkSync(file) };
  if (!stats.isFile()) return { kind: 'other', type: typeOf(stats) };
  const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = fs.constants;
  const fd = fs.openSync(file, O_RDONLY | O_NONBLOCK | (follow ? 0 : O_NOFOLLOW));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) return { kind: 'other', type: typeOf(opened) };
    return { kind: 'file', data: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}

function entryDigest(entry: Entry): string {
  switch (entry.kind) {
    case 'none':
      return '(none)';
    case 'file':
      return sha256(entry.data);
    case 'link':
      return `link ${entry.target}`;
    case 'other':
      return `(${entry.type})`;
  }
}

/** A digest of a folder's entries (names, kinds, contents, link targets); symlinks never followed, only regular files read. */
function dirDigest(dir: string, budget: Budget): string {
  const lines: string[] = [];
  const walk = (current: string, rel: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(current).sort();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (rel === '' && (code === 'ENOENT' || code === 'ENOTDIR')) {
        lines.push(`(not a folder) ${entryDigest(readRegular(current, false))}`);
        return;
      }
      throw err;
    }
    for (const name of names) {
      remaining(budget);
      if (lines.length >= MAX_DIR_ENTRIES) {
        lines.push('(more)');
        return;
      }
      const abs = path.join(current, name);
      const relName = rel === '' ? name : `${rel}/${name}`;
      const stats = fs.lstatSync(abs);
      if (stats.isDirectory()) {
        lines.push(`d ${relName}`);
        walk(abs, relName);
      } else lines.push(`f ${relName} ${stats.mode & 0o777} ${entryDigest(readRegular(abs, false))}`);
    }
  };
  walk(dir, '');
  return sha256(lines.join('\n'));
}

interface GitState {
  state: Record<string, string>;
  assumeUnchanged: string[];
  skipWorktree: string[];
}

/**
 * The repo's git state. With `before`, when config changed the hooks folder is not read (its path may
 * now point anywhere) and keeps its earlier value.
 */
function gitState(lay: Layout, ctx: PrintContext, before?: Record<string, string>): GitState {
  const { budget } = ctx;
  const state: Record<string, string> = {};
  const { top } = lay;
  state.config = entryDigest(readRegular(lay.config, false));
  const worktreeConfig = readRegular(lay.configWorktree, false);
  if (worktreeConfig.kind !== 'none') state['config.worktree'] = entryDigest(worktreeConfig);

  const refs: Record<string, string> = {};
  for (const line of git(top, ['for-each-ref', '--format=%(objectname) %(refname)'], budget).split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0) refs[line.slice(space + 1)] = line.slice(0, space);
  }
  const headEntry = readRegular(lay.head, false);
  const head = headEntry.kind === 'file' ? headEntry.data.toString('utf8').trim() : entryDigest(headEntry);
  const target = head.startsWith('ref: ') ? head.slice('ref: '.length) : null;
  state.HEAD = target === null ? head : `${head} ${refs[target] ?? '(unborn)'}`;
  Object.assign(state, refs);

  const assumeUnchanged: string[] = [];
  const skipWorktree: string[] = [];
  const staged: string[] = [];
  for (const entry of git(top, ['ls-files', '-s', '-v', '-z'], budget).split('\0')) {
    if (entry === '') continue;
    const tag = entry.charAt(0);
    const line = entry.slice(2);
    const file = line.slice(line.indexOf('\t') + 1);
    staged.push(line);
    if (tag === 'S' || tag === 's') skipWorktree.push(file);
    if (tag !== tag.toUpperCase()) assumeUnchanged.push(file);
  }
  state['index flags'] = sha256(`${assumeUnchanged.join('\0')}\n${skipWorktree.join('\0')}`);
  state['staged changes'] = sha256(staged.join('\0'));

  if (before !== undefined && before.config !== state.config) state['.git/hooks'] = before['.git/hooks'];
  else {
    const hooksPath = gitOrNull(top, ['config', '--type=path', '--get', 'core.hooksPath'], budget)?.trim();
    const hooks = hooksPath ? path.resolve(top, hooksPath) : lay.hooks;
    state['.git/hooks'] = dirDigest(hooks, budget);
  }
  state['.git/info'] = dirDigest(lay.info, budget);
  state['worktree list'] = sha256(git(top, ['worktree', 'list', '--porcelain'], budget));
  state['user config'] = sha256(
    USER_CONFIG_FILES.map((file) => `${file} ${entryDigest(readRegular(path.join(ctx.home, file), true))}`).join('\n'),
  );
  return { state, assumeUnchanged, skipWorktree };
}

/** `-c` settings that switch off every filter the repo's config defines (clean/smudge `cat`, no process). */
function filtersOff(top: string, budget: Budget): Record<string, string> {
  const out = gitOrNull(top, ['config', '-z', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$'], budget) ?? '';
  const config: Record<string, string> = {};
  for (const record of out.split('\0')) {
    const match = /^filter\.(.+)\.(clean|smudge|process|required)$/i.exec(record.split('\n')[0] ?? '');
    if (match === null) continue;
    const name = match[1];
    config[`filter.${name}.clean`] = 'cat';
    config[`filter.${name}.smudge`] = 'cat';
    config[`filter.${name}.process`] = '';
    config[`filter.${name}.required`] = 'false';
  }
  return config;
}

/** This run's object folder for the repo (the repo's own store is an alternate, never written). */
function objectEnv(lay: Layout, ctx: PrintContext): Record<string, string> {
  const dir = path.join(ctx.runDir, 'objects', sha256(lay.top).slice(0, 16));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { GIT_OBJECT_DIRECTORY: dir, GIT_ALTERNATE_OBJECT_DIRECTORIES: lay.objects };
}

/**
 * The untracked, non-ignored files (OSS run files left out), path by path, with no object written: a blob
 * id from `git hash-object --no-filters --stdin-paths`, or a stat key over 8 MB, a link target, a type,
 * or `repo:<HEAD> <branch>` for an untracked nested repo (git lists it as `dir/`; its path is kept without the
 * slash; `repo:unborn` when it has no commit yet).
 */
function untrackedFiles(top: string, excludes: string, budget: Budget): Record<string, string> {
  const untracked: Record<string, string> = {};
  const toHash: string[] = [];
  const listed = git(top, ['ls-files', '-o', '--exclude-standard', '-z'], budget, { config: { 'core.excludesFile': excludes } });
  for (const file of listed.split('\0')) {
    if (file === '') continue;
    if (file.endsWith('/')) {
      const head = gitOrNull(path.join(top, file), ['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD'], budget);
      untracked[file.slice(0, -1)] = head === null ? 'repo:unborn' : `repo:${head.trim().split('\n').join(' ')}`;
      continue;
    }
    const abs = path.join(top, file);
    const stats = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (stats === undefined) continue;
    if (stats.isSymbolicLink()) untracked[file] = `link:${fs.readlinkSync(abs)}`;
    else if (!stats.isFile()) untracked[file] = `type:${typeOf(stats)}`;
    else if (stats.size > BIG_FILE_BYTES || file.includes('\n')) untracked[file] = `stat:${statKey(stats)}`;
    else toHash.push(file);
  }
  if (toHash.length > 0) {
    const ids = git(top, ['hash-object', '--no-filters', '--stdin-paths'], budget, { input: `${toHash.join('\n')}\n` }).split('\n');
    toHash.forEach((file, i) => {
      untracked[file] = `blob:${ids[i]}`;
    });
  }
  return untracked;
}

/** The tracked files as a tree id (through a temporary index seeded with the real one), and the untracked files. */
function workTree(
  lay: Layout,
  gs: GitState,
  ctx: PrintContext,
  objects: Record<string, string>,
): { tree: string; untracked: Record<string, string> } {
  const { top } = lay;
  const { budget } = ctx;
  const tempIndex = path.join(ctx.runDir, 'index');
  const excludes = path.join(ctx.runDir, 'exclude');
  fs.rmSync(tempIndex, { force: true });
  try {
    const real = fs.statSync(lay.index, { throwIfNoEntry: false });
    if (real !== undefined) {
      fs.copyFileSync(lay.index, tempIndex, fs.constants.COPYFILE_EXCL);
      // The copy keeps the real index's times, so git's racy-entry check (an entry not older than the
      // index is re-read, not trusted by its stat) works exactly as it does for the real index.
      fs.utimesSync(tempIndex, real.atime, real.mtime);
    }
    const env: GitOptions = { env: { GIT_INDEX_FILE: tempIndex, ...objects } };
    if (gs.assumeUnchanged.length > 0) {
      git(top, ['update-index', '--no-assume-unchanged', '-z', '--stdin'], budget, { ...env, input: gs.assumeUnchanged.join('\0') });
    }
    if (gs.skipWorktree.length > 0) {
      git(top, ['update-index', '--no-skip-worktree', '-z', '--stdin'], budget, { ...env, input: gs.skipWorktree.join('\0') });
    }
    writePrivateFile(excludes, RUN_FILE_IGNORE_RULES);
    const untracked = untrackedFiles(top, excludes, budget);
    git(top, ['add', '-u', '--', ':(top)'], budget, { ...env, config: filtersOff(top, budget) });
    git(top, ['rm', '--cached', '-r', '-q', '-f', '--ignore-unmatch', ...RUN_FILE_PATHS], budget, env);
    return { tree: git(top, ['write-tree'], budget, env).trim(), untracked };
  } finally {
    fs.rmSync(tempIndex, { force: true });
    fs.rmSync(excludes, { force: true });
  }
}

/** The ignored paths git lists at their highest ignored level (folders end with `/`). */
function ignoredPaths(top: string, budget: Budget): string[] {
  return git(top, ['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z'], budget)
    .split('\0')
    .filter((entry) => entry !== '');
}

/** A dependency folder to walk: its path from the repo top and where it really is. */
interface DepRoot {
  rel: string;
  abs: string;
}

/** The `node_modules` paths among the ignored entries (`dir/`, or a symlink listed bare) and the untracked symlinks. */
function depFolders(ignored: readonly string[], untracked: Record<string, string>): string[] {
  const bare = (entry: string): string => (entry.endsWith('/') ? entry.slice(0, -1) : entry);
  const named = (entry: string): boolean => path.posix.basename(bare(entry)) === 'node_modules';
  return [
    ...ignored.filter(named).map(bare),
    ...Object.entries(untracked)
      .filter(([file, value]) => named(file) && value.startsWith('link:'))
      .map(([file]) => file),
  ];
}

/**
 * Where each dependency folder really is: a symlinked one at its real path (one that cannot be resolved
 * throws, so the run is unverified); a missing one is skipped.
 */
function depRoots(top: string, rels: readonly string[]): DepRoot[] {
  const roots: DepRoot[] = [];
  for (const rel of new Set(rels)) {
    const abs = path.join(top, rel);
    const stats = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (stats === undefined) continue;
    if (stats.isSymbolicLink()) roots.push({ rel, abs: fs.realpathSync(abs) });
    else if (stats.isDirectory()) roots.push({ rel, abs });
  }
  return roots;
}

/** A tool cache directly inside a node_modules folder: `.cache`, `.vite`, `.vitest`, any `.vite*`. */
function isDepCache(name: string): boolean {
  return name === '.cache' || name.startsWith('.vite');
}

/** Runs `fn` over the items, at most `limit` at a time, checking the budget before each. */
async function eachLimited<T>(items: readonly T[], budget: Budget, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      remaining(budget);
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WALK_CONCURRENCY, items.length) }, worker));
}

function isGone(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Every file under the node_modules folders, as `folder → name/hash/…` (lstat, links not followed), in parallel. */
async function walkDeps(roots: readonly DepRoot[], budget: Budget): Promise<Record<string, string>> {
  const groups = new Map<string, string[]>();
  const add = (dir: string, name: string, hash: string): void => {
    const group = groups.get(dir);
    if (group === undefined) groups.set(dir, [`${name}/${hash}`]);
    else group.push(`${name}/${hash}`);
  };
  let level = roots.map(({ rel, abs }) => ({ rel, abs, inNodeModules: true }));
  while (level.length > 0) {
    const nextLevel: Array<{ rel: string; abs: string; inNodeModules: boolean }> = [];
    const leaves: Array<{ dir: string; name: string; abs: string }> = [];
    await eachLimited(level, budget, async ({ rel, abs, inNodeModules }) => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(abs, { withFileTypes: true });
      } catch (err) {
        if (isGone(err)) return;
        throw err;
      }
      for (const entry of entries) {
        if (inNodeModules && isDepCache(entry.name)) continue;
        const child = path.join(abs, entry.name);
        if (entry.isDirectory()) nextLevel.push({ rel: `${rel}/${entry.name}`, abs: child, inNodeModules: entry.name === 'node_modules' });
        else leaves.push({ dir: rel, name: entry.name, abs: child });
      }
    });
    await eachLimited(leaves, budget, async ({ dir, name, abs }) => {
      try {
        const stats = await fs.promises.lstat(abs);
        add(dir, name, shortHash(stats.isSymbolicLink() ? `l:${await fs.promises.readlink(abs)}` : statKey(stats)));
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    });
    level = nextLevel;
  }
  const deps: Record<string, string> = {};
  for (const [dir, group] of groups) deps[dir] = group.sort().join('/');
  return deps;
}

/** The changed dependency files between two walks. */
function depChanges(before: Record<string, string>, after: Record<string, string>): string[] {
  const changed: string[] = [];
  const parse = (packed: string | undefined): Map<string, string> => {
    const map = new Map<string, string>();
    const parts = packed === undefined ? [] : packed.split('/');
    for (let i = 0; i + 1 < parts.length; i += 2) map.set(parts[i], parts[i + 1]);
    return map;
  };
  for (const dir of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[dir] === after[dir]) continue;
    const was = parse(before[dir]);
    const now = parse(after[dir]);
    for (const name of new Set([...was.keys(), ...now.keys()])) if (was.get(name) !== now.get(name)) changed.push(`${dir}/${name}`);
  }
  return changed;
}

/** The gitlink (mode 160000) paths in a tree. */
function gitlinks(top: string, tree: string, budget: Budget, objects: Record<string, string>): string[] {
  const links: string[] = [];
  for (const entry of git(top, ['ls-tree', '-r', '-z', tree], budget, { env: objects }).split('\0')) {
    if (entry.startsWith('160000 ')) links.push(entry.slice(entry.indexOf('\t') + 1));
  }
  return links;
}

/** The layout of a nested repo whose top is exactly `folder`; null when there is none. */
function nestedLayout(folder: string, budget: Budget): Layout | null {
  if (!fs.existsSync(path.join(folder, '.git'))) return null;
  try {
    const lay = layout(folder, budget);
    return fs.realpathSync(lay.top) === fs.realpathSync(folder) ? lay : null;
  } catch (err) {
    if ((err as Error).name === 'BudgetExceeded') throw err;
    return null;
  }
}

async function print(lay: Layout, ctx: PrintContext, depth: number): Promise<RepoPrint> {
  const objects = objectEnv(lay, ctx);
  const gs = gitState(lay, ctx);
  const { tree, untracked } = workTree(lay, gs, ctx, objects);
  const depDirs = depFolders(ignoredPaths(lay.top, ctx.budget), untracked);
  const deps = await walkDeps(depRoots(lay.top, depDirs), ctx.budget);
  const nested: Record<string, RepoPrint> = {};
  if (depth < MAX_NESTING) {
    for (const link of gitlinks(lay.top, tree, ctx.budget, objects)) {
      const inner = nestedLayout(path.join(lay.top, link), ctx.budget);
      if (inner !== null) nested[link] = await print(inner, ctx, depth + 1);
    }
  }
  return { tree, state: gs.state, nested, depDirs, deps, untracked };
}

function isTextRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string');
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** True when a value read back from a snapshot record has a fingerprint's shape (records are checked, not trusted). */
export function isRepoPrint(value: unknown, depth = 0): value is RepoPrint {
  if (typeof value !== 'object' || value === null || depth > MAX_NESTING) return false;
  const print = value as Record<string, unknown>;
  return (
    typeof print.tree === 'string' &&
    /^[0-9a-f]{40,64}$/.test(print.tree) &&
    isTextRecord(print.state) &&
    typeof print.nested === 'object' &&
    print.nested !== null &&
    Object.values(print.nested).every((inner) => isRepoPrint(inner, depth + 1)) &&
    isTextList(print.depDirs) &&
    isTextRecord(print.deps) &&
    isTextRecord(print.untracked)
  );
}

/** The repo's fingerprint at a review run's start. */
export async function printRepo(top: string, ctx: PrintContext): Promise<RepoPrint> {
  return print(layout(top, ctx.budget), ctx, 0);
}

async function changes(lay: Layout, before: RepoPrint, ctx: PrintContext, depth: number): Promise<string[]> {
  const { budget } = ctx;
  const gs = gitState(lay, ctx, before.state);
  const keys = [...new Set([...Object.keys(before.state), ...Object.keys(gs.state)])];
  const changedState = keys.filter((key) => before.state[key] !== gs.state[key]);
  const named = changedState.map((key) => `(git) ${key}`);
  if (changedState.some((key) => RISKY_ITEMS.includes(key))) return named;

  const objects = objectEnv(lay, ctx);
  const { tree, untracked } = workTree(lay, gs, ctx, objects);
  const out = git(lay.top, ['diff-tree', '-r', '-z', '--no-renames', '--name-only', before.tree, tree], budget, { env: objects });
  const files = out.split('\0').filter((name) => name !== '');
  for (const file of new Set([...Object.keys(before.untracked), ...Object.keys(untracked)])) {
    if (before.untracked[file] !== untracked[file]) files.push(file);
  }

  const depDirs = [...before.depDirs, ...depFolders(ignoredPaths(lay.top, budget), untracked)];
  files.push(...depChanges(before.deps, await walkDeps(depRoots(lay.top, depDirs), budget)));

  if (depth < MAX_NESTING && Object.keys(before.nested).length > 0) {
    const links = new Set(gitlinks(lay.top, tree, budget, objects));
    for (const [link, inner] of Object.entries(before.nested)) {
      const innerLay = links.has(link) ? nestedLayout(path.join(lay.top, link), budget) : null;
      if (innerLay === null) {
        files.push(link);
        continue;
      }
      for (const change of await changes(innerLay, inner, ctx, depth + 1)) {
        if (change.startsWith('(git) ')) named.push(`(git) ${link}: ${change.slice('(git) '.length)}`);
        else named.push(`${link}/${change}`);
      }
    }
  }
  return [...new Set([...named, ...files])].sort();
}

/** What changed in the repo since `before` (sorted names; empty when nothing did). */
export async function changesSince(top: string, before: RepoPrint, ctx: PrintContext): Promise<string[]> {
  return changes(layout(top, ctx.budget), before, ctx, 0);
}
