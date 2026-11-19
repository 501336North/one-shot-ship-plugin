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
 * which binds it, and `start`: whether the agent's SubagentStart snapshot (captureStart, ledger marker
 * `verdict-start/<agent_id>`) exists and equals it (security L4). Every git call shares one deadline (DEADLINE_MS).
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
import { openLedger, type Ledger, type LedgerRow } from './ledger.js';
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

export type StartOutcome = { recorded: true } | { recorded: false; reason: string };

/**
 * Well under the hook's own 7 s bound (oss-verdict-capture.sh; hooks.json allows 10 s), counted from the process start,
 * so a slow repo records '' trees instead of no row.
 */
export const DEADLINE_MS = 3500;
/** A changed file over this is not hashed: the tree is '' and the row never counts (D26 label). */
const BIG_FILE_BYTES = 50 * 1024 * 1024;
/** Performance LOW 2: over this many changed paths, or this many bytes of changed files in all, the tree is '' at once. */
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
 */
function projectsTranscript(file: unknown): string | null {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
  try {
    const root = fs.realpathSync(path.join(os.homedir(), '.claude', 'projects'));
    const real = fs.realpathSync(file);
    return real.startsWith(root + path.sep) && !fs.lstatSync(file).isSymbolicLink() ? real : null;
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
 * `git <args>` in repo: the fixed-path git (gitBin, never PATH; pen N3) with PATH=/usr/bin:/bin, GIT_* removed plus
 * `extra`, no fsmonitor or hooks, bounded by the time left; raw stdout, or null on any failure or when time is up.
 */
function boundedGit(repo: string, args: string[], extra: NodeJS.ProcessEnv, left: Deadline, input?: Buffer): Buffer | null {
  const git = gitBin();
  // spawnSync needs a whole number; the CLI's process-start time (performance.timeOrigin) is fractional.
  const timeout = Math.floor(left());
  if (git === '' || timeout <= 0) return null;
  const env = { ...gitEnv(), GIT_CONFIG_NOSYSTEM: '1', PATH: '/usr/bin:/bin', ...extra };
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
 * The tree the agent reviewed, from a temp copy of the real index (the real index is never touched), written WITHOUT
 * blobs (performance M1): the changed paths (`all`: modified, deleted and untracked not ignored, .oss excluded;
 * `tracked`: modified and deleted, .oss included but never consulted) go to `update-index --info-only` (hashes, no
 * object writes), then `write-tree --missing-ok`. Only tree objects are written. '' when git cannot build it in time,
 * a changed file is over BIG_FILE_BYTES, or the changed list is over MAX_CHANGED_PATHS paths or MAX_CHANGED_BYTES in
 * all (performance LOW 2: checked before update-index hashes anything); that row never counts.
 */
function reviewedTree(repo: string, index: string, which: 'all' | 'tracked', dir: string, left: Deadline): string {
  const tmpIndex = path.join(dir, `index-${which}`);
  try {
    fs.copyFileSync(index, tmpIndex);
  } catch {
    // no index yet (a repo with nothing staged): start from an empty one
  }
  const env = { GIT_INDEX_FILE: tmpIndex };
  const list = which === 'all'
    ? ['ls-files', '-z', '-m', '-o', '-d', '--exclude-standard', '--', '.', ':(exclude).oss']
    : ['ls-files', '-z', '-m', '-d'];
  const changed = boundedGit(repo, list, env, left);
  if (changed === null) return '';
  const paths = new Set(changed.toString('utf-8').split('\0'));
  paths.delete('');
  if (paths.size > MAX_CHANGED_PATHS) return '';
  let total = 0;
  for (const p of paths) {
    const size = fs.lstatSync(path.join(repo, p), { throwIfNoEntry: false })?.size ?? 0;
    total += size;
    if (size > BIG_FILE_BYTES || total > MAX_CHANGED_BYTES) return '';
  }
  if (changed.length > 0) {
    const args = ['update-index', '--add', '--remove', '--info-only', '-z', '--stdin'];
    if (boundedGit(repo, args, env, left, changed) === null) return '';
  }
  const tree = boundedGit(repo, ['write-tree', '--missing-ok'], env, left)?.toString('utf-8').trim() ?? null;
  return tree !== null && TREE_RE.test(tree) ? tree : '';
}

/** Both reviewed trees (see reviewedTree); both '' when the index path cannot be read or time is up. */
function reviewedTrees(repo: string, left: Deadline): { tree: string; trackedTree: string } {
  const none = { tree: '', trackedTree: '' };
  const index = gitText(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], left);
  if (index === null || left() <= 0) return none;
  const dir = treeTmpDir();
  if (dir === null) return none;
  try {
    // The tracked tree first: its list is short and cheap, so a huge untracked set cannot spend its share (LOW 2).
    const trackedTree = reviewedTree(repo, index, 'tracked', dir, left);
    return { tree: reviewedTree(repo, index, 'all', dir, left), trackedTree };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A start snapshot older than this belongs to an agent that never stopped (performance INFO 7), and is removed. */
const STALE_START_MS = 24 * 60 * 60 * 1000;

/** Removes the ledger's verdict-start markers whose `ts` is over STALE_START_MS before `now` (or unreadable). */
function clearStaleStarts(ledger: Ledger, now: Date): void {
  const dir = path.join(ledger.dir, 'verdict-start');
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (st === undefined || st.isSymbolicLink() || !st.isDirectory()) return;
  for (const name of fs.readdirSync(dir)) {
    if (!ID_RE.test(name)) continue;
    const ts = ledger.readMarker(startMarker(name))?.ts;
    const at = typeof ts === 'string' ? Date.parse(ts) : NaN;
    if (Number.isNaN(at) || now.getTime() - at > STALE_START_MS) ledger.clearMarker(startMarker(name));
  }
}

/** The ledger marker holding a review agent's start snapshot (security L4), keyed by its agent_id. */
function startMarker(agent: string): string {
  return `verdict-start/${agent}`;
}

/**
 * Records a review agent's start snapshot from a SubagentStart hook input (security L4): its reviewed trees and HEAD (M1), in the
 * owner-only ledger marker `verdict-start/<agent_id>`. The stop row then says whether the agent's code changed while it
 * ran. Never throws.
 */
export function captureStart(input: unknown, opts: CaptureOptions = {}): StartOutcome {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return { recorded: false, reason: 'bad_input' };
    const hook = input as Record<string, unknown>;
    if (gateForAgent(hook.agent_type) === null) return { recorded: false, reason: 'not_review_agent' };
    const agent = plainId(hook.agent_id);
    if (agent === '') return { recorded: false, reason: 'no_agent_id' };
    const left = deadlineOf(opts);
    const cwd = typeof hook.cwd === 'string' && path.isAbsolute(hook.cwd) ? hook.cwd : process.cwd();
    const repo = resolveRepo(cwd);
    if (repo === null) return { recorded: false, reason: 'no_repo' };
    const headSha = gitText(repo, ['rev-parse', '--verify', 'HEAD^{commit}'], left) ?? '';
    const trees = reviewedTrees(repo, left);
    const ledger = openLedger(repo);
    const now = (opts.now ?? (() => new Date()))();
    clearStaleStarts(ledger, now);
    ledger.writeMarker(startMarker(agent), { ...trees, headSha, ts: now.toISOString() });
    return { recorded: true };
  } catch {
    return { recorded: false, reason: 'error' };
  }
}

/**
 * missing: there is no start snapshot. With both stop trees built, match when the snapshot's trees equal them. With a
 * stop tree missing ('', a no-tree row for D36), two empty snapshots prove nothing (code review M1), so match only when
 * the snapshot's HEAD is known and equals the stop's (no commit landed while the agent ran). Otherwise changed.
 */
function startState(
  snap: LedgerRow | null,
  trees: { tree: string; trackedTree: string },
  headSha: string,
): 'match' | 'changed' | 'missing' {
  if (snap === null) return 'missing';
  if (trees.tree !== '' && trees.trackedTree !== '') {
    return snap.tree === trees.tree && snap.trackedTree === trees.trackedTree ? 'match' : 'changed';
  }
  return headSha !== '' && snap.headSha === headSha ? 'match' : 'changed';
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
    const agent = plainId(hook.agent_id);
    const ledger = openLedger(repo);
    // Before the trees: a tree build that runs out of time still leaves the row its headSha (D36).
    const headSha = gitText(repo, ['rev-parse', '--verify', 'HEAD^{commit}'], left) ?? '';
    const trees = reviewedTrees(repo, left);
    const snap = agent === '' ? null : ledger.readMarker(startMarker(agent));
    if (agent !== '') ledger.clearMarker(startMarker(agent));
    ledger.appendRow(`verdicts/${feature}`, {
      gate,
      verdict: block.verdict,
      findings: block.findings,
      agent,
      session: plainId(hook.session_id),
      ts: (opts.now ?? (() => new Date()))().toISOString(),
      // For information only: the HEAD at capture (ship commits after its reviews, so HEAD never decides).
      // The HEAD at capture: ship commits after its reviews, so HEAD never decides alone; assemble-ship allows a
      // deletion only for a path absent from this commit's tree too (pen N4).
      headSha,
      // The trees the agent reviewed (all files / tracked only); assemble-ship counts a pass only when the shipped tree
      // outside .oss differs from `tree` by nothing but files that were untracked at review and left out (finding 4),
      // and only when `start` is match (security L4).
      ...trees,
      start: startState(snap, trees, headSha),
    });
    return { captured: true, gate, feature };
  } catch {
    return { captured: false, reason: 'error' };
  }
}
