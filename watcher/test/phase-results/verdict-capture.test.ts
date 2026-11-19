/**
 * @behavior When a review agent (code-reviewer, security-auditor, penetration-tester, performance-auditor) stops,
 *           the plugin reads the verdict block at the end of its final message and records it in the owner-only
 *           ledger, so ship's gate verdict comes from the agent itself, not from the main model's retelling.
 * @business-rule R-257 T19 (D6, D14): the block is the LAST fenced `oss-verdict` block of the final message,
 *           exactly `{"verdict":"pass"|"fail","findings":{critical,high,medium,low,info}}` (integers >= 0, no
 *           other keys). The gate name comes from the hook's agent_type, never from the block. Anything else
 *           (no block, bad JSON, extra keys, another agent, a linked or oversized transcript) records nothing.
 * @boundary watcher/src/phase-results/verdict-capture.ts (captureVerdict), with a real temp git repo and ledger.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { openLedger } from '../../src/phase-results/ledger.js';
import {
  captureVerdict,
  lastVerdictBlock,
  verdictTreeTmpRoot,
  DEADLINE_MS,
  TRANSCRIPT_TAIL_BYTES,
  type CaptureOutcome,
} from '../../src/phase-results/verdict-capture.js';

const FEATURE = 'verdict-feat';
const NOW = new Date('2026-11-18T10:00:00.000Z');

let repo: string;
let home: string;
let savedHome: string | undefined;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}

function headNow(): string {
  return git('rev-parse', 'HEAD');
}

beforeEach(() => {
  savedHome = process.env.HOME;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-capture-home-')));
  process.env.HOME = home;
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-capture-repo-')));
  git('init', '-q', '-b', 'main');
  // no detached auto gc/maintenance: it would still be writing .git when the temp repo is removed (the 2,000-file test)
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('checkout', '-q', '-b', `feat/${FEATURE}/ship`);
  fs.mkdirSync(path.join(repo, '.oss', 'dev', 'active', FEATURE), { recursive: true });
});
afterEach(() => {
  process.env.HOME = savedHome;
  for (const d of [repo, home]) fs.rmSync(d, { recursive: true, force: true });
});

const COUNTS = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function block(obj: unknown): string {
  return '```oss-verdict\n' + JSON.stringify(obj) + '\n```';
}

function message(...blocks: string[]): string {
  return ['Review done. Findings below.', ...blocks].join('\n\n');
}

function input(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: 'sess-1',
    hook_event_name: 'SubagentStop',
    agent_id: 'agent-7',
    agent_type: 'oss:code-reviewer',
    cwd: repo,
    ...extra,
  };
}

// ⚠ changes existing test: D41 (security M2) — the capture reads the final message only from the agent transcript, so
//   a case that names its message as last_assistant_message gets it written as a transcript under ~/.claude/projects.
function capture(extra: Record<string, unknown>): CaptureOutcome {
  const { last_assistant_message: said, ...rest } = extra;
  const viaTranscript = typeof said === 'string' ? { agent_transcript_path: transcript(said) } : {};
  return captureVerdict(input({ ...rest, ...viaTranscript }), { now: () => NOW });
}

function rows(): Array<Record<string, unknown>> {
  return openLedger(repo).readRows(`verdicts/${FEATURE}`);
}

/** A JSONL transcript whose last assistant entry holds `text`, after an optional earlier assistant entry `padding`. */
function projectsDir(): string {
  const dir = path.join(home, '.claude', 'projects', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function transcript(text: string, padding = ''): string {
  const file = path.join(projectsDir(), `transcript-${Math.random().toString(36).slice(2)}.jsonl`);
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'review this' } }),
    ...(padding === '' ? [] : [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: padding }] } })]),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }),
  ];
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('captureVerdict: what gets recorded', () => {
  it('records one ledger row for a valid block: gate from agent_type, verdict, findings, agent, session, time', () => {
    const out = capture({ last_assistant_message: message(block({ verdict: 'pass', findings: COUNTS })) });
    expect(out).toEqual({ captured: true, gate: 'code-review', feature: FEATURE });
    expect(rows()).toEqual([
      {
        gate: 'code-review',
        verdict: 'pass',
        findings: COUNTS,
        agent: 'agent-7',
        session: 'sess-1',
        ts: NOW.toISOString(),
        // ⚠ changes existing test: finding 4 (round 1 security, coordinator fix) — the row records the reviewed tree
        //   (working tree minus .oss) that assemble binds it by, and the HEAD for information only
        headSha: headNow(),
        tree: git('rev-parse', 'HEAD^{tree}'),
        trackedTree: git('rev-parse', 'HEAD^{tree}'),
        // ⚠ changes existing test: D45 dead code — the row no longer carries `start` (it was 'missing'): since D45 the
        //   assembler never reads it, and the SubagentStart snapshot is gone.
      },
    ]);
  });

  // ⚠ changes existing test: finding 5 (round 1 security) — only the exact oss: plugin agent types count; Claude Code
  //   sends plugin agents as `oss:<name>` (real subagent meta.json agentType), so bare names no longer map.
  it('maps each oss: review agent to the gate name ship writes on its timeline', () => {
    const pairs: Array<[string, string]> = [
      ['oss:code-reviewer', 'code-review'],
      ['oss:security-auditor', 'security'],
      ['oss:penetration-tester', 'pen-test'],
      ['oss:performance-auditor', 'performance'],
    ];
    for (const [agentType, gate] of pairs) {
      capture({ agent_type: agentType, last_assistant_message: block({ verdict: 'fail', findings: COUNTS }) });
    }
    expect(rows().map((r) => r.gate)).toEqual(pairs.map(([, g]) => g));
  });

  // ⚠ changes existing test: finding 6 (round 1 security, INFO) — a message with more than one oss-verdict block
  //   records nothing, so a quoted or earlier block can never be mistaken for the agent's verdict.
  it('records nothing when the message holds more than one oss-verdict block', () => {
    const first = block({ verdict: 'fail', findings: { ...COUNTS, critical: 9 } });
    const last = block({ verdict: 'pass', findings: COUNTS });
    expect(capture({ last_assistant_message: message(first, '```json\n{"verdict":"fail"}\n```', last) })).toEqual({
      captured: false,
      reason: 'multiple_blocks',
    });
    expect(rows()).toEqual([]);
  });

  it('accepts a block followed only by blank lines, and CRLF line ends', () => {
    expect(capture({ last_assistant_message: message(block({ verdict: 'pass', findings: COUNTS })).replace(/\n/g, '\r\n') + '\r\n\n  \n' }).captured).toBe(true);
  });

  // Finding 6 (INFO): the verdict is the final non-blank text of the final message, never a block with prose after it.
  it('records nothing when text follows the block', () => {
    const text = message(block({ verdict: 'pass', findings: COUNTS })) + '\n\nActually, one more thing.';
    expect(capture({ last_assistant_message: text })).toEqual({ captured: false, reason: 'no_block' });
  });

  it('records nothing when the final fenced block is another language', () => {
    const text = message(block({ verdict: 'pass', findings: COUNTS }), '```json\n{}\n```');
    expect(capture({ last_assistant_message: text }).captured).toBe(false);
    expect(rows()).toEqual([]);
  });

  // Finding 6 (LOW, ReDoS): the scan is linear, so a hostile final message cannot stall the SubagentStop hook.
  // ⚠ changes existing test: performance INFO 8 (round 3) — 50 ms was a wall-time bound a loaded machine could miss;
  //   500 ms still proves the scan is linear (a quadratic scan of 256 KB takes far longer).
  it('scans 256 KB of unclosed openers in under 500 ms', () => {
    const hostile = '```oss-verdict\n'.repeat(Math.floor((256 * 1024) / 15));
    const t0 = performance.now();
    lastVerdictBlock(hostile);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('reads the final assistant message from the agent transcript when last_assistant_message is absent', () => {
    const file = transcript(message(block({ verdict: 'fail', findings: COUNTS })));
    const out = capture({ agent_transcript_path: file });
    expect(out.captured).toBe(true);
    expect(rows()[0]).toMatchObject({ gate: 'code-review', verdict: 'fail', findings: COUNTS });
  });

  // T31 (real transcripts): the final message is the last assistant entry, with the entries before it that share its
  // message.id (Claude Code writes one API message as one entry per content block: thinking, text, tool_use).
  // ⚠ changes existing test: D41 — transcripts live under ~/.claude/projects.
  function rawTranscript(entries: Array<{ id: string; content: Array<Record<string, unknown>> }>): string {
    const file = path.join(projectsDir(), `raw-${Math.random().toString(36).slice(2)}.jsonl`);
    const lines = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'review this' } })];
    for (const e of entries) {
      lines.push(JSON.stringify({ type: 'assistant', message: { id: e.id, role: 'assistant', content: e.content } }));
      lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }));
    }
    lines.pop();
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  }
  const VALID = block({ verdict: 'pass', findings: COUNTS });

  it('T31: a final entry holding only a tool_use records nothing, even when an earlier entry holds a block', () => {
    const file = rawTranscript([
      { id: 'msg_1', content: [{ type: 'text', text: message(VALID) }] },
      { id: 'msg_2', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: VALID } }] },
    ]);
    expect(capture({ agent_transcript_path: file })).toEqual({ captured: false, reason: 'no_message' });
    expect(rows()).toEqual([]);
  });

  it('T31: a final message split into a thinking entry and a text entry with the same message.id is captured', () => {
    const file = path.join(projectsDir(), 'split.jsonl');
    const entry = (content: Array<Record<string, unknown>>): string =>
      JSON.stringify({ type: 'assistant', message: { id: 'msg_9', role: 'assistant', content } });
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'assistant', message: { id: 'msg_8', role: 'assistant', content: [{ type: 'text', text: 'working' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
      entry([{ type: 'thinking', thinking: 'done' }]),
      entry([{ type: 'text', text: message(VALID) }]),
    ].join('\n') + '\n');
    expect(capture({ agent_transcript_path: file }).captured).toBe(true);
    expect(rows()[0]).toMatchObject({ verdict: 'pass', findings: COUNTS });
  });

  it('T31: the text of the final message counts when its last entry is a tool_use with the same message.id', () => {
    const file = path.join(projectsDir(), 'text-then-tool.jsonl');
    const entry = (content: Array<Record<string, unknown>>): string =>
      JSON.stringify({ type: 'assistant', message: { id: 'msg_9', role: 'assistant', content } });
    fs.writeFileSync(file, [entry([{ type: 'text', text: message(VALID) }]), entry([{ type: 'tool_use', name: 'X', input: {} }])].join('\n') + '\n');
    expect(capture({ agent_transcript_path: file }).captured).toBe(true);
  });

  it('T31: a block in an earlier message with another message.id is never the final message', () => {
    const file = rawTranscript([
      { id: 'msg_1', content: [{ type: 'text', text: message(VALID) }] },
      { id: 'msg_2', content: [{ type: 'text', text: 'All done, no verdict block here.' }] },
    ]);
    expect(capture({ agent_transcript_path: file })).toEqual({ captured: false, reason: 'no_block' });
  });

  // ⚠ changes existing test: D41 (security M2) — the verdict text comes only from the transcript, never from stdin's
  //   last_assistant_message (it was "prefers last_assistant_message over the transcript when both are present").
  it('reads only the transcript, even when last_assistant_message holds another block', () => {
    const file = transcript(block({ verdict: 'fail', findings: COUNTS }));
    captureVerdict(input({ agent_transcript_path: file, last_assistant_message: block({ verdict: 'pass', findings: COUNTS }) }), { now: () => NOW });
    expect(rows()[0]).toMatchObject({ verdict: 'fail' });
  });
});

