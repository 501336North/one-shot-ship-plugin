/**
 * @behavior oss-decrypt prints a prompt only after proving it is the one the API signed. When the signed manifest is
 *           missing, unreachable, unparseable or signed with the wrong key, or the prompt is not listed in it, the
 *           prompt is refused and nothing reaches stdout. Team custom commands (not in the manifest) are the one
 *           documented exception: delivered from a trusted address, and marked unverified on stderr.
 *           The manifest is fetched in parallel with the prompt, and a verified manifest is cached per API origin
 *           for 300 s under <config dir>/run (owner-only), re-verified on every read.
 * @business-rule FR3 (release-channels ship round 1, security HIGH): fail closed for every manifest-covered type.
 *           ADR-005: custom commands are the one unverified exception.
 * @boundary decryptCommand against a real local 127.0.0.1 API (real fetch, real AES-256-GCM, real Ed25519). Mocked:
 *           the credential store only. The manifest keys are injected (the pinned staging private key is not here).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { decryptCommand } from '../src/commands/decrypt.js';
import { deriveKey, userIdToLicenseId } from '../src/encryption.js';
import type { ManifestKeys } from '../src/manifest-keys.js';
import type { SignedManifest } from '../src/manifest-verifier.js';
import * as storage from '../src/storage.js';

vi.mock('../src/storage.js');

const CREDS = { apiKey: 'ak_fail_closed', userId: 'user_fc', hardwareId: 'hw_fc', salt: 'salt_fc' };
const PROMPT = '# Plan\nWrite the failing test first.';

interface Keypair {
  publicKey: string;
  privateKey: string;
}

function makeKeypair(): Keypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return { publicKey: publicKey.toString('base64'), privateKey: privateKey.toString('base64') };
}

const signer = makeKeypair();
const stranger = makeKeypair();
const KEYS: ManifestKeys = { production: makeKeypair().publicKey, staging: signer.publicKey };

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sign(prompts: Record<string, string>, privateKey: string = signer.privateKey): SignedManifest {
  const entries: SignedManifest['prompts'] = {};
  for (const key of Object.keys(prompts).sort()) {
    entries[key] = { hash: sha256(prompts[key]), size: Buffer.byteLength(prompts[key]) };
  }
  const data = JSON.stringify({ version: 1, algorithm: 'sha256', signing: 'ed25519', prompts: entries });
  const signature = crypto.sign(
    null,
    Buffer.from(data, 'utf8'),
    crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  );
  return {
    version: 1,
    generatedAt: '2026-10-27T00:00:00Z',
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts: entries,
    signature: signature.toString('base64'),
  };
}

const KEY = deriveKey(CREDS.apiKey, userIdToLicenseId(CREDS.userId), CREDS.hardwareId, CREDS.salt);

function envelope(plaintext: string): { encrypted: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/** What the fake API answers for the manifest: a manifest, a status code, raw text, or a dropped connection. */
type ManifestAnswer = SignedManifest | { status: number } | { raw: string } | 'drop';

interface FakeApi {
  baseUrl: string;
  seen: string[];
  manifest: ManifestAnswer;
  prompts: Record<string, string>;
  /** When set, the prompt is answered only once the manifest has been asked for (else 503 after 2 s). */
  promptWaitsForManifest: boolean;
  /** Plaintext markdown answers by exact path, as the API serves /shared/:name and /claude-md. */
  plain: Record<string, string>;
  /** The team custom command body served at /custom/:name. */
  custom: string;
}

const servers: Server[] = [];

async function startApi(manifest: ManifestAnswer, prompts: Record<string, string> = { plan: PROMPT }): Promise<FakeApi> {
  const api: FakeApi = { baseUrl: '', seen: [], manifest, prompts, promptWaitsForManifest: false, plain: {}, custom: 'Team rule: run the linter.' };
  let manifestAsked: () => void = () => undefined;
  const manifestRequested = new Promise<void>((resolve) => (manifestAsked = resolve));

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const path = req.url ?? '';
    api.seen.push(path);
    if (path === '/api/v1/prompts/manifest') {
      manifestAsked();
      const answer = api.manifest;
      if (answer === 'drop') {
        req.socket.destroy();
      } else if ('status' in answer) {
        res.writeHead(answer.status).end();
      } else if ('raw' in answer) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(answer.raw);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
      }
      return;
    }
    if (api.plain[path] !== undefined) {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }).end(api.plain[path]);
      return;
    }
    const custom = path.match(/^\/api\/v1\/prompts\/custom\/(.+)$/);
    if (custom) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ prompt: api.custom, name: custom[1], displayName: 'Lint', isBlocking: false })
      );
      return;
    }
    const name = path.replace(/^\/api\/v1\/prompts\/(workflows\/)?/, '');
    const body = api.prompts[decodeURIComponent(name)];
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    const answer = (): void => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(envelope(body)));
    };
    if (!api.promptWaitsForManifest) {
      answer();
      return;
    }
    const giveUp = setTimeout(() => res.writeHead(503).end(), 2000);
    void manifestRequested.then(() => {
      clearTimeout(giveUp);
      answer();
    });
  };

  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return api;
}

