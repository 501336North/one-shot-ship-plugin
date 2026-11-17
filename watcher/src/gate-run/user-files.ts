/**
 * The user-level files that steer the review gate (R-266 layer 2; round 6 widened it to every key that
 * steers the gate). A review agent could widen its own allowlist, turn the hooks off or swap the code
 * that checks it through a route the gate rule cannot read (an inline `node -e`), so any change to
 * these during a review run voids it, whoever made it (another Claude session or the user would void
 * it too: recorded limit):
 *   - ~/.oss/config.json: its `toolGates` and `models` keys (apiKey and the rest are left out);
 *   - ~/.claude/settings.json and settings.local.json (and the same under CLAUDE_CONFIG_DIR), and each
 *     reviewed repo's .claude/settings.json and settings.local.json, tracked or ignored (security
 *     HIGH-3): the keys that run hooks or load plugins (SETTINGS_KEYS); model, permissions and the rest
 *     are left out;
 *   - ~/.oss/hooks/** and ~/.oss/bin/** (not the decrypt CLI's .download/ folder or its
 *     .decrypt-upgrade-failed stamp: a CLI update writes them);
 *   - this session's ~/.oss/gate-state/<session>/repos.json (the repos the check covers);
 *   - installed_plugins.json: its whole `plugins` object (every plugin, every id);
 *   - the gate parts (hooks/**, config/**, watcher/dist/**, hooks.json, .claude-plugin/**) of the
 *     installed OSS plugin and of the plugin roots the gate runs from (CLAUDE_PLUGIN_ROOT, the CLI's
 *     own bundle root): a session started before an update, or with --plugin-dir, runs from there.
 *     What the hooks run is recorded by content, the rest by stat (PLUGIN_PARTS);
 *   - the node the hooks run (~/.oss/node-path and the binary it names), the git the check runs
 *     (git-bin.ts), and every node, git or other program the hooks run (FIXED_PROGRAMS) that PATH puts
 *     before the real one.
 * Everything else (shell rc files, git/npm/ssh config, CLAUDE.md, agents, commands, other plugins'
 * files) is left out: layer 1 refuses a review agent's plain writes there; reaching them through an
 * interpreter is a recorded limit.
 *
 * A key of a JSON file is recorded as the hash of its canonical JSON (sorted keys), with the file's
 * `missing` and `unparsable:<hash of its bytes>` states kept apart. A file is recorded by its content
 * hash (a symlink is followed; its link text is kept too), by its stat (size, mtime, ctime, inode)
 * over 1 MB, by type when it is not a regular file (a FIFO is never read), or as `missing`. The walk
 * checks the time budget as it goes and throws when it is spent or a file cannot be read: fail closed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { remaining, type Budget } from './git.js';
import { fixedProgram, gitBinary } from './git-bin.js';
import { runRoot } from './run-store.js';

const CONTENT_MAX_BYTES = 1024 * 1024;
const JSON_MAX_BYTES = 4 * 1024 * 1024;
const BUDGET_EVERY = 256;

/** The keys of ~/.oss/config.json that steer the gate. */
const CONFIG_KEYS: readonly string[] = ['toolGates', 'models'];
/** The keys of a Claude settings file that run hooks or load plugins. */
const SETTINGS_KEYS: readonly string[] = [
  'hooks',
  'disableAllHooks',
  'allowManagedHooksOnly',
  'env',
  'enabledPlugins',
  'extraKnownMarketplaces',
  'pluginDirs',
];
const SETTINGS_FILES: readonly string[] = ['settings.json', 'settings.local.json'];

/** The OSS trees in the home folder, every file by content (stat over 1 MB). */
const OSS_TREES: readonly string[] = ['.oss/hooks', '.oss/bin'];
/** Written by a decrypt CLI update, never read by the gate. */
const LEFT_OUT: readonly string[] = ['.oss/bin/.download', '.oss/bin/.decrypt-upgrade-failed'];

