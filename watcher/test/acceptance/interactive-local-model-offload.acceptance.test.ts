/**
 * @behavior Interactive routable agents actually RUN on their configured local model
 *           (e.g. gpt-oss@deepblue via the :3456 ModelProxy) instead of only printing a
 *           banner — by spawning a nested mini-claudish session.
 * @acceptance-criteria AC-OFFLOAD.1 through AC-OFFLOAD.3
 * @boundary CLI (watcher/src/cli/agent-offload.ts — the function an agent's Step 0.5 invokes)
 * @user-story As an OSS user who mapped an agent to a local model in ~/.oss/config.json,
 *             when that agent runs interactively, the work is reasoned by my local model,
 *             provably (a request lands on the proxy), and any failure silently falls back
 *             to native Claude so my workflow never breaks.
 *
 * London TDD, outside-in: the system boundary is `runAgentOffload`. Its collaborators —
 * routing resolution (checkAgentModel), the proxy health probe, the prompt-file read, and
 * the nested-process spawn — are injected and mocked. No real Claude, proxy, or deepblue.
 *
 * THIS TEST IS EXPECTED TO FAIL until watcher/src/cli/agent-offload.ts exists (RED).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Module under test does not exist yet — this import is the meaningful RED.
import { runAgentOffload } from '../../src/cli/agent-offload';
import type { CheckResult } from '../../src/cli/agent-model-check';

/** Build a fake child process that emits stdout/stderr then 'close' with the given exit code. */
function makeFakeChild(exitCode: number, stdout = '', stderr = '') {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  // Emit asynchronously so the awaiting runner has attached its listeners.
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });
  return child;
}

const ROUTED: CheckResult = {
  useProxy: true,
  model: 'ollama/gpt-oss:120b',
  provider: 'ollama',
  proxyUrl: 'http://localhost:3456',
};
const NATIVE: CheckResult = { useProxy: false };

