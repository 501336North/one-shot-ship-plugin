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
 * reviewed (working tree minus .oss, from a temp index copy; the real index is never touched), which binds it.
 *
 * The final message: the input's last_assistant_message when it is a string, else the text of the last assistant
 * message in agent_transcript_path: its trailing entries that share one message.id, and nothing when they hold no text
 * (T31). The transcript is JSONL, opened with O_NOFOLLOW, a regular file only, and only its last TRANSCRIPT_TAIL_BYTES
 * are read. Either one over that cap records nothing.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openLedger } from './ledger.js';
import { resolveFeature } from './feature.js';
import { gitEnv, gitOut } from './git.js';
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
}

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

/** The text of the last assistant entry with text in the tail of a JSONL transcript; null when unsafe or absent. */
function transcriptMessage(file: unknown): string | null {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
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

function finalMessage(input: Record<string, unknown>): string | null {
  const last = input.last_assistant_message;
  if (typeof last === 'string') return Buffer.byteLength(last) > TRANSCRIPT_TAIL_BYTES ? null : last;
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

/** `git <args>` in repo with GIT_* removed plus `extra`, no fsmonitor or hooks, bounded; trimmed stdout or null. */
function boundedGit(repo: string, args: string[], extra: NodeJS.ProcessEnv, timeout: number): string | null {
  const env = { ...gitEnv(), GIT_CONFIG_NOSYSTEM: '1', ...extra };
  const r = spawnSync('git', ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout,
    maxBuffer: 64 * 1024,
  });
  return r.error === undefined && r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The tree the agent reviewed, written from a temp copy of the real index so the real index is never
 * touched: `all` stages tracked and untracked (not ignored) files (`add -A`, .oss excluded), `tracked` only tracked
 * ones (`add -u`, .oss included but never consulted).
 * '' when git cannot build it (that row never counts).
 */
function reviewedTree(repo: string, index: string, which: 'all' | 'tracked'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-verdict-tree-'));
  try {
    const tmpIndex = path.join(dir, 'index');
    try {
      fs.copyFileSync(index, tmpIndex);
    } catch {
      // no index yet (a repo with nothing staged): start from an empty one
    }
    const env = { GIT_INDEX_FILE: tmpIndex };
    // `add -u` takes no pathspec: with nothing tracked yet any pathspec errors. Its .oss entries are harmless, since
    // trackedTree is only asked about paths outside .oss.
    const args = which === 'all' ? ['add', '-A', '--', '.', ':(exclude).oss'] : ['add', '-u'];
    if (boundedGit(repo, args, env, 3000) === null) return '';
    const tree = boundedGit(repo, ['write-tree'], env, 2000);
    return tree !== null && TREE_RE.test(tree) ? tree : '';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Both reviewed trees (see reviewedTree); both '' when the index path cannot be read. */
function reviewedTrees(repo: string): { tree: string; trackedTree: string } {
  const index = boundedGit(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], {}, 2000);
  if (index === null) return { tree: '', trackedTree: '' };
  return { tree: reviewedTree(repo, index, 'all'), trackedTree: reviewedTree(repo, index, 'tracked') };
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

    const cwd = typeof hook.cwd === 'string' && path.isAbsolute(hook.cwd) ? hook.cwd : process.cwd();
    const repo = resolveRepo(cwd);
    const feature = repo === null ? null : resolveFeature(repo);
    if (repo === null || feature === null) return { captured: false, reason: 'no_feature' };
    openLedger(repo).appendRow(`verdicts/${feature}`, {
      gate,
      verdict: block.verdict,
      findings: block.findings,
      agent: plainId(hook.agent_id),
      session: plainId(hook.session_id),
      ts: (opts.now ?? (() => new Date()))().toISOString(),
      // For information only: the HEAD at capture (ship commits after its reviews, so HEAD never decides).
      headSha: gitOut(repo, ['rev-parse', '--verify', 'HEAD^{commit}']) ?? '',
      // The trees the agent reviewed (all files / tracked only); assemble-ship counts the row only when the shipped tree
      // outside .oss differs from `tree` by nothing but files that were untracked at review and left out (finding 4).
      ...reviewedTrees(repo),
    });
    return { captured: true, gate, feature };
  } catch {
    return { captured: false, reason: 'error' };
  }
}