const INSTALLED_PLUGINS = 'plugins/installed_plugins.json';
const NODE_PATH = '.oss/node-path';
/**
 * The programs the hooks run, at the fixed paths they run them from: the first of each list that exists,
 * the same order as hooks/oss-node.sh's oss_bin (node: ~/.oss/node-path; git: git-bin.ts).
 */
const FIXED_PROGRAMS: Readonly<Record<string, readonly string[]>> = {
  cat: ['/bin/cat', '/usr/bin/cat'],
  mktemp: ['/usr/bin/mktemp', '/bin/mktemp'],
  bash: ['/bin/bash', '/usr/bin/bash'],
  rm: ['/bin/rm', '/usr/bin/rm'],
  mkdir: ['/bin/mkdir', '/usr/bin/mkdir'],
  date: ['/bin/date', '/usr/bin/date'],
  tr: ['/usr/bin/tr', '/bin/tr'],
  head: ['/usr/bin/head', '/bin/head'],
  cut: ['/usr/bin/cut', '/bin/cut'],
};
/**
 * The OSS plugin's gate parts, relative to its root, each with the files under it the hooks run or read
 * (recorded by content); every other file there is recorded by stat (size, mtime, ctime, inode), so a
 * big watcher/dist stays fast (perf LOW 4). The two bundles load only node's own modules at run time.
 */
const PLUGIN_PARTS: ReadonlyArray<{ part: string; byContent: (rel: string) => boolean }> = [
  { part: 'hooks', byContent: (rel) => !rel.includes('/') },
  { part: 'config', byContent: () => true },
  { part: 'watcher/dist', byContent: (rel) => rel === 'cli/tool-gate.cjs' || rel === 'cli/gate-run.cjs' },
  { part: 'hooks.json', byContent: () => true },
  { part: '.claude-plugin', byContent: () => true },
];

function sha(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/** Canonical JSON: object keys sorted at every level, so key order never counts as a change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function statKey(stats: fs.Stats): string {
  return `stat:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;
}

function typeOf(stats: fs.Stats): string {
  if (stats.isDirectory()) return 'type:dir';
  if (stats.isFIFO()) return 'type:fifo';
  if (stats.isSocket()) return 'type:socket';
  if (stats.isCharacterDevice() || stats.isBlockDevice()) return 'type:device';
  return 'type:other';
}

/** A regular file's bytes (followed or not), or a record for why there are none to read. */
function readFile(file: string, follow: boolean, max: number): { bytes: Buffer } | { record: string } {
  const stats = (follow ? fs.statSync : fs.lstatSync)(file, { throwIfNoEntry: false });
  if (stats === undefined) return { record: 'missing' };
  if (!stats.isFile()) return { record: typeOf(stats) };
  if (stats.size > max) return { record: statKey(stats) };
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (follow ? 0 : fs.constants.O_NOFOLLOW));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) return { record: typeOf(opened) };
    return { bytes: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}

/** A symlink's own target text, prefixed to the record of what it points to. */
function withLink(file: string, record: string): string {
  return fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true ? `link:${fs.readlinkSync(file)}|${record}` : record;
}

/** A file's record: content hash (up to 1 MB), else stat, type or missing. */
function fileValue(file: string, follow: boolean): string {
  const read = readFile(file, follow, CONTENT_MAX_BYTES);
  return 'bytes' in read ? `sha:${sha(read.bytes)}` : read.record;
}

/** A JSON file parsed, or its state when it has none to parse: missing, unparsable, a type or a stat. */
function parseJson(file: string): { value: unknown } | { record: string } {
  const read = readFile(file, true, JSON_MAX_BYTES);
  if (!('bytes' in read)) return read;
  try {
    return { value: JSON.parse(read.bytes.toString('utf8')) as unknown };
  } catch {
    return { record: `unparsable:${sha(read.bytes)}` };
  }
}

/** One key of a JSON file: the hash of its canonical JSON, or the file's own state. */
function keyValue(file: string, key: string): string {
  const parsed = parseJson(file);
  if (!('value' in parsed)) return withLink(file, parsed.record);
  const { value } = parsed;
  const inner = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
  return withLink(file, inner === undefined ? 'absent' : `json:${sha(canonical(inner))}`);
}

