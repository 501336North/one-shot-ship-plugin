/**
 * @behavior A keyed request to the OSS API (credentials, encrypted prompt, custom command, IRON LAWS / template) that
 *           answers its headers and then stalls the body is abandoned after the time limit with a clear message,
 *           instead of hanging the user's foreground command forever. The limit defaults to 60 s (Render cold start).
 * @business-rule SR10 (release-channels ship round 2): every keyed fetch has a time limit, like the manifest fetch.
 * @boundary The api-client functions against a real local 127.0.0.1 server (real fetch, real socket). The limit is
 *           injected short so the test runs in well under a second.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import {
  API_TIMEOUT_MS,
  fetchCredentials,
  fetchCustomPrompt,
  fetchEncryptedPrompt,
  fetchPlainPrompt,
} from '../src/api-client.js';

const LIMIT = { timeoutMs: 150 };

let server: Server | undefined;

/** An API that sends 200 and the first bytes of a body, then never sends the rest. */
async function stallingApi(): Promise<string> {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
    res.write('{"prompt":"');
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('keyed API requests have a time limit', () => {
  afterEach(async () => {
    const s = server;
    server = undefined;
    if (!s) return;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  it('the default limit is 60 s', () => {
    expect(API_TIMEOUT_MS).toBe(60_000);
  });

  const requests: Array<[string, (apiUrl: string) => Promise<unknown>]> = [
    ['credentials', (apiUrl) => fetchCredentials('ak_test', apiUrl, 'hw', LIMIT)],
    ['encrypted prompt', (apiUrl) => fetchEncryptedPrompt('ak_test', apiUrl, 'commands', 'plan', LIMIT)],
    ['custom command', (apiUrl) => fetchCustomPrompt('ak_test', apiUrl, 'lint', LIMIT)],
    ['IRON LAWS', (apiUrl) => fetchPlainPrompt('ak_test', apiUrl, 'shared', 'iron-laws', LIMIT)],
  ];

  it.each(requests)('a stalled %s body is abandoned with a clear message', async (_what, request) => {
    const apiUrl = await stallingApi();
    await expect(request(apiUrl)).rejects.toThrow(/OSS API did not answer within/);
  }, 3000);
});