describe('Interactive local-model offload (Acceptance)', () => {
  let spawnFn: ReturnType<typeof vi.fn>;
  let checkAgentModel: ReturnType<typeof vi.fn>;
  let isProxyReachable: ReturnType<typeof vi.fn>;
  let readPrompt: ReturnType<typeof vi.fn>;
  let startProxy: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnFn = vi.fn();
    checkAgentModel = vi.fn();
    isProxyReachable = vi.fn().mockResolvedValue(true);
    readPrompt = vi.fn().mockReturnValue('EXPERT PROMPT + TASK CONTEXT');
    startProxy = vi.fn().mockResolvedValue(undefined);
    sleep = vi.fn().mockResolvedValue(undefined); // no real delay in tests
  });

  afterEach(() => {
    delete process.env.OSS_OFFLOAD_ACTIVE;
  });

  const deps = () => ({ spawnFn, checkAgentModel, isProxyReachable, readPrompt, startProxy, sleep });

  describe('AC-OFFLOAD.1: offload runs on the configured local model', () => {
    it('GIVEN the agent is mapped to gpt-oss, WHEN run, THEN it spawns a nested claude session pointed at the proxy and returns the local output', async () => {
      // GIVEN — config maps oss:code-reviewer → gpt-oss (routing resolves useProxy:true)
      checkAgentModel.mockResolvedValue(ROUTED);
      spawnFn.mockReturnValue(makeFakeChild(0, 'CRITICAL: SQL injection in handler.ts:42'));

      // WHEN — the agent's Step 0.5 invokes the offload runner
      const result = await runAgentOffload(
        { agent: 'oss:code-reviewer', promptFile: '/tmp/p.txt' },
        deps(),
      );

      // THEN — the local model did the reasoning, and we relayed its output
      expect(result.offloaded).toBe(true);
      expect(result.output).toContain('SQL injection');

      // THEN — a nested `claude -p` was spawned, routed at the proxy (which force-selects the
      // local model). It must NOT pass a foreign --model — the Claude CLI rejects unknown ids.
      expect(spawnFn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = spawnFn.mock.calls[0];
      expect(cmd).toBe('claude');
      expect(args).toEqual(expect.arrayContaining(['-p', '--dangerously-skip-permissions']));
      expect(args).not.toContain('--model');
      // The base URL is what makes it hit the local model instead of Anthropic
      expect(opts.env.ANTHROPIC_BASE_URL).toBe('http://localhost:3456');
      // Recursion guard set so the nested session never re-offloads
      expect(opts.env.OSS_OFFLOAD_ACTIVE).toBe('1');
    });
  });

  describe('AC-OFFLOAD.2: default-OFF — no mapping means pure native Claude', () => {
    it('GIVEN no local-model mapping, WHEN run, THEN it offloads nothing and spawns no process', async () => {
      // GIVEN — a default customer config (no models.agents entry → useProxy:false)
      checkAgentModel.mockResolvedValue(NATIVE);

      // WHEN
      const result = await runAgentOffload(
        { agent: 'oss:code-reviewer', promptFile: '/tmp/p.txt' },
        deps(),
      );

      // THEN — the agent proceeds natively; nothing is spawned
      expect(result.offloaded).toBe(false);
      expect(spawnFn).not.toHaveBeenCalled();
    });
  });

  describe('AC-OFFLOAD.3: fallback safety net — a broken local route never breaks the agent', () => {
    it('GIVEN the nested session fails, WHEN run with fallback enabled, THEN it returns a clean native fallback and never throws', async () => {
      // GIVEN — routed, but the local model errors out (non-zero exit)
      checkAgentModel.mockResolvedValue(ROUTED);
      spawnFn.mockReturnValue(makeFakeChild(1, '', 'connection refused'));

      // WHEN / THEN — resolves (never rejects) with a native fallback signal
      const result = await runAgentOffload(
        { agent: 'oss:code-reviewer', promptFile: '/tmp/p.txt' },
        deps(),
      );

      expect(result.offloaded).toBe(false);
      expect(result.fallback).toBe(true);
    });

    it('GIVEN the proxy is down AND cannot be started, WHEN run, THEN it falls back natively without spawning a doomed session', async () => {
      // GIVEN — routed, but the proxy stays unreachable even after an auto-start attempt
      checkAgentModel.mockResolvedValue(ROUTED);
      isProxyReachable.mockResolvedValue(false);

      // WHEN
      const result = await runAgentOffload(
        { agent: 'oss:code-reviewer', promptFile: '/tmp/p.txt' },
        deps(),
      );

      // THEN — it tried to start the proxy, then cleanly fell back; no wasted nested spawn
      expect(startProxy).toHaveBeenCalled();
      expect(result.offloaded).toBe(false);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('proxy_down');
      expect(spawnFn).not.toHaveBeenCalled();
    });
  });

  describe('AC-OFFLOAD.7: auto-starts the proxy when it is not already running', () => {
    it('GIVEN the proxy is down but startable, WHEN run, THEN it auto-starts the proxy and offloads', async () => {
      // GIVEN — routed; proxy down at preflight, up after we start it
      checkAgentModel.mockResolvedValue(ROUTED);
      isProxyReachable.mockResolvedValueOnce(false).mockResolvedValue(true);
      spawnFn.mockReturnValue(makeFakeChild(0, 'findings from gpt-oss'));

      // WHEN
      const result = await runAgentOffload(
        { agent: 'oss:code-reviewer', promptFile: '/tmp/p.txt' },
        deps(),
      );

      // THEN — started the proxy for the configured model + port (3456 from ROUTED.proxyUrl),
      // then offloaded successfully.
      expect(startProxy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'ollama/gpt-oss:120b', port: 3456 }),
      );
      expect(result.offloaded).toBe(true);
      expect(result.output).toContain('findings from gpt-oss');
    });
  });
});
