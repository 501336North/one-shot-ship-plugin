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
import { openLedger } from '../../src/phase-results/ledger.js';
import {
  captureVerdict,
  TRANSCRIPT_TAIL_BYTES,
  type CaptureOutcome,
} from '../../src/phase-results/verdict-capture.js';

const FEATURE = 'verdict-feat';
const NOW = new Date('2026-11-18T10:00:00.000Z');

let repo: string;
let home: string;
let savedHome: string | undefined;

function git(...args: string[]): void {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' });
}

beforeEach(() => {
  savedHome = process.env.HOME;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-capture-home-')));
  process.env.HOME = home;
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-capture-repo-')));
  git('init', '-q', '-b', 'main');
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

function capture(extra: Record<string, unknown>): CaptureOutcome {
  return captureVerdict(input(extra), { now: () => NOW });
}

function rows(): Array<Record<string, unknown>> {
  return openLedger(repo).readRows(`verdicts/${FEATURE}`);
}

/** A JSONL transcript whose last assistant entry holds `text`, after an optional earlier assistant entry `padding`. */
function transcript(text: string, padding = ''): string {
  const file = path.join(home, `transcript-${Math.random().toString(36).slice(2)}.jsonl`);
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
      },
    ]);
  });

  it('maps each review agent to the gate name ship writes on its timeline, with or without the oss: prefix', () => {
    const pairs: Array<[string, string]> = [
      ['code-reviewer', 'code-review'],
      ['oss:security-auditor', 'security'],
      ['penetration-tester', 'pen-test'],
      ['oss:performance-auditor', 'performance'],
    ];
    for (const [agentType, gate] of pairs) {
      capture({ agent_type: agentType, last_assistant_message: block({ verdict: 'fail', findings: COUNTS }) });
    }
    expect(rows().map((r) => r.gate)).toEqual(pairs.map(([, g]) => g));
  });

  it('uses the last oss-verdict block when the message holds more than one', () => {
    const first = block({ verdict: 'fail', findings: { ...COUNTS, critical: 9 } });
    const last = block({ verdict: 'pass', findings: COUNTS });
    capture({ last_assistant_message: message(first, '```json\n{"verdict":"fail"}\n```', last) });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ verdict: 'pass', findings: COUNTS });
  });

  it('reads the final assistant message from the agent transcript when last_assistant_message is absent', () => {
    const file = transcript(message(block({ verdict: 'fail', findings: COUNTS })));
    const out = capture({ agent_transcript_path: file });
    expect(out.captured).toBe(true);
    expect(rows()[0]).toMatchObject({ gate: 'code-review', verdict: 'fail', findings: COUNTS });
  });

  it('prefers last_assistant_message over the transcript when both are present', () => {
    const file = transcript(block({ verdict: 'fail', findings: COUNTS }));
    capture({ agent_transcript_path: file, last_assistant_message: block({ verdict: 'pass', findings: COUNTS }) });
    expect(rows()[0]).toMatchObject({ verdict: 'pass' });
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
    const link = path.join(home, 'link.jsonl');
    fs.symlinkSync(real, link);
    expect(capture({ agent_transcript_path: link })).toEqual({ captured: false, reason: 'no_message' });
    expect(rows()).toEqual([]);
  });

  it('refuses a transcript that is not a regular file', () => {
    const dir = path.join(home, 'adir.jsonl');
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

  it('records nothing when last_assistant_message is larger than the read cap', () => {
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
