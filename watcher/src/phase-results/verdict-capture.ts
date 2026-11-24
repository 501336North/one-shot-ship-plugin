/**
 * Review-agent verdict capture (R-257 T19, D6, D14): run at SubagentStop by hooks/oss-verdict-capture.sh through
 * the bundle dist/cli/verdict-capture.cjs, on the recorded node (D21).
 *
 * Contract (PLAN T19, fixed 2026-11-18): the agent's final message ends with one fenced block whose info string is
 * `oss-verdict`, holding `{"verdict":"pass"|"fail","findings":{"critical":N,"high":N,"medium":N,"low":N,"info":N}}`.
 * The block must be the final non-blank text of the final message, and a message with more than one oss-verdict block
 * records nothing (round 1 finding 6); nothing else in the message is read. The gate name comes from the
 * hook input's agent_type (REVIEW_AGENT_GATES), never from the block. One row goes to the owner-only ledger
 * `verdicts/<feature>`; the model never writes it. assemble-ship.ts reads it. The row records the tree the agent
 * reviewed (working tree minus .oss, from a temp index copy with no blob writes; the real index is never touched),
 * which binds it. Every git call shares one deadline (DEADLINE_MS). D48, D52: a capture that cannot build both trees
 * writes no row.
 *
 * The final message (D41): only the text of the last assistant message in agent_transcript_path, never stdin's
 * last_assistant_message (whoever runs the hook writes stdin): its trailing entries that share one message.id, and
 * nothing when they hold no text (T31). The path must resolve (realpath) under ~/.claude/projects, which the tool gate
 * protects. The transcript is JSONL, opened with O_NOFOLLOW, a regular file only, and only its last
 * TRANSCRIPT_TAIL_BYTES are read; a final message over that cap records nothing.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openLedger } from './ledger.js';
import { resolveFeature } from './feature.js';
import { gitBin } from './git-bin.js';
import { gitEnv } from './git.js';
import { resolveRepo } from './store.js';
import { loadSchema, validate } from './validate.js';

/**
 * Review agent (exact agent_type) -> the gate name ship's timeline uses (gate.txt table in commands/ship.md). Claude
 * Code sends a plugin agent's agent_type as `oss:<name>`; a project agent (.claude/agents) has no prefix and another
 * plugin has its own, so only these exact types record a verdict (finding 5).
 */
export const REVIEW_AGENT_GATES: Readonly<Record<string, string>> = {
  'oss:code-reviewer': 'code-review',
  'oss:performance-auditor': 'performance',
  'oss:security-auditor': 'security',
  'oss:penetration-tester': 'pen-test',
};

export const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

export type CaptureOutcome =
  | { captured: true; gate: string; feature: string }
  | { captured: false; reason: string };

export interface CaptureOptions {
  now?: () => Date;
  /** The one deadline every git call of this capture shares (performance L1); DEADLINE_MS by default. */
  deadlineMs?: number;
  /**
   * When the deadline starts, in epoch ms (performance LOW 1): the CLI passes its process start, so node start,
   * resolveRepo, resolveFeature and the ledger key spend from the same budget; the call's own start by default.
   */
  startMs?: number;
}

/**
 * Well under the hook's own 7 s bound (oss-verdict-capture.sh; hooks.json allows 10 s), counted from the process start,
 * so the hook never kills a capture mid-write; a capture that runs out of time writes no row (D48).
 */
export const DEADLINE_MS = 3500;
/** A changed file over this is not hashed: the tree is '' and no row is written (D52). */
const BIG_FILE_BYTES = 50 * 1024 * 1024;
/** Performance LOW 2: over this many changed paths, or this many bytes of changed files in all, the tree is '' at once (D52: no row). */
const MAX_CHANGED_PATHS = 20_000;
const MAX_CHANGED_BYTES = 500 * 1024 * 1024;
/** Temp index folders older than this in the known folder are left over from a killed capture, and removed. */
const STALE_TMP_MS = 10 * 60 * 1000;