/**
 * D41 (security M2, CLI part): the hook input on stdin can be written by whoever runs the hook, so the verdict text is
 * read only from the agent's own transcript, agent_transcript_path, and only when that path resolves (realpath, so no
 * symlinked folder can lead out) under ~/.claude/projects, which the tool gate protects. Anything else records nothing.
 */
describe('captureVerdict: the verdict comes only from the agent transcript under ~/.claude/projects (D41)', () => {
  const PASS = block({ verdict: 'pass', findings: COUNTS });

  it('a last_assistant_message alone records nothing', () => {
    expect(captureVerdict(input({ last_assistant_message: PASS }), { now: () => NOW })).toEqual({ captured: false, reason: 'no_message' });
    expect(rows()).toEqual([]);
  });

  it('a transcript outside ~/.claude/projects records nothing', () => {
    const file = path.join(home, 'elsewhere.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: PASS }] } }) + '\n');
    expect(captureVerdict(input({ agent_transcript_path: file }), { now: () => NOW })).toEqual({ captured: false, reason: 'no_message' });
  });

  it('a path under ~/.claude/projects through a symlinked folder that leads out records nothing', () => {
    const outside = fs.mkdtempSync(path.join(home, 'outside-'));
    fs.writeFileSync(path.join(outside, 't.jsonl'), JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: PASS }] } }) + '\n');
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    fs.symlinkSync(outside, path.join(home, '.claude', 'projects', 'escape'));
    const file = path.join(home, '.claude', 'projects', 'escape', 't.jsonl');
    expect(captureVerdict(input({ agent_transcript_path: file }), { now: () => NOW })).toEqual({ captured: false, reason: 'no_message' });
  });

  it('a relative path, or one with .. that leaves ~/.claude/projects, records nothing', () => {
    const file = transcript(PASS);
    const rel = path.relative(repo, file);
    expect(captureVerdict(input({ agent_transcript_path: rel }), { now: () => NOW }).captured).toBe(false);
    const dotdot = path.join(home, '.claude', 'projects', '..', '..', path.basename(file));
    fs.copyFileSync(file, path.join(home, path.basename(file)));
    expect(captureVerdict(input({ agent_transcript_path: dotdot }), { now: () => NOW }).captured).toBe(false);
  });

  it('a transcript under ~/.claude/projects is read', () => {
    expect(captureVerdict(input({ agent_transcript_path: transcript(PASS) }), { now: () => NOW }).captured).toBe(true);
  });
});

