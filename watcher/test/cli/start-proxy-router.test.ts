/**
 * @behavior `start-proxy --router` starts the proxy in per-agent ROUTER mode: no single --model is
 *           required, the per-agent map / fallback / ollama base-url come from the merged OSS
 *           config, and the proxy binds so the launcher can route a whole session through it.
 * @acceptance-criteria
 *   - parseCliArgs(['--router']) -> router=true with NO "--model is required" error.
 *   - parseCliArgs(['--router','--port','9000']) -> router=true, port=9000.
 *   - buildRouterConfig maps models.agents, fallbackEnabled (default true), and the ollama base url.
 *   - startRouterProxy starts a router ModelProxy and returns its bound port.
 * @boundary start-proxy CLI (router mode); ModelProxy injected for the startup test
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseCliArgs,
  buildRouterConfig,
  startRouterProxy,
} from '../../src/cli/start-proxy.js';

describe('start-proxy --router: arg parsing', () => {
  it('accepts --router without requiring --model', () => {
    const result = parseCliArgs(['--router']);
    expect(result.router).toBe(true);
    expect(result.errors).not.toContain('--model is required');
    expect(result.errors).toEqual([]);
  });

  it('honors --port alongside --router', () => {
    const result = parseCliArgs(['--router', '--port', '9000']);
    expect(result.router).toBe(true);
    expect(result.port).toBe(9000);
  });

  it('still requires --model when NOT in router mode (regression)', () => {
    const result = parseCliArgs([]);
    expect(result.errors).toContain('--model is required');
  });
});

describe('start-proxy --router: buildRouterConfig', () => {
  it('maps agents, defaults fallbackEnabled to true, and carries the ollama base url', () => {
    const cfg = buildRouterConfig({
      models: {
        default: 'claude',
        agents: { 'oss:code-reviewer': 'ollama/gpt-oss:120b' },
        apiKeys: { ollama: 'http://deepblue:11434' },
      },
    });
    expect(cfg.models?.agents).toEqual({ 'oss:code-reviewer': 'ollama/gpt-oss:120b' });
    expect(cfg.models?.fallbackEnabled).toBe(true);
    expect(cfg.models?.apiKeys?.ollama).toBe('http://deepblue:11434');
  });

  it('honors an explicit fallbackEnabled:false', () => {
    const cfg = buildRouterConfig({ models: { fallbackEnabled: false, agents: {} } });
    expect(cfg.models?.fallbackEnabled).toBe(false);
  });

  it('tolerates an empty/absent config (no agents, fallback on)', () => {
    const cfg = buildRouterConfig({});
    expect(cfg.models?.agents).toEqual({});
    expect(cfg.models?.fallbackEnabled).toBe(true);
  });
});

describe('start-proxy --router: startRouterProxy', () => {
  it('starts a router ModelProxy and returns the bound port', async () => {
    const mockProxy = {
      start: vi.fn().mockResolvedValue(undefined),
      getPort: vi.fn().mockReturnValue(8473),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isRunning: vi.fn().mockReturnValue(true),
    };

    const result = await startRouterProxy({
      port: 8473,
      background: false,
      routerConfig: { models: { agents: {}, fallbackEnabled: true } },
      _testProxy: mockProxy,
    });

    expect(mockProxy.start).toHaveBeenCalled();
    expect(result.port).toBe(8473);
    expect(result.error).toBeUndefined();
  });
});