const COUNT = { type: 'integer', minimum: 0 };
const VERDICT_SCHEMA = loadSchema({
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    findings: {
      type: 'object',
      additionalProperties: false,
      required: ['critical', 'high', 'medium', 'low', 'info'],
      properties: { critical: COUNT, high: COUNT, medium: COUNT, low: COUNT, info: COUNT },
    },
  },
});

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const OPENER_RE = /^```oss-verdict[ \t]*$/;

function plainId(v: unknown): string {
  return typeof v === 'string' && ID_RE.test(v) ? v : '';
}

/** The gate for an exact review agent_type, else null. */
export function gateForAgent(agentType: unknown): string | null {
  if (typeof agentType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(REVIEW_AGENT_GATES, agentType) ? REVIEW_AGENT_GATES[agentType] : null;
}

/**
 * D41: the transcript's real path when `file` is an absolute path, not itself a link, that resolves (realpath) under
 * the real ~/.claude/projects, which the tool gate protects; null otherwise (a symlinked folder cannot lead out).
 * D47: a hard link (nlink over 1) is refused too, so a file written outside the protected folder cannot pass as one.
 */
function projectsTranscript(file: unknown): string | null {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
  try {
    const root = fs.realpathSync(path.join(os.homedir(), '.claude', 'projects'));
    const real = fs.realpathSync(file);
    const st = fs.lstatSync(file);
    return real.startsWith(root + path.sep) && !st.isSymbolicLink() && st.nlink <= 1 ? real : null;
  } catch {
    return null;
  }
}

/** The text of the last assistant entry with text in the tail of a JSONL transcript; null when unsafe or absent. */
function transcriptMessage(input: unknown): string | null {
  const file = projectsTranscript(input);
  if (file === null) return null;
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    return null;
  }
  let text: string;
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    const len = Math.min(st.size, TRANSCRIPT_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    const got = fs.readSync(fd, buf, 0, len, st.size - len);
    text = buf.subarray(0, got).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
  const lines = text.split('\n');
  // The final message is the last assistant entry plus the assistant entries before it that share its message.id
  // (one entry per content block: thinking, text, tool_use). Only their text blocks count; a final message with no
  // text (e.g. only a tool_use) gives null, never an earlier message's text (T31). A tail that starts mid-file starts
  // mid-line: that first piece is not a whole entry, and does not parse.
  let lastId: unknown;
  const parts: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: unknown;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const { type, message } = entry as { type?: unknown; message?: { id?: unknown; content?: unknown } };
    if (type !== 'assistant') {
      if (lastId !== undefined && type === 'user') break;
      continue;
    }
    const id = message?.id;
    if (lastId === undefined) lastId = id ?? null;
    else if (lastId === null || id !== lastId) break;
    const content = Array.isArray(message?.content) ? (message.content as Array<{ type?: unknown; text?: unknown }>) : [];
    const texts = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text as string);
    parts.unshift(...texts);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/** D41: the final message comes only from agent_transcript_path, never from stdin's last_assistant_message. */
function finalMessage(input: Record<string, unknown>): string | null {
  return transcriptMessage(input.agent_transcript_path);
}

/**
 * The `oss-verdict` block that ends the text (its final non-blank lines): 'none' when the text does not end with one,
 * 'multiple' when the text holds more than one oss-verdict opener line, 'invalid' when the block is not the contract.
 * Linear: the closing fence is the last line, its opener the nearest earlier fence line (finding 6, no regex scan).
 */
export function lastVerdictBlock(
  text: string,
): { verdict: 'pass' | 'fail'; findings: Record<string, number> } | 'none' | 'multiple' | 'invalid' {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.filter((l) => OPENER_RE.test(l)).length > 1) return 'multiple';
  const close = lines.length - 1;
  if (close < 1 || lines[close].trimEnd() !== '```') return 'none';
  let open = close - 1;
  while (open >= 0 && !lines[open].startsWith('```')) open--;
  if (open < 0 || !OPENER_RE.test(lines[open])) return 'none';
  let value: unknown;
  try {
    value = JSON.parse(lines.slice(open + 1, close).join('\n'));
  } catch {
    return 'invalid';
  }
  if (!validate(VERDICT_SCHEMA, value).ok) return 'invalid';
  return value as { verdict: 'pass' | 'fail'; findings: Record<string, number> };
}

const TREE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Milliseconds left of the capture's one shared deadline. */
type Deadline = () => number;

function deadlineOf(opts: CaptureOptions): Deadline {
  const end = (opts.startMs ?? Date.now()) + (opts.deadlineMs ?? DEADLINE_MS);
  return () => end - Date.now();
}

/**
 * D56: the fixed PATH capture's git runs its helpers from, nothing taken from the caller. The Homebrew folders let a
 * clean filter such as `git-lfs filter-process` run, so an LFS repo records its fails; the git binary itself is still
 * gitBin (D33).
 */
const CAPTURE_GIT_PATH = '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin';

/**
 * `git <args>` in repo: the fixed-path git (gitBin, never PATH; pen N3) with PATH=CAPTURE_GIT_PATH, GIT_* removed plus
 * `extra`, no fsmonitor or hooks, bounded by the time left; raw stdout, or null on any failure or when time is up.
 */