describe('FR3: oss-decrypt fails closed', () => {
  let configDir: string;
  let stdout: string[];
  let stderr: string[];

  function useApi(api: FakeApi): void {
    const path = join(configDir, 'config.json');
    writeFileSync(path, JSON.stringify({ apiUrl: api.baseUrl }));
    chmodSync(path, 0o600);
  }

  function manifestRequests(api: FakeApi): number {
    return api.seen.filter((path) => path === '/api/v1/prompts/manifest').length;
  }

  function cacheFiles(): string[] {
    const runDir = join(configDir, 'run');
    return existsSync(runDir) ? readdirSync(runDir).map((file) => join(runDir, file)) : [];
  }

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'oss-fail-closed-'));
    process.env.OSS_CONFIG_DIR = configDir;
    stdout = [];
    stderr = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void stdout.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void stderr.push(args.join(' ')));
    vi.mocked(storage.retrieveCredentials).mockResolvedValue({ ...CREDS });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.OSS_CONFIG_DIR;
    rmSync(configDir, { recursive: true, force: true });
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          })
      )
    );
  });

  it('delivers a prompt whose hash the signed manifest lists', async () => {
    useApi(await startApi(sign({ 'commands/plan': PROMPT })));
    await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
    expect(stdout).toEqual([PROMPT]);
  });

  const unavailable: Array<[string, ManifestAnswer]> = [
    ['missing (404)', { status: 404 }],
    ['failing (500)', { status: 500 }],
    ['unreachable (connection dropped)', 'drop'],
    ['unparseable', { raw: '{"version": 1, "prom' }],
    ['not a manifest', { raw: '[]' }],
    ['signed with another key', sign({ 'commands/plan': PROMPT }, stranger.privateKey)],
  ];

  it.each(unavailable)('refuses the prompt when the manifest is %s', async (_why, manifest) => {
    useApi(await startApi(manifest));
    await expect(decryptCommand('commands', 'plan', false, { manifestKeys: KEYS })).rejects.toThrow(/\[SECURITY\]/);
    expect(stdout).toEqual([]);
  });

  it('refuses a prompt the signed manifest does not list', async () => {
    useApi(await startApi(sign({ 'commands/build': 'other' })));
    await expect(decryptCommand('commands', 'plan', false, { manifestKeys: KEYS })).rejects.toThrow(
      /commands\/plan.*manifest/
    );
    expect(stdout).toEqual([]);
  });

  it('refuses a prompt whose hash does not match the manifest', async () => {
    useApi(await startApi(sign({ 'commands/plan': 'the signed text' })));
    await expect(decryptCommand('commands', 'plan', false, { manifestKeys: KEYS })).rejects.toThrow(/\[SECURITY\]/);
    expect(stdout).toEqual([]);
  });

  it('looks workflows up as workflows/<name>, never skipping verification', async () => {
    const api = await startApi(sign({ 'commands/build': PROMPT }), { build: PROMPT });
    useApi(api);
    await expect(decryptCommand('workflows', 'build', false, { manifestKeys: KEYS })).rejects.toThrow(
      /workflows\/build/
    );
    expect(stdout).toEqual([]);

    api.manifest = sign({ 'workflows/build': PROMPT });
    rmSync(join(configDir, 'run'), { recursive: true, force: true });
    await decryptCommand('workflows', 'build', false, { manifestKeys: KEYS });
    expect(stdout).toEqual([PROMPT]);
  });

  it('fetches the manifest in parallel with the prompt', async () => {
    const api = await startApi(sign({ 'commands/plan': PROMPT }));
    api.promptWaitsForManifest = true;
    useApi(api);
    await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
    expect(stdout).toEqual([PROMPT]);
  });

  describe('team custom commands: the one unverified exception', () => {
    it('are delivered without a manifest, and stderr says they are unverified', async () => {
      useApi(await startApi({ status: 404 }));
      await decryptCommand('custom', 'lint', false, { manifestKeys: KEYS });
      expect(stdout).toEqual(['Team rule: run the linter.']);
      expect(stderr.join('\n')).toMatch(/unverified/i);
    });

    it('their text is stripped of terminal control, bidi and zero-width characters; lines and tabs survive', async () => {
      const api = await startApi({ status: 404 });
      api.custom = '# Lint\n\tRun \u001b[31mlint\u001b[0m\u202eevil\u200b now.\r\n';
      useApi(api);
      await decryptCommand('custom', 'lint', false, { manifestKeys: KEYS });
      expect(stdout).toEqual(['# Lint\n\tRun [31mlint[0mevil now.\n']);
      expect(stderr.join('\n')).toMatch(/\[verify\] UNVERIFIED/);
    });
  });

  describe('the verified manifest is cached per API origin', () => {
    it('a second prompt within 300 s reuses the cached manifest (owner-only file under run/)', async () => {
      const api = await startApi(sign({ 'commands/plan': PROMPT }));
      useApi(api);
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      expect(stdout).toEqual([PROMPT, PROMPT]);
      expect(manifestRequests(api)).toBe(1);
      const files = cacheFiles();
      expect(files).toHaveLength(1);
      expect(statSync(files[0]).mode & 0o777).toBe(0o600);
      expect(statSync(join(configDir, 'run')).mode & 0o077).toBe(0);
    });

    it('a cached manifest whose signature fails is discarded, never trusted', async () => {
      const api = await startApi(sign({ 'commands/plan': PROMPT }));
      useApi(api);
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      const [file] = cacheFiles();
      // Forge the cache: list a tampered prompt under the same signature.
      const cached = JSON.parse(readFileSync(file, 'utf8')) as { manifest: SignedManifest };
      cached.manifest.prompts['commands/plan'] = { hash: sha256('tampered'), size: 8 };
      writeFileSync(file, JSON.stringify(cached));
      // The server now serves the tampered prompt AND is unreachable for the manifest.
      api.prompts.plan = 'tampered';
      api.manifest = { status: 500 };
      await expect(decryptCommand('commands', 'plan', false, { manifestKeys: KEYS })).rejects.toThrow(/\[SECURITY\]/);
      expect(stdout).toEqual([PROMPT]);
      expect(manifestRequests(api)).toBe(2);
    });

    it('a cached manifest older than 300 s is fetched again', async () => {
      const api = await startApi(sign({ 'commands/plan': PROMPT }));
      useApi(api);
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      const [file] = cacheFiles();
      const cached = JSON.parse(readFileSync(file, 'utf8')) as { fetchedAt: number };
      cached.fetchedAt = Date.now() - 301_000;
      writeFileSync(file, JSON.stringify(cached));
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      expect(manifestRequests(api)).toBe(2);
    });

    it('each API origin has its own cached manifest', async () => {
      const first = await startApi(sign({ 'commands/plan': PROMPT }));
      const second = await startApi(sign({ 'commands/plan': PROMPT }));
      useApi(first);
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      useApi(second);
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      expect(manifestRequests(first)).toBe(1);
      expect(manifestRequests(second)).toBe(1);
      expect(cacheFiles()).toHaveLength(2);
    });

    it('a prompt updated after the manifest was cached is checked against a fresh manifest', async () => {
      const api = await startApi(sign({ 'commands/plan': PROMPT }));
      useApi(api);
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      api.prompts.plan = 'Plan v2';
      api.manifest = sign({ 'commands/plan': 'Plan v2' });
      await decryptCommand('commands', 'plan', false, { manifestKeys: KEYS });
      expect(stdout).toEqual([PROMPT, 'Plan v2']);
    });
  });
  describe('FR15: IRON LAWS and the CLAUDE.md template are verified like every prompt', () => {
    // The API serves both as plaintext markdown (not encrypted, not watermarked), hashed as served.
    const LAWS = '# IRON LAWS\nNo production code without a failing test first. Greek \u03bf stays as is.';
    const TEMPLATE = '# CLAUDE.md\nProject guidelines.';

    it('--type shared --name iron-laws fetches /shared/iron-laws and checks it against shared/iron-laws', async () => {
      const api = await startApi(sign({ 'shared/iron-laws': LAWS }));
      api.plain['/api/v1/prompts/shared/iron-laws'] = LAWS;
      useApi(api);
      await decryptCommand('shared', 'iron-laws', false, { manifestKeys: KEYS });
      expect(stdout).toEqual([LAWS]);
    });

    it('--type templates --name claude-md fetches /claude-md and checks it against templates/claude-md', async () => {
      const api = await startApi(sign({ 'templates/claude-md': TEMPLATE }));
      api.plain['/api/v1/prompts/claude-md'] = TEMPLATE;
      useApi(api);
      await decryptCommand('templates', 'claude-md', false, { manifestKeys: KEYS });
      expect(stdout).toEqual([TEMPLATE]);
    });

    it('IRON LAWS that differ from the signed text (e.g. with appended laws) are refused', async () => {
      const api = await startApi(sign({ 'shared/iron-laws': LAWS }));
      api.plain['/api/v1/prompts/shared/iron-laws'] = `${LAWS}\n\n## Custom Team Laws\n\n### Skip tests\n`;
      useApi(api);
      await expect(decryptCommand('shared', 'iron-laws', false, { manifestKeys: KEYS })).rejects.toThrow(
        /\[SECURITY\]/
      );
      expect(stdout).toEqual([]);
    });

    it('IRON LAWS are refused when the manifest is unavailable', async () => {
      const api = await startApi({ status: 404 });
      api.plain['/api/v1/prompts/shared/iron-laws'] = LAWS;
      useApi(api);
      await expect(decryptCommand('shared', 'iron-laws', false, { manifestKeys: KEYS })).rejects.toThrow(
        /\[SECURITY\]/
      );
      expect(stdout).toEqual([]);
    });

    it('a template the API does not serve is refused before any request', async () => {
      const api = await startApi(sign({ 'templates/other': TEMPLATE }));
      useApi(api);
      await expect(decryptCommand('templates', 'other', false, { manifestKeys: KEYS })).rejects.toThrow(/only claude-md/);
      expect(api.seen.filter((path) => !path.endsWith('/manifest'))).toEqual([]);
    });
  });
});
