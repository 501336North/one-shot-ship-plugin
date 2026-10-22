/**
 * @behavior A user running `oss-decrypt --version` sees the version that was released,
 *           and the user's API key only ever travels to the endpoint it was meant for.
 * @acceptance-criteria AC-VER-1: the shipped bundle's `--version` equals package.json `version`.
 * @acceptance-criteria AC-KEY-1: a keyed request that is answered with a redirect is refused,
 *           and the redirect target never receives a request (so never sees the key).
 * @acceptance-criteria AC-KEY-2: a prompt / team-command name is URL-encoded, so it can only
 *           address its own endpoint (no extra path segments, no query string, no fragment).
 * @business-rule VER-001: a release cannot report a different version than the one published.
 * @business-rule KEY-001: the Bearer key is sent only to the configured API URL.
 * @business-rule KEY-002: user-supplied names cannot steer a keyed request to another API path.
 * @boundary Built CLI bundle (dist/oss-decrypt.cjs) and the keyed HTTP client (real fetch,
 *           local 127.0.0.1 servers only — no fetch mocks, no external network, fake key).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import {
  fetchCredentials,
  fetchEncryptedPrompt,
  fetchCustomPrompt,
} from '../src/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const bundlePath = resolve(__dirname, '../dist/oss-decrypt.cjs');

const FAKE_KEY = 'oss_test_key_not_real';

interface RecordedRequest {
  url: string;
  authorization: string | undefined;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const openServers: Server[] = [];

async function startServer(handler: Handler): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** Server B: the redirect target. Records every request and answers 200 JSON. */
async function startRedirectTarget(): Promise<{ baseUrl: string; received: RecordedRequest[] }> {
  const received: RecordedRequest[] = [];
  const { baseUrl } = await startServer((req, res) => {
    received.push({ url: req.url ?? '', authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ userId: 'u', salt: 's', hardwareId: 'hw-1', encrypted: 'e', iv: 'i', authTag: 'a', prompt: 'p', name: 'n', displayName: 'd', isBlocking: false }));
  });
  return { baseUrl, received };
}

/** Server A: the configured API. Answers every request with a 302 to server B. */
async function startRedirectingApi(targetBaseUrl: string): Promise<string> {
  const { baseUrl } = await startServer((_req, res) => {
    res.writeHead(302, { Location: `${targetBaseUrl}/stolen` });
    res.end();
  });
  return baseUrl;
}

/** Runs a keyed call and reports whether it rejected, without throwing. */
async function settle(call: () => Promise<unknown>): Promise<{ rejected: boolean }> {
  try {
    await call();
    return { rejected: false };
  } catch {
    return { rejected: true };
  }
}

afterEach(async () => {
  const closing = openServers.splice(0).map(
    (server) =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      })
  );
  await Promise.all(closing);
});

describe('AC-VER-1: oss-decrypt --version reports the released package version', () => {
  it('oss-decrypt --version reports the released package version', () => {
    // Given the released package version in package.json
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

    // When a user runs the tracked, built bundle with --version
    const stdout = execFileSync(process.execPath, [bundlePath, '--version'], {
      encoding: 'utf8',
    });

    // Then it prints exactly that version
    expect(stdout.trim()).toBe(`oss-decrypt v${pkg.version}`);
  });
});