/**
 * Coordinator fix to finding 4: the row records `tree`, the working tree the agent reviewed (tracked and untracked,
 * not ignored, .oss excluded), built in a temporary index so the real index is never touched.
 */
describe('captureVerdict: the reviewed tree', () => {
  const VALID_BLOCK = block({ verdict: 'pass', findings: COUNTS });

  function treeOfCommitted(): string {
    git('add', '-A', '--', '.', ':(exclude).oss');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'snap');
    return git('rev-parse', 'HEAD^{tree}');
  }

  it('records the tree of uncommitted and untracked changes, leaving the real index untouched', () => {
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
    git('add', 'tracked.txt');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one, edited\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'new\n');
    fs.writeFileSync(path.join(repo, '.oss', 'dev', 'active', FEATURE, 'notes.md'), 'dev docs\n');
    const indexBefore = git('ls-files', '-s');
    const stagedBefore = git('diff', '--cached', '--name-status');

    expect(capture({ last_assistant_message: VALID_BLOCK }).captured).toBe(true);
    const tree = rows()[0].tree;

    expect(git('ls-files', '-s')).toBe(indexBefore);
    expect(git('diff', '--cached', '--name-status')).toBe(stagedBefore);
    const trackedTree = rows()[0].trackedTree;
    expect(tree).toBe(treeOfCommitted());
    // trackedTree: tracked files only (git add -u), so the untracked file is not in it, the edit is
    git('rm', '-q', '--cached', 'untracked.txt');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'tracked only');
    expect(trackedTree).toBe(git('rev-parse', 'HEAD^{tree}'));
  });

  it('a hook git cannot read the repo still records the row, with an empty tree that never counts', () => {
    fs.rmSync(path.join(repo, '.git', 'index'), { force: true });
    fs.writeFileSync(path.join(repo, '.git', 'index'), 'not an index');
    expect(capture({ last_assistant_message: VALID_BLOCK }).captured).toBe(true);
    expect(rows()[0].tree).toBe('');
    expect(rows()[0].trackedTree).toBe('');
  });

  it('a review-agent stop records its tree within a loose 1.5 s budget on a 2,000-file repo', () => {
    fs.mkdirSync(path.join(repo, 'src'));
    for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(repo, 'src', `f${i}.ts`), `export const v${i} = ${i};\n`);
    git('add', '-A');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'many');
    fs.writeFileSync(path.join(repo, 'src', 'f1.ts'), 'edited\n');
    const t0 = performance.now();
    expect(capture({ last_assistant_message: VALID_BLOCK }).captured).toBe(true);
    const ms = performance.now() - t0;
    console.log(`capture cost, 2,000-file repo with one edit: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
    expect(rows()[0].tree).toMatch(/^[0-9a-f]{40}$/);
    expect(rows()[0].trackedTree).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ⚠ changes existing test: D45 dead code — the "start snapshot (security L4)" block is removed with captureStart: since
//   D45 the assembler reads neither the start snapshot nor the row's `start`. A stop past its deadline is covered by the D48 cases below.

/**
 * Round 2 performance M1 and L1: the trees are built without writing blobs into .git/objects (ls-files, update-index
 * --info-only, write-tree --missing-ok), a file over 50 MB gives tree '' at once, the whole capture shares one
 * deadline, and its temp index folders live in one known folder whose stale entries (over 10 min) are removed.
 */
describe('captureVerdict: trees without blob writes (performance M1, L1)', () => {
  const VALID_BLOCK = block({ verdict: 'pass', findings: COUNTS });

  function blobId(content: string): string {
    return execFileSync('git', ['hash-object', '--stdin'], { cwd: repo, input: content, encoding: 'utf-8' }).trim();
  }
  function hasObject(id: string): boolean {
    try {
      execFileSync('git', ['cat-file', '-e', id], { cwd: repo, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // Behaviour: reviewing never fills the repo with junk objects.
  it('writes no blob for a modified or an untracked file', () => {
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
    git('add', 'tracked.txt');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'tracked');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), `modified ${Math.random()}\n`);
    fs.writeFileSync(path.join(repo, 'untracked.txt'), `untracked ${Math.random()}\n`);
    expect(capture({ last_assistant_message: VALID_BLOCK }).captured).toBe(true);
    expect(rows()[0].tree).toMatch(/^[0-9a-f]{40}$/);
    expect(hasObject(blobId(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf-8')))).toBe(false);
    expect(hasObject(blobId(fs.readFileSync(path.join(repo, 'untracked.txt'), 'utf-8')))).toBe(false);
  });

  // Rule: a changed file over 50 MB is not hashed; the row records tree '' (it never counts, D26 label).
  it('a changed file over 50 MB gives tree \'\' fast', () => {
    const fd = fs.openSync(path.join(repo, 'big.bin'), 'w');
    fs.ftruncateSync(fd, 51 * 1024 * 1024);
    fs.closeSync(fd);
    const t0 = performance.now();
    expect(capture({ last_assistant_message: VALID_BLOCK }).captured).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(rows()[0].tree).toBe('');
  });

  // D36: a no-tree pass can clear an earlier fail only on a new commit, so the big-file row must carry headSha.
  it('the big-file row (tree \'\') still records headSha', () => {
    const fd = fs.openSync(path.join(repo, 'big.bin'), 'w');
    fs.ftruncateSync(fd, 51 * 1024 * 1024);
    fs.closeSync(fd);
    capture({ last_assistant_message: VALID_BLOCK });
    expect(rows()[0]).toMatchObject({ tree: '', headSha: headNow() });
  });

  // ⚠ changes existing test: D48 ("Record nothing", replaces D43) — a capture past its deadline reads neither the tree
  //   nor HEAD, so it records no row (it was "records empty trees").
  it('a capture past its shared deadline records no row', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
    expect(captureVerdict(input({ agent_transcript_path: transcript(VALID_BLOCK) }), { now: () => NOW, deadlineMs: 0 })).toEqual({ captured: false, reason: 'no_tree_or_head' });
    expect(rows()).toEqual([]);
  });

  // Performance LOW 1 (round 3): the deadline ran from the git calls, after node start, resolveRepo, resolveFeature and
  //   the ledger key had spent theirs. It now runs from the process start the CLI passes (startMs).
  // ⚠ changes existing test: D48 — it was "... records empty trees and no headSha"; such a row is no longer written.
  it('a capture whose process started longer ago than the deadline records no row', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
    const file = transcript(VALID_BLOCK);
    expect(captureVerdict(input({ agent_transcript_path: file }), { now: () => NOW, startMs: Date.now() - DEADLINE_MS - 100 })).toEqual({ captured: false, reason: 'no_tree_or_head' });
    expect(rows()).toEqual([]);
  });

  // D48: when git rev-parse fails (here an unborn HEAD) and no tree can be built (an unreadable index), the fail could
  //   never be compared with the shipped code, so it would block the feature for good: no row is written.
  it('a capture that can read neither the tree nor HEAD records no row', () => {
    git('checkout', '-q', '--orphan', `feat/${FEATURE}/unborn`);
    fs.writeFileSync(path.join(repo, '.git', 'index'), 'not an index');
    expect(capture({ last_assistant_message: block({ verdict: 'fail', findings: COUNTS }) })).toEqual({ captured: false, reason: 'no_tree_or_head' });
    expect(rows()).toEqual([]);
  });

  // The CLI passes performance.timeOrigin, a fractional time: git's timeout must still be a whole number (it threw).
  it('a fractional process start still records the trees', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
    expect(captureVerdict(input({ agent_transcript_path: transcript(VALID_BLOCK) }), { now: () => NOW, startMs: Date.now() + 0.5 }).captured).toBe(true);
    expect(rows()[0].tree).toMatch(/^[0-9a-f]{40}$/);
  });

  it('the deadline leaves the CLI at least 3 s inside the hook\'s own bound', () => {
    const hook = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../hooks/oss-verdict-capture.sh'), 'utf-8');
    const bound = Number(/oss_run_bounded_rc (\d+) /.exec(hook)?.[1]);
    expect(DEADLINE_MS).toBeLessThanOrEqual(3500);
    expect(bound * 1000 - DEADLINE_MS).toBeGreaterThanOrEqual(3000);
    expect(bound).toBeLessThan(10); // hooks.json gives the hook 10 s
  });

  // Performance LOW 2 (round 3): a huge changed list was hashed in full by update-index before the deadline could stop
  //   it. Over 20,000 changed paths, or over 500 MB of changed files in all, the tree is '' at once; the tracked tree
  //   (built first, from the far shorter tracked list) still records.
  function trackedEdit(): void {
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
    git('add', 'tracked.txt');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'tracked');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'two\n');
  }

  it('over 500 MB of changed files in all gives tree \'\' but keeps the tracked tree', () => {
    trackedEdit();
    for (let i = 0; i < 11; i++) {
      const fd = fs.openSync(path.join(repo, `part-${i}.bin`), 'w');
      fs.ftruncateSync(fd, 49 * 1024 * 1024);
      fs.closeSync(fd);
    }
    expect(capture({ last_assistant_message: VALID_BLOCK }).captured).toBe(true);
    expect(rows()[0].tree).toBe('');
    expect(rows()[0].trackedTree).toMatch(/^[0-9a-f]{40}$/);
  });

  it('over 20,000 changed paths gives tree \'\' but keeps the tracked tree', () => {
    trackedEdit();
    const dir = path.join(repo, 'many');
    fs.mkdirSync(dir);
    for (let i = 0; i <= 20_000; i++) fs.writeFileSync(path.join(dir, `f${i}`), '');
    expect(capture({ last_assistant_message: VALID_BLOCK }).captured).toBe(true);
    expect(rows()[0].tree).toBe('');
    expect(rows()[0].trackedTree).toMatch(/^[0-9a-f]{40}$/);
  });

  it('removes temp index folders older than 10 minutes from the known folder, and keeps fresh ones', () => {
    const root = verdictTreeTmpRoot();
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stale = fs.mkdtempSync(path.join(root, 'tree-'));
    const fresh = fs.mkdtempSync(path.join(root, 'tree-'));
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    capture({ last_assistant_message: VALID_BLOCK });
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    fs.rmSync(fresh, { recursive: true, force: true });
  });
});

describe('captureVerdict: what records nothing', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['no block', { last_assistant_message: 'All good, no issues.' }, 'no_block'],
    ['malformed JSON', { last_assistant_message: '```oss-verdict\n{"verdict":"pass",\n```' }, 'invalid_block'],
    ['an extra top-level key (a gate name in the block is never read)', {
      last_assistant_message: block({ verdict: 'pass', findings: COUNTS, gate: 'security' }),
    }, 'invalid_block'],
    ['an extra severity key', {
      last_assistant_message: block({ verdict: 'pass', findings: { ...COUNTS, blocker: 1 } }),
    }, 'invalid_block'],
    ['a missing severity', {
      last_assistant_message: block({ verdict: 'pass', findings: { critical: 0, high: 0, medium: 0, low: 0 } }),
    }, 'invalid_block'],
    ['a negative count', {
      last_assistant_message: block({ verdict: 'pass', findings: { ...COUNTS, low: -1 } }),
    }, 'invalid_block'],
    ['a fractional count', {
      last_assistant_message: block({ verdict: 'pass', findings: { ...COUNTS, low: 1.5 } }),
    }, 'invalid_block'],
    ['a verdict other than pass or fail', {
      last_assistant_message: block({ verdict: 'ok', findings: COUNTS }),
    }, 'invalid_block'],
    ['an agent that is not a review agent', {
      agent_type: 'oss:typescript-pro', last_assistant_message: block({ verdict: 'pass', findings: COUNTS }),
    }, 'not_review_agent'],
    // Finding 5: a project agent (.claude/agents, no plugin prefix) or another plugin's agent named like a reviewer.
    ['a bare reviewer name (a project agent)', {
      agent_type: 'security-auditor', last_assistant_message: block({ verdict: 'pass', findings: COUNTS }),
    }, 'not_review_agent'],
    ['another plugin prefix', {
      agent_type: 'evil:code-reviewer', last_assistant_message: block({ verdict: 'pass', findings: COUNTS }),
    }, 'not_review_agent'],
    ['a nested prefix', {
      agent_type: 'x:oss:code-reviewer', last_assistant_message: block({ verdict: 'pass', findings: COUNTS }),
    }, 'not_review_agent'],
    ['a different case', {
      agent_type: 'oss:Code-Reviewer', last_assistant_message: block({ verdict: 'pass', findings: COUNTS }),
    }, 'not_review_agent'],
    ['no agent_type', {
      agent_type: undefined, last_assistant_message: block({ verdict: 'pass', findings: COUNTS }),
    }, 'not_review_agent'],
  ];
  for (const [name, extra, reason] of cases) {
    it(`records nothing for ${name}`, () => {
      expect(capture(extra)).toEqual({ captured: false, reason });
      expect(rows()).toEqual([]);
    });
  }

  it('records nothing when the input is not an object', () => {
    expect(captureVerdict('nope', { now: () => NOW })).toEqual({ captured: false, reason: 'bad_input' });
  });

  it('refuses a symlinked transcript', () => {
    const real = transcript(block({ verdict: 'pass', findings: COUNTS }));
    const link = path.join(projectsDir(), 'link.jsonl');
    fs.symlinkSync(real, link);
    expect(capture({ agent_transcript_path: link })).toEqual({ captured: false, reason: 'no_message' });
    expect(rows()).toEqual([]);
  });

  // D47 (security LOW): a hard link under ~/.claude/projects to a transcript written elsewhere (or to another agent's)
  // would let any file the model can write pass as an agent transcript; a transcript with more than one link is refused.
  it('refuses a hard-linked transcript', () => {
    const outside = path.join(home, 'forged.jsonl');
    fs.writeFileSync(outside, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: block({ verdict: 'pass', findings: COUNTS }) }] } }) + '\n');
    const link = path.join(projectsDir(), 'hardlink.jsonl');
    fs.linkSync(outside, link);
    expect(capture({ agent_transcript_path: link })).toEqual({ captured: false, reason: 'no_message' });
    expect(rows()).toEqual([]);
  });

  it('refuses a transcript that is not a regular file', () => {
    const dir = path.join(projectsDir(), 'adir.jsonl');
    fs.mkdirSync(dir);
    expect(capture({ agent_transcript_path: dir })).toEqual({ captured: false, reason: 'no_message' });
  });

  it('reads only the tail of a large transcript: a verdict at its end is still captured', () => {
    const file = transcript(block({ verdict: 'pass', findings: COUNTS }), 'x'.repeat(TRANSCRIPT_TAIL_BYTES * 2));
    expect(capture({ agent_transcript_path: file }).captured).toBe(true);
  });

  it('records nothing when the final message alone is larger than the read cap', () => {
    const huge = 'y'.repeat(TRANSCRIPT_TAIL_BYTES + 10) + '\n\n' + block({ verdict: 'pass', findings: COUNTS });
    const file = transcript(huge);
    expect(capture({ agent_transcript_path: file })).toEqual({ captured: false, reason: 'no_message' });
    expect(rows()).toEqual([]);
  });

  // ⚠ changes existing test: D41 — last_assistant_message is never read, so this message now arrives as a transcript.
  it('records nothing when the final message, sent as last_assistant_message, is larger than the read cap', () => {
    const huge = 'y'.repeat(TRANSCRIPT_TAIL_BYTES + 10) + '\n\n' + block({ verdict: 'pass', findings: COUNTS });
    expect(capture({ last_assistant_message: huge })).toEqual({ captured: false, reason: 'no_message' });
  });

  it('records nothing outside a repo with one resolvable feature', () => {
    fs.rmSync(path.join(repo, '.oss'), { recursive: true, force: true });
    expect(capture({ last_assistant_message: block({ verdict: 'pass', findings: COUNTS }) })).toEqual({
      captured: false,
      reason: 'no_feature',
    });
  });
});
