/**
 * @behavior In ROUTER mode the ModelProxy HTTP server dispatches each /v1/messages request
 *           per-agent (via the already-tested routeMessages logic) instead of forcing a single
 *           construct-time model. A local-mapped agent is served by the injected Ollama backend
 *           and streamed back as Anthropic SSE; an unmarked / claude-mapped request is forwarded
 *           to Anthropic and piped back verbatim. When Ollama errors, the request still completes
 *           on Anthropic (fallback) — proving the response is NOT committed before the backend
 *           call resolves. HEAD / and /health stay local; any other path is forwarded (faithful
 *           reverse proxy), never 404'd.
 * @acceptance-criteria
 *   - marked agent (oss:code-reviewer -> ollama/gpt-oss:120b) -> ollamaHandle('gpt-oss:120b'); SSE body carries the Ollama text; passthrough NOT called.
 *   - unmarked request -> passthrough; bytes piped back; ollamaHandle NOT called.
 *   - ollama throws + fallbackEnabled -> passthrough serves; client still gets a 200 body.
 *   - HEAD / -> 200 (reachability probe answered locally).
 *   - unknown path (/v1/messages/count_tokens) -> passthrough (forwarded), not 404.
 * @boundary ModelProxy HTTP server in router mode (route deps injected)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as http from 'http';
import { ModelProxy, ollamaHandlerConfig } from '../../src/services/model-proxy.js';

describe('ollamaHandlerConfig: router → ollama HandlerConfig (incl. per-model think)', () => {
  it('carries baseUrl AND the think map from routerConfig.models', () => {
    const cfg = ollamaHandlerConfig({
      models: {
        agents: { 'oss:x': 'ollama/qwen3.6:35b-a3b' },
        apiKeys: { ollama: 'http://deepblue:11434' },
        think: { 'qwen3.6:35b-a3b': false },
      },
    });
    expect(cfg.provider).toBe('ollama');
    expect(cfg.baseUrl).toBe('http://deepblue:11434');
    expect(cfg.think).toEqual({ 'qwen3.6:35b-a3b': false });
  });

  it('omits think when the router config has none (unchanged behavior)', () => {
    const cfg = ollamaHandlerConfig({ models: { agents: {} } });
    expect(cfg.think).toBeUndefined();
  });
});

const routerConfig = {
  models: {
    default: 'claude',
    fallbackEnabled: true,
    agents: { 'oss:code-reviewer': 'ollama/gpt-oss:120b', 'oss:test-engineer': 'claude' },
  },
};

function anthropicResponse(text: string) {
  return {
    id: 'x',
    type: 'message' as const,
    role: 'assistant' as const,
    model: 'gpt-oss:120b',
    content: [{ type: 'text' as const, text }],
    stop_reason: 'end_turn' as const,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

/** A passthrough that returns an SSE-shaped upstream Response carrying `text`. */
function anthropicUpstream(text: string) {
  return new Response(`event: content_block_delta\ndata: {"text":"${text}"}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function makeRouterProxy(deps: Record<string, unknown>) {
  return new ModelProxy({
    router: true,
    routerConfig,
    port: 0,
    _testRouteDeps: {
      ollamaHandle: vi.fn(async () => anthropicResponse('OLLAMA_OUTPUT')),
      passthrough: vi.fn(async () => anthropicUpstream('ANTHROPIC_OUTPUT')),
      log: vi.fn(),
      ...deps,
    },
  } as never);
}

describe('ModelProxy router mode: per-agent HTTP dispatch + passthrough + fallback', () => {
  let proxy: ModelProxy;

  afterEach(async () => {
    if (proxy && proxy.isRunning()) {
      await proxy.shutdown();
    }
  });

  it('routes a local-mapped agent to the Ollama backend and streams the result back as SSE', async () => {
    const ollamaHandle = vi.fn(async () => anthropicResponse('OLLAMA_OUTPUT'));
    const passthrough = vi.fn(async () => anthropicUpstream('SHOULD_NOT_APPEAR'));
    proxy = makeRouterProxy({ ollamaHandle, passthrough });
    await proxy.start();

    const res = await sendMessages(proxy.getPort(), 'OSS-ROUTE-AGENT: oss:code-reviewer');

    expect(ollamaHandle).toHaveBeenCalledTimes(1);
    expect(ollamaHandle.mock.calls[0][0]).toBe('gpt-oss:120b'); // bare model name (ollama/ stripped)
    expect(passthrough).not.toHaveBeenCalled();
    expect(res.body).toContain('OLLAMA_OUTPUT');
  });

  it('forwards an unmarked request to Anthropic and pipes the upstream bytes back', async () => {
    const ollamaHandle = vi.fn(async () => anthropicResponse('SHOULD_NOT_APPEAR'));
    const passthrough = vi.fn(async () => anthropicUpstream('ANTHROPIC_OUTPUT'));
    proxy = makeRouterProxy({ ollamaHandle, passthrough });
    await proxy.start();

    const res = await sendMessages(proxy.getPort(), 'orchestrator with no marker');

    expect(passthrough).toHaveBeenCalledTimes(1);
    expect(ollamaHandle).not.toHaveBeenCalled();
    expect(res.body).toContain('ANTHROPIC_OUTPUT');
  });

  it('falls back to Anthropic when the Ollama backend throws (response not committed early)', async () => {
    const ollamaHandle = vi.fn(async () => {
      throw new Error('ECONNREFUSED ollama');
    });
    const passthrough = vi.fn(async () => anthropicUpstream('ANTHROPIC_FALLBACK'));
    proxy = makeRouterProxy({ ollamaHandle, passthrough });
    await proxy.start();

    const res = await sendMessages(proxy.getPort(), 'OSS-ROUTE-AGENT: oss:code-reviewer');

    expect(ollamaHandle).toHaveBeenCalledTimes(1);
    expect(passthrough).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.body).toContain('ANTHROPIC_FALLBACK');
  });

  it('answers HEAD / locally in router mode (reachability probe)', async () => {
    proxy = makeRouterProxy({});
    await proxy.start();

    const res = await headRoot(proxy.getPort());
    expect(res.status).toBe(200);
  });

  it('forwards an unknown path to Anthropic instead of 404ing (faithful reverse proxy)', async () => {
    const passthrough = vi.fn(async () => anthropicUpstream('TOKENS'));
    proxy = makeRouterProxy({ passthrough });
    await proxy.start();

    const res = await postPath(proxy.getPort(), '/v1/messages/count_tokens', '{}');

    expect(passthrough).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP helpers (router mode emits SSE / piped bytes, so we read the raw body)
// ---------------------------------------------------------------------------

function sendMessages(port: number, system: string): Promise<{ status: number; body: string }> {
  return postPath(
    port,
    '/v1/messages',
    JSON.stringify({ model: 'claude-x', system, messages: [{ role: 'user', content: 'hi' }], stream: true })
  );
}

function postPath(port: number, path: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function headRoot(port: number): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/', method: 'HEAD' },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode || 0 }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}