/** `~/<path>` for a path in the home folder, the absolute path otherwise. */
function nameOf(home: string, abs: string): string {
  const rel = path.relative(home, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${rel}` : abs;
}

/** A file's record by stat only (lstat: size, mtime, ctime, inode), or its type when it is not a regular file. */
function statValue(file: string): string {
  const stats = fs.lstatSync(file);
  return stats.isFile() ? statKey(stats) : typeOf(stats);
}

/**
 * A file or every file and link under a folder (lstat; links by their target text, never followed below
 * the start). Folders are not recorded: an empty one steers nothing. A file is recorded by content when
 * `byContent` says so for its path below the start (`a/b.js`), else by stat.
 */
function walk(
  home: string,
  start: string,
  budget: Budget,
  out: Record<string, string>,
  skip: ReadonlySet<string> = new Set(),
  byContent: (rel: string) => boolean = () => true,
): void {
  const top = fs.lstatSync(start, { throwIfNoEntry: false });
  const name = nameOf(home, start);
  if (top === undefined) return;
  const real = top.isSymbolicLink() ? fs.realpathSync(start) : start;
  if (!fs.statSync(real).isDirectory()) {
    out[name] = withLink(start, fileValue(real, true));
    return;
  }
  if (top.isSymbolicLink()) out[name] = withLink(start, 'dir');
  const stack: Array<{ abs: string; key: string; rel: string }> = [{ abs: real, key: name, rel: '' }];
  let seen = 0;
  while (stack.length > 0) {
    const dir = stack.pop() as { abs: string; key: string; rel: string };
    for (const entry of fs.readdirSync(dir.abs, { withFileTypes: true })) {
      if (++seen % BUDGET_EVERY === 0) remaining(budget);
      const abs = path.join(dir.abs, entry.name);
      const key = `${dir.key}/${entry.name}`;
      const rel = dir.rel === '' ? entry.name : `${dir.rel}/${entry.name}`;
      if (skip.has(key)) continue;
      if (entry.isDirectory()) {
        stack.push({ abs, key, rel });
      } else if (entry.isSymbolicLink()) {
        out[key] = `link:${fs.readlinkSync(abs)}`;
      } else {
        out[key] = byContent(rel) ? fileValue(abs, false) : statValue(abs);
      }
    }
  }
}

/** The install paths of the OSS plugin (`oss@<marketplace>`) in a parsed installed_plugins.json. */
function ossInstallPaths(value: unknown): string[] {
  const plugins = (value as { plugins?: unknown } | null)?.plugins;
  if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
  return Object.entries(plugins as Record<string, unknown>)
    .filter(([id]) => id.split('@')[0] === 'oss')
    .flatMap(([, entry]) => (Array.isArray(entry) ? entry : [entry]))
    .map((install) => (install as { installPath?: unknown } | null)?.installPath)
    .filter((p): p is string => typeof p === 'string' && path.isAbsolute(p));
}

/** The real path of a file, or null when it cannot be resolved. */
function realOrNull(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

/** The node ~/.oss/node-path names (first line), or null. */
function recordedNode(home: string): string | null {
  const read = readFile(path.join(home, NODE_PATH), true, CONTENT_MAX_BYTES);
  if (!('bytes' in read)) return null;
  const line = read.bytes.toString('utf8').split('\n')[0].trim();
  return path.isAbsolute(line) ? line : null;
}

/** Every `<dir>/<name>` PATH lists before the real program (all of PATH when it is not on it). */
function shadows(home: string, pathEnv: string, programs: Record<string, string | null>, out: Record<string, string>): void {
  const dirs = pathEnv.split(':').filter((dir) => path.isAbsolute(dir));
  for (const [name, real] of Object.entries(programs)) {
    const realPath = real === null ? null : realOrNull(real) ?? real;
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (realPath !== null && realOrNull(candidate) === realPath) break;
      out[`PATH: ${nameOf(home, candidate)}`] = withLink(candidate, fileValue(candidate, true));
    }
  }
}

/** Where the gate runs from and what it runs, beyond the home folder's own files. */
export interface UserContext {
  /** CLAUDE_CONFIG_DIR, when set: its settings and installed_plugins.json are covered too. */
  configDir?: string;
  /** The plugin roots the gate runs from (CLAUDE_PLUGIN_ROOT, the CLI's bundle root). */
  pluginRoots?: readonly string[];
  /** The hook's PATH. */
  pathEnv?: string;
  /** The reviewed repos' tops: their .claude settings' SETTINGS_KEYS are covered too, ignored or not. */
  repos?: readonly string[];
}

/** The fingerprint of the user-level files that steer the gate. Throws when out of time or a file cannot be read. */
export function printUserFiles(home: string, sessionId: string, budget: Budget, ctx: UserContext = {}): Record<string, string> {
  const out: Record<string, string> = {};
  remaining(budget);
  const config = path.join(home, '.oss/config.json');
  for (const key of CONFIG_KEYS) out[`${nameOf(home, config)}: ${key}`] = keyValue(config, key);
  const claudeDirs = [...new Set([path.join(home, '.claude'), ...(ctx.configDir !== undefined && path.isAbsolute(ctx.configDir) ? [ctx.configDir] : [])])];
  const pluginRoots = new Set<string>();
  for (const dir of claudeDirs) {
    remaining(budget);
    for (const file of SETTINGS_FILES) {
      const abs = path.join(dir, file);
      for (const key of SETTINGS_KEYS) out[`${nameOf(home, abs)}: ${key}`] = keyValue(abs, key);
    }
    const installed = path.join(dir, INSTALLED_PLUGINS);
    out[`${nameOf(home, installed)}: plugins`] = keyValue(installed, 'plugins');
    const parsed = parseJson(installed);
    if ('value' in parsed) for (const root of ossInstallPaths(parsed.value)) pluginRoots.add(realOrNull(root) ?? root);
  }
  for (const top of ctx.repos ?? []) {
    remaining(budget);
    for (const file of SETTINGS_FILES) {
      const abs = path.join(top, '.claude', file);
      for (const key of SETTINGS_KEYS) out[`${nameOf(home, abs)}: ${key}`] = keyValue(abs, key);
    }
  }
  remaining(budget);
  const repos = path.join(runRoot(home), sessionId, 'repos.json');
  out[nameOf(home, repos)] = withLink(repos, fileValue(repos, true));
  const skip = new Set(LEFT_OUT.map((rel) => `~/${rel}`));
  for (const rel of OSS_TREES) {
    remaining(budget);
    walk(home, path.join(home, rel), budget, out, skip);
  }
  for (const root of ctx.pluginRoots ?? []) {
    if (path.isAbsolute(root)) pluginRoots.add(realOrNull(root) ?? root);
  }
  for (const root of pluginRoots) {
    for (const { part, byContent } of PLUGIN_PARTS) {
      remaining(budget);
      walk(home, path.join(root, part), budget, out, new Set(), byContent);
    }
  }
  remaining(budget);
  const nodePath = path.join(home, NODE_PATH);
  out[nameOf(home, nodePath)] = withLink(nodePath, fileValue(nodePath, true));
  const node = recordedNode(home);
  if (node !== null) out[`node: ${nameOf(home, node)}`] = withLink(node, fileValue(node, true));
  const git = gitBinary();
  out[`git: ${nameOf(home, git)}`] = withLink(git, fileValue(git, true));
  const fixed = Object.fromEntries(Object.entries(FIXED_PROGRAMS).map(([name, candidates]) => [name, fixedProgram(candidates)]));
  if (ctx.pathEnv !== undefined) shadows(home, ctx.pathEnv, { node, git, ...fixed }, out);
  return out;
}

/** The changed user files between two prints, named `(user) <name>`, sorted. */
export function userChanges(before: Record<string, string>, after: Record<string, string>): string[] {
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[key] ?? 'missing') !== (after[key] ?? 'missing')) changed.push(`(user) ${key}`);
  }
  return changed.sort();
}
