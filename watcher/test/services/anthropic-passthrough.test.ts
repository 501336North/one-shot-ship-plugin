/**
 * @behavior The proxy faithfully forwards non-diverted requests to api.anthropic.com,
 *           preserving the caller's auth so the orchestrator and claude-mapped agents reach
 *           real Claude. DeepBlue authenticates with an OAuth bearer (CLAUDE_CODE_OAUTH_TOKEN),
 *           so the inbound `authorization` header MUST be forwarded UNCHANGED, and the model
 *           MUST NOT be overridden.
 * @acceptance-criteria
 *   - Forwards to https://api.anthropic.com<path> with the same method + body.
 *   - Copies authorization (OAuth bearer), anthropic-version, anthropic-beta, x-api-key verbatim.
 *   - Does NOT inject/alter the model or strip the bearer.
 * @boundary Proxy → Anthropic pass-through
 */
import { describe, it, expect, vi } from 'vitest';
import { forwardToAnthropic } from '../../src/services/anthropic-passthrough.js';

function fakeFetch() {
  return vi.fn(async () => ({
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    body: null,
    text: async () => '{}',
  })) as any;
}

describe('forwardToAnthropic: OAuth-safe pass-through', () => {
  it('forwards to api.anthropic.com with the OAuth bearer unchanged', async () => {
    const fetchImpl = fakeFetch();
    await forwardToAnthropic(
      {
        path: '/v1/messages',
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-ant-oat01-THE-OAUTH-TOKEN',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
          host: 'should-be-dropped',
        },
        body: '{"model":"claude-x","messages":[]}',
      },
      fetchImpl
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    // OAuth bearer forwarded verbatim — the security-critical assertion.
    expect(init.headers['authorization']).toBe('Bearer sk-ant-oat01-THE-OAUTH-TOKEN');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['anthropic-beta']).toBe('fine-grained-tool-streaming-2025-05-14');
    // host must not be forwarded (would break TLS SNI / routing)
    expect(init.headers['host']).toBeUndefined();
    // body forwarded as-is; model NOT overridden
    expect(init.body).toBe('{"model":"claude-x","messages":[]}');
  });

  it('preserves x-api-key auth when that is what the caller used', async () => {
    const fetchImpl = fakeFetch();
    await forwardToAnthropic(
      {
        path: '/v1/messages',
        method: 'POST',
        headers: { 'x-api-key': 'sk-ant-api03-REAL', 'anthropic-version': '2023-06-01' },
        body: '{}',
      },
      fetchImpl
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['x-api-key']).toBe('sk-ant-api03-REAL');
  });

  it('forwards arbitrary Anthropic paths (catch-all reverse proxy)', async () => {
    const fetchImpl = fakeFetch();
    await forwardToAnthropic(
      { path: '/v1/messages/count_tokens', method: 'POST', headers: {}, body: '{}' },
      fetchImpl
    );
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages/count_tokens');
  });
});
