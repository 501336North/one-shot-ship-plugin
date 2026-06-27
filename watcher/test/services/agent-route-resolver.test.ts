/**
 * @behavior The proxy decides per request where to route: a local-mapped OSS agent
 *           (identified by the OSS-ROUTE-AGENT marker in its system prompt) -> Ollama;
 *           a claude-mapped agent, an UNMARKED request (orchestrator), or a config with
 *           no models.agents -> Anthropic pass-through. The default is ALWAYS pass-through,
 *           so any request that isn't explicitly a local-mapped agent stays on Anthropic.
 * @user-story Each prompt is routable to its configured model; everything else is untouched.
 * @acceptance-criteria
 *   AC1: marker + ollama mapping -> {route:'ollama', model:'gpt-oss:120b', agent}
 *   AC2: marker + claude mapping -> {route:'anthropic'}
 *   AC3: no marker               -> {route:'anthropic'}   (orchestrator / Anthropic-only)
 *   AC4: no models.agents        -> {route:'anthropic'}   (Anthropic-only users unaffected)
 * @boundary Proxy routing decision (pure function)
 */
import { describe, it, expect } from 'vitest';
import { resolveRoute } from '../../src/services/agent-route-resolver.js';

const config = {
  models: {
    default: 'claude',
    agents: {
      'code-reviewer': 'ollama/gpt-oss:120b',
      'test-engineer': 'claude',
    },
  },
};

function req(system: unknown) {
  return { model: 'claude-sonnet-4-6', system, messages: [] } as any;
}

describe('resolveRoute: per-agent dispatch with safe pass-through default', () => {
  it('AC1: local-mapped agent (marker in system string) -> Ollama, bare model name', () => {
    const r = resolveRoute(req('You review code.\nOSS-ROUTE-AGENT: code-reviewer\n'), config);
    expect(r.route).toBe('ollama');
    expect(r.model).toBe('gpt-oss:120b');
    expect(r.agent).toBe('code-reviewer');
  });

  it('AC1b: marker in system array block form is also detected', () => {
    const r = resolveRoute(
      req([{ type: 'text', text: 'OSS-ROUTE-AGENT: code-reviewer' }]),
      config
    );
    expect(r.route).toBe('ollama');
    expect(r.agent).toBe('code-reviewer');
  });

  it('AC2: claude-mapped agent -> Anthropic pass-through', () => {
    const r = resolveRoute(req('OSS-ROUTE-AGENT: test-engineer'), config);
    expect(r.route).toBe('anthropic');
  });

  it('AC3: unmarked request (orchestrator) -> Anthropic pass-through', () => {
    const r = resolveRoute(req('Plain orchestrator system prompt, no marker'), config);
    expect(r.route).toBe('anthropic');
  });

  it('AC4: no models.agents (Anthropic-only user) -> Anthropic pass-through even if marked', () => {
    const r = resolveRoute(req('OSS-ROUTE-AGENT: code-reviewer'), { models: { default: 'claude' } });
    expect(r.route).toBe('anthropic');
  });
});