describe('AC-KEY-1: the API key is never sent to a redirect target', () => {
  it('fetchCredentials refuses a redirect and the redirect target receives nothing', async () => {
    // Given an API that redirects every request to another server
    const target = await startRedirectTarget();
    const apiUrl = await startRedirectingApi(target.baseUrl);

    // When credentials are fetched with the user's key
    const outcome = await settle(() => fetchCredentials(FAKE_KEY, apiUrl, 'hw-1'));

    // Then the redirect target never sees a request, and the call fails
    expect(target.received, 'redirect target received a keyed request').toEqual([]);
    expect(outcome.rejected).toBe(true);
  });

  it('fetchEncryptedPrompt refuses a redirect and the redirect target receives nothing', async () => {
    // Given an API that redirects every request to another server
    const target = await startRedirectTarget();
    const apiUrl = await startRedirectingApi(target.baseUrl);

    // When an encrypted workflow prompt is fetched with the user's key
    const outcome = await settle(() => fetchEncryptedPrompt(FAKE_KEY, apiUrl, 'workflows', 'build'));

    // Then the redirect target never sees a request, and the call fails
    expect(target.received, 'redirect target received a keyed request').toEqual([]);
    expect(outcome.rejected).toBe(true);
  });

  it('fetchCustomPrompt refuses a redirect and the redirect target receives nothing', async () => {
    // Given an API that redirects every request to another server
    const target = await startRedirectTarget();
    const apiUrl = await startRedirectingApi(target.baseUrl);

    // When a team custom command is fetched with the user's key
    const outcome = await settle(() => fetchCustomPrompt(FAKE_KEY, apiUrl, 'team-cmd'));

    // Then the redirect target never sees a request, and the call fails
    expect(target.received, 'redirect target received a keyed request').toEqual([]);
    expect(outcome.rejected).toBe(true);
  });

  /**
   * Same-origin redirects are the realistic leak: fetch strips Authorization only when the
   * redirect crosses origins, so a 302 to another path on the same host would carry the key.
   */
  async function startSameOriginRedirectingApi(): Promise<{
    baseUrl: string;
    received: RecordedRequest[];
  }> {
    const received: RecordedRequest[] = [];
    const { baseUrl } = await startServer((req, res) => {
      received.push({ url: req.url ?? '', authorization: req.headers.authorization });
      if (req.url === '/stolen') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ userId: 'u', salt: 's', hardwareId: 'hw-1', encrypted: 'e', iv: 'i', authTag: 'a', prompt: 'p', name: 'n', displayName: 'd', isBlocking: false }));
        return;
      }
      res.writeHead(302, { Location: '/stolen' });
      res.end();
    });
    return { baseUrl, received };
  }

  it('fetchCredentials refuses a same-origin redirect and never follows it with the key', async () => {
    // Given an API that redirects to another path on the same host
    const api = await startSameOriginRedirectingApi();

    // When credentials are fetched with the user's key
    const outcome = await settle(() => fetchCredentials(FAKE_KEY, api.baseUrl, 'hw-1'));

    // Then only the original request was made, and the call fails
    expect(api.received.map((r) => r.url), 'redirect was followed').not.toContain('/stolen');
    expect(api.received).toHaveLength(1);
    expect(outcome.rejected).toBe(true);
  });

  it('fetchEncryptedPrompt refuses a same-origin redirect and never follows it with the key', async () => {
    // Given an API that redirects to another path on the same host
    const api = await startSameOriginRedirectingApi();

    // When an encrypted workflow prompt is fetched with the user's key
    const outcome = await settle(() => fetchEncryptedPrompt(FAKE_KEY, api.baseUrl, 'workflows', 'build'));

    // Then only the original request was made, and the call fails
    expect(api.received.map((r) => r.url), 'redirect was followed').not.toContain('/stolen');
    expect(api.received).toHaveLength(1);
    expect(outcome.rejected).toBe(true);
  });

  it('fetchCustomPrompt refuses a same-origin redirect and never follows it with the key', async () => {
    // Given an API that redirects to another path on the same host
    const api = await startSameOriginRedirectingApi();

    // When a team custom command is fetched with the user's key
    const outcome = await settle(() => fetchCustomPrompt(FAKE_KEY, api.baseUrl, 'team-cmd'));

    // Then only the original request was made, and the call fails
    expect(api.received.map((r) => r.url), 'redirect was followed').not.toContain('/stolen');
    expect(api.received).toHaveLength(1);
    expect(outcome.rejected).toBe(true);
  });
});

describe('AC-KEY-2: a prompt name can only reach its own endpoint', () => {
  const HOSTILE_NAME = 'a/../b?x=1#y';
  const ENCODED_NAME = encodeURIComponent(HOSTILE_NAME); // a%2F..%2Fb%3Fx%3D1%23y

  async function startRecordingApi(): Promise<{ baseUrl: string; seen: string[] }> {
    const seen: string[] = [];
    const { baseUrl } = await startServer((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });
    return { baseUrl, seen };
  }

  it('fetchCustomPrompt sends the name as a single encoded path segment', async () => {
    // Given an API that records the path it is asked for
    const api = await startRecordingApi();

    // When a custom command with path and query characters in its name is fetched
    await settle(() => fetchCustomPrompt(FAKE_KEY, api.baseUrl, HOSTILE_NAME));

    // Then the API saw exactly the custom endpoint for that encoded name
    expect(api.seen).toEqual([`/api/v1/prompts/custom/${ENCODED_NAME}`]);
  });

  it('fetchEncryptedPrompt sends the command name as a single encoded path segment', async () => {
    // Given an API that records the path it is asked for
    const api = await startRecordingApi();

    // When a command prompt with path and query characters in its name is fetched
    await settle(() => fetchEncryptedPrompt(FAKE_KEY, api.baseUrl, 'commands', HOSTILE_NAME));

    // Then the API saw exactly the command endpoint for that encoded name
    expect(api.seen).toEqual([`/api/v1/prompts/${ENCODED_NAME}`]);
  });
});
