/**
 * Review-agent verdict capture (R-257 T19, D6, D14): run at SubagentStop by hooks/oss-verdict-capture.sh through
 * the bundle dist/cli/verdict-capture.cjs, on the recorded node (D21).
 *
 * Contract (PLAN T19, fixed 2026-11-18): the agent's final message ends with one fenced block whose info string is
 * `oss-verdict`, holding `{"verdict":"pass"|"fail","findings":{"critical":N,"high":N,"medium":N,"low":N,"info":N}}`.
 * The LAST such block of the final message counts; nothing else in the message is read. The gate name comes from the
 * hook input's agent_type (REVIEW_AGENT_GATES), never from the block. One row goes to the owner-only ledger
 * `verdicts/<feature>`; the model never writes it. assemble-ship.ts reads it.
 *
 * The final message: the input's last_assistant_message when it is a string, else the text of the last assistant
 * message in agent_transcript_path: its trailing entries that share one message.id, and nothing when they hold no text
 * (T31). The transcript is JSONL, opened with O_NOFOLLOW, a regular file only, and only its last TRANSCRIPT_TAIL_BYTES
 * are read. Either one over that cap records nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openLedger } from './ledger.js';
import { resolveFeature } from './feature.js';
import { resolveRepo } from './store.js';
import { loadSchema, validate } from './validate.js';

/** Review agent (bare subagent_type) -> the gate name ship's timeline uses (gate.txt table in commands/ship.md). */
export const REVIEW_AGENT_GATES: Readonly<Record<string, string>> = {
  'code-reviewer': 'code-review',
  'performance-auditor': 'performance',
  'security-auditor': 'security',
  'penetration-tester': 'pen-test',
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
const BLOCK_RE = /^```oss-verdict[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm;

function plainId(v: unknown): string {
  return typeof v === 'string' && ID_RE.test(v) ? v : '';
}

/** The gate for a review agent's agent_type (with or without a plugin prefix), else null. */
export function gateForAgent(agentType: unknown): string | null {
  if (typeof agentType !== 'string') return null;
  const bare = agentType.slice(agentType.lastIndexOf(':') + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(REVIEW_AGENT_GATES, bare) ? REVIEW_AGENT_GATES[bare] : null;
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

/** The last `oss-verdict` block of the text: 'none' when there is none, 'invalid' when it is not the contract. */
export function lastVerdictBlock(text: string): { verdict: 'pass' | 'fail'; findings: Record<string, number> } | 'none' | 'invalid' {
  const matches = [...text.replace(/\r\n/g, '\n').matchAll(BLOCK_RE)];
  if (matches.length === 0) return 'none';
  let value: unknown;
  try {
    value = JSON.parse(matches[matches.length - 1][1]);
  } catch {
    return 'invalid';
  }
  if (!validate(VERDICT_SCHEMA, value).ok) return 'invalid';
  return value as { verdict: 'pass' | 'fail'; findings: Record<string, number> };
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
    });
    return { captured: true, gate, feature };
  } catch {
    return { captured: false, reason: 'error' };
  }
}
