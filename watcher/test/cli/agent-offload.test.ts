/**
 * @behavior Pure helpers of the agent-offload runner: invocation building + result classifying.
 * @boundary CLI (unit)
 *
 * These document the contracts the acceptance test relies on. The end-to-end behaviour of
 * runAgentOffload is covered by
 *   test/acceptance/interactive-local-model-offload.acceptance.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  buildOffloadInvocation,
  classifyResult,
  parseOffloadArgs,
} from '../../src/cli/agent-offload';
import type { CheckResult } from '../../src/cli/agent-model-check';

const ROUTED: CheckResult = {
  useProxy: true,
  model: 'ollama/gpt-oss:120b',
  provider: 'ollama',
  proxyUrl: 'http://localhost:3456',
};

describe('buildOffloadInvocation', () => {
  it('targets the local model through the proxy and sets the recursion guard', () => {
    const inv = buildOffloadInvocation(ROUTED);
    expect(inv.cmd).toBe('claude');
    expect(inv.args).toEqual(['-p', '--dangerously-skip-permissions']);
    // Must NOT pass a foreign --model — the Claude CLI rejects unknown model ids client-side.
    expect(inv.args).not.toContain('--model');
    // The base URL is the actual offload lever; the guard prevents nested re-offload.
    expect(inv.env.ANTHROPIC_BASE_URL).toBe('http://localhost:3456');
    expect(inv.env.OSS_OFFLOAD_ACTIVE).toBe('1');
  });

  it('does not leak ANTHROPIC_MODEL into the nested session', () => {
    // The runner is spawned from inside a Claude Code session that may export an exotic model id
    // (e.g. claude-opus-4-8[1m]); the nested `claude -p` would reject it client-side. Clear it so
    // the nested session uses a clean default — the proxy force-selects the real local model anyway.
    const prev = process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8[1m]';
    try {
      const inv = buildOffloadInvocation(ROUTED);
      expect(inv.env.ANTHROPIC_MODEL).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_MODEL;
      else process.env.ANTHROPIC_MODEL = prev;
    }
  });

  it('does not leak the real Anthropic credentials into the nested session', () => {
    // The nested session talks only to the local proxy (which ignores auth) — it must not carry
    // the parent's real ANTHROPIC_API_KEY / AUTH_TOKEN to a localhost listener / redirected endpoint.
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevTok = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-REAL-secret-value';
    process.env.ANTHROPIC_AUTH_TOKEN = 'oauth-real-token';
    try {
      const inv = buildOffloadInvocation(ROUTED);
      expect(inv.env.ANTHROPIC_API_KEY).not.toBe('sk-ant-REAL-secret-value');
      expect(inv.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevTok === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = prevTok;
    }
  });
});

describe('classifyResult', () => {
  it('non-zero exit ⇒ spawn_error', () => {
    expect(classifyResult(1, 'whatever')).toBe('spawn_error');
  });
  it('exit 0 but empty/whitespace stdout ⇒ empty_output (gpt-oss tiny-budget guard)', () => {
    expect(classifyResult(0, '   \n')).toBe('empty_output');
  });
  it('exit 0 with content ⇒ success', () => {
    expect(classifyResult(0, 'CRITICAL: bug')).toBe('success');
  });
});

describe('parseOffloadArgs', () => {
  it('parses --agent / --prompt-file / --project-dir', () => {
    const p = parseOffloadArgs(['--agent', 'oss:code-reviewer', '--prompt-file', '/tmp/p.txt', '--project-dir', '/repo']);
    expect(p).toEqual({ agent: 'oss:code-reviewer', promptFile: '/tmp/p.txt', projectDir: '/repo' });
  });
});
