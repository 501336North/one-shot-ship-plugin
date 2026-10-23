/**
 * @behavior A user running `oss-decrypt --version` sees the version that was released,
 *           and the user's API key only ever travels to the endpoint it was meant for.
 * @acceptance-criteria AC-VER-1: the shipped bundle's `--version` equals package.json `version`.
 * @acceptance-criteria AC-KEY-1: a keyed request that is answered with a redirect is refused,
 *           and the redirect target never receives a request (so never sees the key).
 * @acceptance-criteria AC-KEY-2: a prompt / team-command name can only address its own endpoint:
 *           a name with `/` or a dot segment (`.`, `..`) is refused before any request is made,
 *           and any other name is URL-encoded (no query string, no fragment).
 * @business-rule VER-001: a release cannot report a different version than the one published.
 * @business-rule KEY-001: the Bearer key is sent only to the configured API URL.
 * @business-rule KEY-002: user-supplied names cannot steer a keyed request to another API path.
 * @boundary Built CLI bundle (dist/oss-decrypt.cjs) and the keyed HTTP client (real fetch,
 *           local 127.0.0.1 servers only — no fetch mocks, no external network, fake key).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

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
async function settle(call: () => Promise<unknown>): Promise<{ rejected: boolean; message: string }> {
  try {
    await call();
    return { rejected: false, message: '' };
  } catch (err) {
    return { rejected: true, message: err instanceof Error ? err.message : String(err) };
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
    // And the user is told a redirect was refused (pointing at apiUrl), without the key
    expect(outcome.message).toMatch(/redirect/i);
    expect(outcome.message).toMatch(/apiUrl/);
    expect(outcome.message).not.toContain(FAKE_KEY);
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
    // And the user is told a redirect was refused (pointing at apiUrl), without the key
    expect(outcome.message).toMatch(/redirect/i);
    expect(outcome.message).toMatch(/apiUrl/);
    expect(outcome.message).not.toContain(FAKE_KEY);
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
    // And the user is told a redirect was refused (pointing at apiUrl), without the key
    expect(outcome.message).toMatch(/redirect/i);
    expect(outcome.message).toMatch(/apiUrl/);
    expect(outcome.message).not.toContain(FAKE_KEY);
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
  const TRAVERSAL_NAMES = ['a/../b?x=1#y', '..', '.'];
  const QUERY_NAME = 'b?x=1#y';
  const ENCODED_QUERY_NAME = encodeURIComponent(QUERY_NAME); // b%3Fx%3D1%23y

  async function startRecordingApi(): Promise<{ baseUrl: string; seen: string[] }> {
    const seen: string[] = [];
    const { baseUrl } = await startServer((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });
    return { baseUrl, seen };
  }

  for (const name of TRAVERSAL_NAMES) {
    it(`fetchCustomPrompt refuses the name ${JSON.stringify(name)} and the API receives nothing`, async () => {
      // Given an API that records every request it receives
      const api = await startRecordingApi();

      // When a custom command whose name could address a parent path is fetched with the user's key
      const outcome = await settle(() => fetchCustomPrompt(FAKE_KEY, api.baseUrl, name));

      // Then the call is refused and no request (so no key) left the client
      expect(outcome.rejected).toBe(true);
      expect(api.seen).toEqual([]);
    });

    it(`fetchEncryptedPrompt refuses the command name ${JSON.stringify(name)} and the API receives nothing`, async () => {
      // Given an API that records every request it receives
      const api = await startRecordingApi();

      // When a command prompt whose name could address a parent path is fetched with the user's key
      const outcome = await settle(() => fetchEncryptedPrompt(FAKE_KEY, api.baseUrl, 'commands', name));

      // Then the call is refused and no request (so no key) left the client
      expect(outcome.rejected).toBe(true);
      expect(api.seen).toEqual([]);
    });
  }

  it('fetchCustomPrompt sends a name with query characters as a single encoded path segment', async () => {
    // Given an API that records the path it is asked for
    const api = await startRecordingApi();

    // When a custom command with query and fragment characters in its name is fetched
    await settle(() => fetchCustomPrompt(FAKE_KEY, api.baseUrl, QUERY_NAME));

    // Then the API saw exactly the custom endpoint for that encoded name
    expect(api.seen).toEqual([`/api/v1/prompts/custom/${ENCODED_QUERY_NAME}`]);
  });

  it('fetchEncryptedPrompt sends a command name with query characters as a single encoded path segment', async () => {
    // Given an API that records the path it is asked for
    const api = await startRecordingApi();

    // When a command prompt with query and fragment characters in its name is fetched
    await settle(() => fetchEncryptedPrompt(FAKE_KEY, api.baseUrl, 'commands', QUERY_NAME));

    // Then the API saw exactly the command endpoint for that encoded name
    expect(api.seen).toEqual([`/api/v1/prompts/${ENCODED_QUERY_NAME}`]);
  });
});

/**
 * Integration check for the mocked boundary in api-client.test.ts (R1-4): there, fetch is mocked to
 * return a Response with control characters in its error text. Here a real local server sends the
 * same bytes over a real socket through the real fetch, so the JSON decoding path is the real one.
 */