function boundedGit(repo: string, args: string[], extra: NodeJS.ProcessEnv, left: Deadline, input?: Buffer): Buffer | null {
  const git = gitBin();
  // spawnSync needs a whole number; the CLI's process-start time (performance.timeOrigin) is fractional.
  const timeout = Math.floor(left());
  if (git === '' || timeout <= 0) return null;
  // gitEnv drops every caller GIT_* and sets D51's GIT_NO_REPLACE_OBJECTS and GIT_GRAFT_FILE.
  const env = { ...gitEnv(), GIT_CONFIG_NOSYSTEM: '1', PATH: CAPTURE_GIT_PATH, ...extra };
  const r = spawnSync(git, ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.error === undefined && r.status === 0 ? r.stdout : null;
}

function gitText(repo: string, args: string[], left: Deadline): string | null {
  return boundedGit(repo, args, {}, left)?.toString('utf-8').trim() ?? null;
}

/** The known folder for temp index copies (performance L1): one per user under the OS temp folder. */
export function verdictTreeTmpRoot(): string {
  return path.join(os.tmpdir(), `oss-verdict-trees-${process.getuid?.() ?? 0}`);
}

/** A fresh temp folder in the known folder, after removing its stale entries; null when the folder is not ours. */
function treeTmpDir(): string | null {
  const root = verdictTreeTmpRoot();
  try {
    fs.mkdirSync(root, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return null;
  }
  const st = fs.lstatSync(root);
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) return null;
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    const e = fs.lstatSync(p, { throwIfNoEntry: false });
    if (e !== undefined && Date.now() - e.mtimeMs > STALE_TMP_MS) fs.rmSync(p, { recursive: true, force: true });
  }
  return fs.mkdtempSync(path.join(root, 'tree-'));
}

/**
 * D53: the user's global ignore file when it exists: core.excludesFile from the global config only (~/.gitconfig and
 * $XDG_CONFIG_HOME/git/config, with their includes; gitEnv drops GIT_CONFIG_GLOBAL; git expands a leading ~), else
 * git's default, $XDG_CONFIG_HOME/git/ignore or ~/.config/git/ignore; null otherwise. Security LOW-1 (round 8): the
 * repo's own .git/config is never read for it, so a repo-local setting hides nothing, as with info/exclude.
 */
function globalIgnoreFile(repo: string, left: Deadline): string | null {
  const xdg = process.env.XDG_CONFIG_HOME;
  const fallback = path.join(xdg !== undefined && xdg !== '' ? xdg : path.join(os.homedir(), '.config'), 'git', 'ignore');
  const set = gitText(repo, ['config', '--global', '--includes', '--type=path', '--get', 'core.excludesFile'], left);
  const file = path.resolve(repo, set !== null && set !== '' ? set : fallback);
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true ? file : null;
}

/** The index entries whose bits hide an edit (D51): assume-unchanged, and skip-worktree ones that are on disk. */
interface HidingBits {
  assumed: string[];
  skipped: string[];
}

/**
 * D51 (security M1b): the entries of `index` whose assume-unchanged or skip-worktree bit would hide an edit from
 * `ls-files -m`. `ls-files -v` tags an assume-unchanged entry in lowercase and a skip-worktree one as S or s. A
 * skip-worktree file that is not on disk is left out: a sparse checkout leaves it off, it is not a deletion.
 * Performance low 2 (round 8): read once per capture, for both temp indexes, and a folder found missing answers for
 * every path under it with no lstat. Null when git fails or time is up.
 */
function hidingBits(repo: string, index: string, left: Deadline): HidingBits | null {
  const listed = boundedGit(repo, ['ls-files', '-z', '-v'], { GIT_INDEX_FILE: index }, left);
  if (listed === null) return null;
  // Pen LOW 3 (round 9): lstat throws ENOTDIR, despite throwIfNoEntry, when a file sits where a parent folder was (a
  // sparse checkout's off-disk folder named like an untracked file); any error counts as not on disk.
  const onDisk = (p: string): boolean => {
    try {
      return fs.lstatSync(path.join(repo, p), { throwIfNoEntry: false }) !== undefined;
    } catch {
      return false;
    }
  };
  const dirOnDisk = new Map<string, boolean>();
  const present = (dir: string): boolean => {
    if (dir === '.') return true;
    let known = dirOnDisk.get(dir);
    if (known === undefined) {
      known = present(path.dirname(dir)) && onDisk(dir);
      dirOnDisk.set(dir, known);
    }
    return known;
  };
  const bits: HidingBits = { assumed: [], skipped: [] };
  for (const e of listed.toString('utf-8').split('\0')) {
    if (e.length < 3) continue;
    const p = e.slice(2);
    if (e[0] !== e[0].toUpperCase()) bits.assumed.push(p);
    if ((e[0] === 'S' || e[0] === 's') && present(path.dirname(p)) && onDisk(p)) {
      bits.skipped.push(p);
    }
  }
  return bits;
}

