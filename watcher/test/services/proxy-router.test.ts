/**
 * @behavior The proxy router dispatches each /v1/messages request per-agent and falls back
 *           to Anthropic when the local model errors (if fallbackEnabled). Every decision and
 *           every fallback is logged LOUDLY so "zero Ollama" can never silently look like success.
 * @acceptance-criteria
 *   - local-mapped agent -> ollamaHandle(model); logs route=ollama.
 *   - claude/unmarked    -> passthrough; logs route=anthropic.
 *   - ollama throws + fallbackEnabled -> passthrough; logs fallback + reason.
 *   - ollama throws + !fallbackEnabled -> error propagates (no silent success).
 * @boundary Proxy routing + fallback orchestration (collaborators injected)
 */
import { describe, it, expect, vi } from 'vitest';
import { routeMessages } from '../../src/services/proxy-router.js';

const config = {
  models: {
    default: 'claude',
    fallbackEnabled: true,
    agents: { 'oss:code-reviewer': 'ollama/gpt-oss:120b', 'oss:test-engineer': 'claude' },
  },
};

function reqFor(agent?: string) {
  return { model: 'claude-x', system: agent ? `OSS-ROUTE-AGENT: ${agent}` : 'orchestrator', messages: [] };
}

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    ollamaHandle: vi.fn(async () => ({ via: 'ollama' })),
    passthrough: vi.fn(async () => ({ via: 'anthropic' })),
    log: vi.fn(),
    ...over,
  } as any;
}

describe('routeMessages: per-agent dispatch + fallback + loud log', () => {
  it('routes a local-mapped agent to Ollama and logs route=ollama', async () => {
    const deps = makeDeps();
    const out = await routeMessages(reqFor('oss:code-reviewer'), config, deps);
    expect(deps.ollamaHandle).toHaveBeenCalledTimes(1);
    expect(deps.ollamaHandle.mock.calls[0][0]).toBe('gpt-oss:120b');
    expect(deps.passthrough).not.toHaveBeenCalled();
    expect(out.route).toBe('ollama');
    expect(deps.log).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'oss:code-reviewer', model: 'gpt-oss:120b', route: 'ollama' })
    );
  });

  it('passes a claude-mapped agent through to Anthropic', async () => {
    const deps = makeDeps();
    const out = await routeMessages(reqFor('oss:test-engineer'), config, deps);
    expect(deps.passthrough).toHaveBeenCalledTimes(1);
    expect(deps.ollamaHandle).not.toHaveBeenCalled();
    expect(out.route).toBe('anthropic');
  });

  it('passes the unmarked orchestrator through to Anthropic', async () => {
    const deps = makeDeps();
    const out = await routeMessages(reqFor(undefined), config, deps);
    expect(deps.passthrough).toHaveBeenCalledTimes(1);
    expect(out.route).toBe('anthropic');
  });

  it('falls back to Anthropic when Ollama errors and fallbackEnabled, logging the reason', async () => {
    const deps = makeDeps({ ollamaHandle: vi.fn(async () => { throw new Error('ECONNREFUSED ollama'); }) });
    const out = await routeMessages(reqFor('oss:code-reviewer'), config, deps);
    expect(deps.passthrough).toHaveBeenCalledTimes(1);
    expect(out.route).toBe('anthropic');
    expect(out.fellBack).toBe(true);
    expect(deps.log).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'anthropic', fallback: true, reason: expect.stringContaining('ECONNREFUSED') })
    );
  });

  it('does NOT fall back when fallbackEnabled is false (no silent success)', async () => {
    const deps = makeDeps({ ollamaHandle: vi.fn(async () => { throw new Error('boom'); }) });
    const noFb = { models: { ...config.models, fallbackEnabled: false } };
    await expect(routeMessages(reqFor('oss:code-reviewer'), noFb, deps)).rejects.toThrow('boom');
    expect(deps.passthrough).not.toHaveBeenCalled();
  });
});