describe('R1-4 (real fetch): server error text reaches the user without control characters', () => {
  // ESC[31m (colour), BEL, CR, and the C1 CSI 0x9b — a terminal-control payload in the error field.
  const HOSTILE_ERROR_BODY = '{ "error": "bad\\u001b[31mred\\u0007\\r\\u009b2J" }';
  const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

  async function startHostileErrorApi(): Promise<string> {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(HOSTILE_ERROR_BODY);
    });
    return baseUrl;
  }

  it('fetchCredentials rejects with the server error text, minus control characters', async () => {
    // Given an API whose 400 error message carries terminal control characters
    const apiUrl = await startHostileErrorApi();

    // When credentials are fetched with the user's key
    const outcome = await settle(() => fetchCredentials(FAKE_KEY, apiUrl, 'hw-1'));

    // Then the user sees the readable text and no control characters
    expect(outcome.rejected).toBe(true);
    expect(outcome.message).toContain('bad');
    expect(outcome.message).toContain('red');
    expect(outcome.message).not.toMatch(CONTROL_CHARS);
  });

  it('fetchEncryptedPrompt rejects with the server error text, minus control characters', async () => {
    // Given an API whose 400 error message carries terminal control characters
    const apiUrl = await startHostileErrorApi();

    // When an encrypted workflow prompt is fetched with the user's key
    const outcome = await settle(() => fetchEncryptedPrompt(FAKE_KEY, apiUrl, 'workflows', 'build'));

    // Then the user sees the readable text and no control characters
    expect(outcome.rejected).toBe(true);
    expect(outcome.message).toContain('bad');
    expect(outcome.message).toContain('red');
    expect(outcome.message).not.toMatch(CONTROL_CHARS);
  });

  it('fetchCustomPrompt rejects with the server error text, minus control characters', async () => {
    // Given an API whose 400 error message carries terminal control characters
    const apiUrl = await startHostileErrorApi();

    // When a team custom command is fetched with the user's key
    const outcome = await settle(() => fetchCustomPrompt(FAKE_KEY, apiUrl, 'team-cmd'));

    // Then the user sees the readable text and no control characters
    expect(outcome.rejected).toBe(true);
    expect(outcome.message).toContain('bad');
    expect(outcome.message).toContain('red');
    expect(outcome.message).not.toMatch(CONTROL_CHARS);
  });
});

/**
 * R2-4: every error the CLI prints is stripped, not only the server `error` field. A 200 answer whose
 * body is not JSON makes the JSON decoder throw a message that quotes the body; the CLI must print it
 * without control or bidi characters.
 * @boundary The built bundle, spawned as the user runs it, against a local 127.0.0.1 server.
 */
describe('R2-4 (built CLI): a printed error carries no control or bidi characters', () => {
  it('oss-decrypt --setup against a non-JSON OK body prints a clean error and exits 1', async () => {
    // Given an API that answers 200 with a non-JSON body carrying ESC, BEL and U+202E (right-to-left override)
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('bad\u001b[31mred\u0007\u202eevil');
    });
    const configDir = mkdtempSync(join(tmpdir(), 'oss-r2-4-'));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ apiKey: FAKE_KEY, apiUrl: baseUrl }));

    // When the user runs setup with the built CLI
    const result = await new Promise<{ code: number | null; stderr: string }>((resolveRun) => {
      execFile(
        process.execPath,
        [bundlePath, '--setup'],
        { encoding: 'utf8', env: { ...process.env, OSS_CONFIG_DIR: configDir } },
        (err, _stdout, stderr) => resolveRun({ code: err ? (err.code as number) : 0, stderr })
      );
    });
    rmSync(configDir, { recursive: true, force: true });

    // Then it fails, shows the readable words, and none of the hostile characters
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain('red');
    expect(result.stderr).not.toMatch(/[\u001b\u0007\u202e]/);
  });
});