/** Clears `bits` in the temp index `env` names, so `ls-files -m` sees the edits they would hide; false on failure. */
function clearHidingBits(repo: string, env: NodeJS.ProcessEnv, bits: HidingBits, left: Deadline): boolean {
  // One flag per call: update-index applies only the last of --no-assume-unchanged and --no-skip-worktree.
  const clear = (flag: string, paths: string[]): boolean =>
    paths.length === 0 || boundedGit(repo, ['update-index', flag, '-z', '--stdin'], env, left, Buffer.from(paths.join('\0') + '\0')) !== null;
  return clear('--no-assume-unchanged', bits.assumed) && clear('--no-skip-worktree', bits.skipped);
}

/** The NUL-separated paths of a git `-z` listing, without duplicates. */
function pathList(listed: Buffer): string[] {
  const paths = new Set(listed.toString('utf-8').split('\0'));
  paths.delete('');
  return [...paths];
}

/**
 * The tree of temp index `tmpIndex` with `paths` updated from disk, written WITHOUT blobs (performance M1): the paths go
 * to `update-index --info-only` (hashes, no object writes into .git/objects), then `write-tree --missing-ok`. Only tree
 * objects are written to .git/objects; with git-lfs on PATH (D56) hashing an LFS-tracked file through its clean filter
 * also writes that file's LFS object into .git/lfs/objects (perf I1, accepted under D56). '' when git cannot build it
 * in time, a path is over BIG_FILE_BYTES, or the list is over MAX_CHANGED_PATHS paths or MAX_CHANGED_BYTES in all
 * (performance LOW 2: checked before update-index hashes anything); then no row is written (D52).
 */
function treeWith(repo: string, tmpIndex: string, paths: string[], left: Deadline): string {
  if (paths.length > MAX_CHANGED_PATHS) return '';
  let total = 0;
  for (const p of paths) {
    const size = fs.lstatSync(path.join(repo, p), { throwIfNoEntry: false })?.size ?? 0;
    total += size;
    if (size > BIG_FILE_BYTES || total > MAX_CHANGED_BYTES) return '';
  }
  const env = { GIT_INDEX_FILE: tmpIndex };
  if (paths.length > 0) {
    const args = ['update-index', '--add', '--remove', '--info-only', '-z', '--stdin'];
    if (boundedGit(repo, args, env, left, Buffer.from(paths.join('\0') + '\0')) === null) return '';
  }
  const tree = boundedGit(repo, ['write-tree', '--missing-ok'], env, left)?.toString('utf-8').trim() ?? null;
  return tree !== null && TREE_RE.test(tree) ? tree : '';
}

/**
 * Both trees the agent reviewed, from temp copies of the real index (the real index is never touched): `trackedTree`
 * with the modified and deleted paths (.oss included but never consulted), `tree` with those outside .oss plus the
 * untracked files not ignored. Performance LOW F2 (round 9): `ls-files -m` compares every stat-dirty file's content,
 * which runs its clean filter (an LFS repo hashes each touched file), so it runs once, on the first temp index after
 * its hiding bits are cleared. Performance info 2 (round 10): the second temp index is a copy of the first after its
 * update, with its changed .oss entries put back as the index had them, so each modified file is hashed once. Both ''
 * when any git step fails or time runs out before `tree`'s own build; `tree` alone is '' when only that last build
 * fails (D52: the caller records no row unless both are set).
 */
