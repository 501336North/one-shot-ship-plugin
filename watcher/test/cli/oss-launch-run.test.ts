/**
 * @behavior runLaunch wires the decision into action: when models.agents is configured it
 *           ensures the proxy is up and execs the REAL claude with the routed env; otherwise
 *           it execs claude with the env UNCHANGED and never touches the proxy (Anthropic-only
 *           users unaffected).
 * @boundary CLI (oss-launch exec wrapper) — collaborators injected for determinism.
 */
import { describe, it, expect, vi } from 'vitest';
import { runLaunch, type LaunchDeps } from '../../src/cli/oss-launch.js';

function fakeChild() {
  const handlers: Record<string, (arg: unknown) => void> = {};
  return {
    on(ev: string, cb: (arg: unknown) => void) {
      handlers[ev] = cb;
      // resolve immediately with exit code 0
      if (ev === 'close') setTimeout(() => cb(0), 0);
      return this;
    },
  };
}

function deps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    loadConfig: () => ({ models: {} }),
    ensureProxy: vi.fn(async () => {}),
    resolveClaudeBin: () => '/real/bin/claude',
    spawn: vi.fn(() => fakeChild() as any),
    baseEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-real' },
    ...overrides,
  };
}

describe('runLaunch: exec wrapper', () => {
  it('Anthropic-only (no models.agents): execs claude unchanged, no proxy', async () => {
    const d = deps({ loadConfig: () => ({ models: { default: 'claude' } }) });
    const code = await runLaunch(['-p', '/oss:queue drain', '--dangerously-skip-permissions'], d);

    expect(code).toBe(0);
    expect(d.ensureProxy).not.toHaveBeenCalled();
    expect(d.spawn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = (d.spawn as any).mock.calls[0];
    expect(bin).toBe('/real/bin/claude');
    expect(args).toEqual(['-p', '/oss:queue drain', '--dangerously-skip-permissions']);
    expect(opts.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(opts.env.OSS_PROXY_ROUTING).toBeUndefined();
    expect(opts.env.ANTHROPIC_API_KEY).toBe('sk-real');
  });

  it('with models.agents: ensures proxy + execs claude with routed env', async () => {
    const d = deps({
      loadConfig: () => ({ models: { agents: { 'oss:code-reviewer': 'ollama/gpt-oss:120b' } } }),
    });
    const code = await runLaunch(['-p', 'x'], d);

    expect(code).toBe(0);
    expect(d.ensureProxy).toHaveBeenCalledTimes(1);
    expect((d.ensureProxy as any).mock.calls[0][0]).toBe(8473);
    const [bin, , opts] = (d.spawn as any).mock.calls[0];
    expect(bin).toBe('/real/bin/claude');
    expect(opts.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8473');
    expect(opts.env.OSS_PROXY_ROUTING).toBe('1');
    expect(opts.stdio).toBe('inherit');
  });
});