function reviewedTrees(repo: string, left: Deadline): { tree: string; trackedTree: string } {
  const none = { tree: '', trackedTree: '' };
  const index = gitText(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], left);
  if (index === null || left() <= 0) return none;
  const dir = treeTmpDir();
  if (dir === null) return none;
  try {
    const bits = hidingBits(repo, index, left);
    if (bits === null) return none;
    const trackedIndex = path.join(dir, 'index-tracked');
    const allIndex = path.join(dir, 'index-all');
    try {
      fs.copyFileSync(index, trackedIndex);
    } catch {
      // no index yet (a repo with nothing staged): start from an empty one
    }
    if (!clearHidingBits(repo, { GIT_INDEX_FILE: trackedIndex }, bits, left)) return none;
    const changed = boundedGit(repo, ['ls-files', '-z', '-m', '-d'], { GIT_INDEX_FILE: trackedIndex }, left);
    if (changed === null) return none;
    const changedPaths = pathList(changed);
    const isOss = (p: string): boolean => p === '.oss' || p.startsWith('.oss/');
    // `tree` keeps .oss as the index has it: the index entries of the changed .oss paths, before they are updated.
    const ossChanged = new Set(changedPaths.filter(isOss));
    let ossEntries: string[] = [];
    if (ossChanged.size > 0) {
      const staged = boundedGit(repo, ['ls-files', '-z', '-s', '--', '.oss'], { GIT_INDEX_FILE: trackedIndex }, left);
      if (staged === null) return none;
      ossEntries = staged.toString('utf-8').split('\0').filter((e) => ossChanged.has(e.slice(e.indexOf('\t') + 1)));
    }
    // D52: both trees are needed, so the second is skipped when the first cannot be built.
    const trackedTree = treeWith(repo, trackedIndex, changedPaths, left);
    if (trackedTree === '') return none;
    // Perf info 2 (round 10): `tree` starts from the updated tracked index, so no modified file is hashed (its clean
    // filter run) a second time; its .oss entries are put back as they were.
    try {
      fs.copyFileSync(trackedIndex, allIndex);
    } catch {
      // still no index: the second tree starts from an empty one too
    }
    if (ossEntries.length > 0) {
      const restore = ['update-index', '-z', '--index-info'];
      if (boundedGit(repo, restore, { GIT_INDEX_FILE: allIndex }, left, Buffer.from(ossEntries.join('\0') + '\0')) === null) return none;
    }
    // D51, D53: untracked files are left out by the repo's .gitignore files and the user's global ignore file, never by
    // the repo-local .git/info/exclude.
    const global = globalIgnoreFile(repo, left);
    const untracked = boundedGit(repo, ['-c', 'core.excludesFile=/dev/null', 'ls-files', '-z', '-o', '--exclude-per-directory=.gitignore',
      ...(global === null ? [] : [`--exclude-from=${global}`]), '--', '.', ':(exclude).oss'], { GIT_INDEX_FILE: allIndex }, left);
    if (untracked === null) return none;
    return { tree: treeWith(repo, allIndex, pathList(untracked), left), trackedTree };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Records the review agent's verdict block from a SubagentStop hook input. Never throws. */
export function captureVerdict(input: unknown, opts: CaptureOptions = {}): CaptureOutcome {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return { captured: false, reason: 'bad_input' };
    const hook = input as Record<string, unknown>;
    const gate = gateForAgent(hook.agent_type);
    if (gate === null) return { captured: false, reason: 'not_review_agent' };
    const text = finalMessage(hook);
    if (text === null) return { captured: false, reason: 'no_message' };
    const block = lastVerdictBlock(text);
    if (block === 'none') return { captured: false, reason: 'no_block' };
    if (block === 'multiple') return { captured: false, reason: 'multiple_blocks' };
    if (block === 'invalid') return { captured: false, reason: 'invalid_block' };

    const left = deadlineOf(opts);
    const cwd = typeof hook.cwd === 'string' && path.isAbsolute(hook.cwd) ? hook.cwd : process.cwd();
    const repo = resolveRepo(cwd);
    const feature = repo === null ? null : resolveFeature(repo);
    if (repo === null || feature === null) return { captured: false, reason: 'no_feature' };
    const ledger = openLedger(repo);
    const headSha = gitText(repo, ['rev-parse', '--verify', 'HEAD^{commit}'], left) ?? '';
    const trees = reviewedTrees(repo, left);
    // D48, D52: without both trees (git failed, a cap was hit, or the deadline ran out first), a row could never be
    // compared with the shipped code; no row is written, so the gate keeps its model line (D26).
    if (trees.tree === '' || trees.trackedTree === '') return { captured: false, reason: 'no_tree_or_head' };
    ledger.appendRow(`verdicts/${feature}`, {
      gate,
      verdict: block.verdict,
      findings: block.findings,
      agent: plainId(hook.agent_id),
      session: plainId(hook.session_id),
      ts: (opts.now ?? (() => new Date()))().toISOString(),
      // The HEAD at capture: ship commits after its reviews, so HEAD never decides alone; assemble-ship counts a
      // deletion as a change only for a path that was tracked, or in this commit's tree (pen N4).
      headSha,
      // The trees the agent reviewed (all files / tracked only). Passes never count (D45): a fail stays open until the
      // shipped code outside .oss differs from `tree` (the D45 build note's reviewedIsShipped rule).
      ...trees,
    });
    return { captured: true, gate, feature };
  } catch {
    return { captured: false, reason: 'error' };
  }
}
