/**
 * @behavior `oss-decrypt --verify-body <key>` tells a hook whether the body it fetched (IRON LAWS or
 *   the CLAUDE.md template) is byte-for-byte what the signed manifest says the server served.
 * @business-rule R-273 D12: a hook writes CLAUDE.md only from a body whose sha256 equals the signed
 *   manifest's `servedHash`; anything unverifiable exits non-zero, prints nothing, and says why.
 * @boundary CLI Entry Point (stdin, network fetch, config dir)
 *
 * Boundaries mocked: the network (`fetch`), stdin, and the config dir (an empty temp dir). The
 * signature check runs the real Ed25519 verifier; only the public key is swapped for a test key,
 * and only when the CLI asks for the production key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'crypto';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { VERIFY_BODY_STDIN_TIMEOUT_MS, runCli } from '../src/cli-entry.js';
import * as manifestVerifier from '../src/manifest-verifier.js';
import { MIN_MANIFEST_VERSION } from '../src/manifest-floor.js';
import type { ManifestPromptEntry, SignedManifest } from '../src/manifest-verifier.js';

vi.mock('../src/manifest-verifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/manifest-verifier.js')>();
  return { ...actual, verifyManifestSignature: vi.fn(actual.verifyManifestSignature) };
});

const { verifyManifestSignature: verifySignatureForReal } = await vi.importActual<
  typeof import('../src/manifest-verifier.js')
>('../src/manifest-verifier.js');

const PROD_PUBLIC_KEY = 'MCowBQYDK2VwAyEAAwFG32b8TuiVTxrDnXzNrb2v68YN5U9epLnZ3O7pQaI=';

const testKeys = generateKeyPairSync('ed25519');
const otherKeys = generateKeyPairSync('ed25519');
const TEST_PUBLIC_KEY = testKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

const IRON_LAWS = Buffer.from('# IRON LAWS\n\nNO PRODUCTION CODE WITHOUT A FAILING TEST FIRST\n', 'utf8');
const TEMPLATE_CRLF = Buffer.from('# CLAUDE.md template\r\nUse TDD.\r\n', 'utf8');

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function signedManifest(
  prompts: Record<string, ManifestPromptEntry>,
  options: { version?: number; key?: KeyObject } = {}
): SignedManifest {
  const version = options.version ?? MIN_MANIFEST_VERSION + 10;
  const sorted: Record<string, ManifestPromptEntry> = Object.create(null);
  for (const k of Object.keys(prompts).sort()) sorted[k] = prompts[k];
  const body = { version, algorithm: 'sha256', signing: 'ed25519', prompts: sorted };
  const signature = sign(null, Buffer.from(JSON.stringify(body), 'utf8'), options.key ?? testKeys.privateKey);
  return { ...body, prompts, generatedAt: '2026-11-18T00:00:00Z', signature: signature.toString('base64') };
}

function entry(bytes: Buffer): ManifestPromptEntry {
  return { hash: 'unused', size: bytes.length, servedHash: sha256(bytes) };
}

const LIVE_PROMPTS: Record<string, ManifestPromptEntry> = {
  'shared/iron-laws': entry(IRON_LAWS),
  'templates/claude-md': entry(TEMPLATE_CRLF),
  'commands/plan': entry(Buffer.from('plan')),
  'workflows/plan': entry(Buffer.from('plan')),
};

let configDir: string;
let stderr: string[];
let stdout: string[];
let fetchMock: ReturnType<typeof vi.fn>;

function serveManifest(manifest: SignedManifest): void {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(manifest), { status: 200 }));
}

function giveStdin(bytes: Buffer): void {
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from([bytes]) as unknown as typeof process.stdin);
}

async function verifyBody(key: string, bytes: Buffer): Promise<number> {
  giveStdin(bytes);
  await runCli(['--verify-body', key]);
  return Number(process.exitCode ?? 0);
}

function expectRefusedWithReason(code: number): void {
  expect(code).not.toBe(0);
  expect(stdout).toEqual([]);
  expect(stderr).toHaveLength(1);
  expect(stderr[0].trim()).not.toBe('');
  expect(stderr[0].trim()).not.toContain('\n');
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'oss-verify-body-'));
  process.env.OSS_CONFIG_DIR = configDir;
  process.exitCode = undefined;
  stderr = [];
  stdout = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  serveManifest(signedManifest(LIVE_PROMPTS));
  vi.mocked(manifestVerifier.verifyManifestSignature).mockImplementation(
    (manifest: SignedManifest, publicKey: string) =>
      publicKey === PROD_PUBLIC_KEY && verifySignatureForReal(manifest, TEST_PUBLIC_KEY)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.OSS_CONFIG_DIR;
  process.exitCode = undefined;
  rmSync(configDir, { recursive: true, force: true });
});

describe('oss-decrypt --verify-body <key>', () => {
  it('exits 0 when the stdin bytes are exactly what the signed manifest says was served', async () => {
    const code = await verifyBody('shared/iron-laws', IRON_LAWS);

    expect(code).toBe(0);
    expect(stdout).toEqual([]);
  });

  it('accepts the CLAUDE.md template the same way', async () => {
    expect(await verifyBody('templates/claude-md', TEMPLATE_CRLF)).toBe(0);
  });

  it('works on a machine with no stored credentials (the manifest is public)', async () => {
    expect(readdirSync(configDir)).toEqual([]);

    expect(await verifyBody('shared/iron-laws', IRON_LAWS)).toBe(0);
  });

  it('works on a machine with no ~/.oss at all (the config dir does not exist)', async () => {
    process.env.OSS_CONFIG_DIR = join(configDir, 'absent', '.oss');

    expect(await verifyBody('shared/iron-laws', IRON_LAWS)).toBe(0);
    expect(stderr).toEqual([]);
  });

  it('refuses a body with one byte changed', async () => {
    const tampered = Buffer.from(IRON_LAWS);
    tampered[tampered.length - 2] ^= 0x01;

    expectRefusedWithReason(await verifyBody('shared/iron-laws', tampered));
  });

  it('refuses a body with a lookalike letter swapped in (Latin "O" → Cyrillic "О")', async () => {
    const lookalike = Buffer.from(IRON_LAWS.toString('utf8').replace('NO PRODUCTION', 'О PRODUCTION'), 'utf8');

    expectRefusedWithReason(await verifyBody('shared/iron-laws', lookalike));
  });

  it.each(['commands/plan', 'workflows/plan', 'shared/unknown', '__proto__', 'constructor', 'hasOwnProperty', ''])(
    'refuses the key %j: only shared/iron-laws and templates/claude-md are verifiable bodies',
    async (key) => {
      expectRefusedWithReason(await verifyBody(key, Buffer.from('plan')));
    }
  );

  it('refuses when no key is given', async () => {
    giveStdin(IRON_LAWS);
    await runCli(['--verify-body']);

    expectRefusedWithReason(Number(process.exitCode ?? 0));
  });

  it('refuses when the manifest is still unreachable after the retry', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    expectRefusedWithReason(await verifyBody('shared/iron-laws', IRON_LAWS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // no prompt is being verified here: the line says only that the manifest was unreachable
    expect(stderr).toEqual(['[SECURITY] Manifest unreachable — check your connection and run the command again']);
  });

  it('refuses a manifest whose signature does not verify', async () => {
    serveManifest(signedManifest(LIVE_PROMPTS, { key: otherKeys.privateKey }));

    expectRefusedWithReason(await verifyBody('shared/iron-laws', IRON_LAWS));
  });

  it('refuses a correctly signed manifest older than the floor', async () => {
    serveManifest(signedManifest(LIVE_PROMPTS, { version: MIN_MANIFEST_VERSION - 1 }));

    expectRefusedWithReason(await verifyBody('shared/iron-laws', IRON_LAWS));
  });

  it('refuses an allowed key whose manifest entry has no servedHash', async () => {
    const { servedHash: _dropped, ...noServedHash } = entry(IRON_LAWS);
    serveManifest(signedManifest({ 'shared/iron-laws': noServedHash }));

    expectRefusedWithReason(await verifyBody('shared/iron-laws', IRON_LAWS));
  });

  it('refuses an allowed key that is missing from the manifest', async () => {
    serveManifest(signedManifest({ 'templates/claude-md': entry(TEMPLATE_CRLF) }));

    expectRefusedWithReason(await verifyBody('shared/iron-laws', IRON_LAWS));
  });

  it('hashes a body ending in "\\n" exactly as given (no trimming)', async () => {
    expect(await verifyBody('shared/iron-laws', IRON_LAWS)).toBe(0);
    process.exitCode = undefined;
    stderr = [];
    expectRefusedWithReason(await verifyBody('shared/iron-laws', IRON_LAWS.subarray(0, IRON_LAWS.length - 1)));
  });

  it('hashes a body ending in "\\r\\n" exactly as given (no trimming)', async () => {
    expect(await verifyBody('templates/claude-md', TEMPLATE_CRLF)).toBe(0);
    process.exitCode = undefined;
    stderr = [];
    expectRefusedWithReason(
      await verifyBody('templates/claude-md', TEMPLATE_CRLF.subarray(0, TEMPLATE_CRLF.length - 2))
    );
  });

  it('refuses stdin larger than 1 MiB, even when the manifest would match it', async () => {
    const huge = Buffer.alloc(1024 * 1024 + 1, 0x61);
    serveManifest(signedManifest({ 'shared/iron-laws': entry(huge) }));

    expectRefusedWithReason(await verifyBody('shared/iron-laws', huge));
  });
});

/**
 * @behavior --verify-body never waits forever for a body: a terminal on stdin, or a pipe that never closes, is refused
 * @business-rule R-273 ship round 1: the body must be piped in; the read has a 30 s deadline (VERIFY_BODY_STDIN_TIMEOUT_MS)
 * @boundary CLI Entry Point (stdin)
 */
describe('oss-decrypt --verify-body stdin', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the stdin deadline is 30 seconds', () => {
    expect(VERIFY_BODY_STDIN_TIMEOUT_MS).toBe(30_000);
  });

  it('refuses a terminal on stdin (the body must be piped) without reading or fetching', async () => {
    const tty = Object.assign(Readable.from([IRON_LAWS]), { isTTY: true });
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(tty as unknown as typeof process.stdin);

    await runCli(['--verify-body', 'shared/iron-laws']);

    expectRefusedWithReason(Number(process.exitCode ?? 0));
    expect(stderr[0]).toMatch(/piped/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a body that has not ended by the deadline', async () => {
    vi.useFakeTimers();
    const endless = new Readable({ read() {} });
    endless.push(IRON_LAWS);
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(endless as unknown as typeof process.stdin);

    const run = runCli(['--verify-body', 'shared/iron-laws']);
    await vi.advanceTimersByTimeAsync(VERIFY_BODY_STDIN_TIMEOUT_MS + 10);
    await run;

    expectRefusedWithReason(Number(process.exitCode ?? 0));
    expect(stderr[0]).toMatch(/30 s/);
    endless.destroy();
  });
});

/**
 * @behavior --verify-body answers sooner: the manifest is requested while the body is still being read
 * @business-rule R-273 ship round 2 (perf F2): same checks and the same single reason line; a body refused
 *   on its own (too large, never ended) prints only that reason, even if the manifest is unreachable
 * @boundary CLI Entry Point (stdin, network fetch)
 */
describe('oss-decrypt --verify-body reads stdin and fetches the manifest at the same time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the manifest request is in flight before stdin has ended, and the body still verifies', async () => {
    const pending = new Readable({ read() {} });
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(pending as unknown as typeof process.stdin);

    const run = runCli(['--verify-body', 'shared/iron-laws']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.push(IRON_LAWS);
    pending.push(null);
    await run;

    expect(Number(process.exitCode ?? 0)).toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
  });

  it('a body over 1 MiB with the manifest unreachable: only the size reason is printed', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    giveStdin(Buffer.alloc(1024 * 1024 + 1, 0x61));

    await runCli(['--verify-body', 'shared/iron-laws']);
    await vi.advanceTimersByTimeAsync(20_000);

    expectRefusedWithReason(Number(process.exitCode ?? 0));
    expect(stderr[0]).toMatch(/larger than/);
    // the manifest request was cancelled: no retry went out after the body was refused
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a body that never ends with the manifest unreachable: only the deadline reason is printed', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const endless = new Readable({ read() {} });
    endless.push(IRON_LAWS);
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(endless as unknown as typeof process.stdin);

    const run = runCli(['--verify-body', 'shared/iron-laws']);
    await vi.advanceTimersByTimeAsync(VERIFY_BODY_STDIN_TIMEOUT_MS + 10);
    await run;
    await vi.advanceTimersByTimeAsync(20_000);

    expectRefusedWithReason(Number(process.exitCode ?? 0));
    expect(stderr[0]).toMatch(/30 s/);
    // both manifest attempts ended long before the 30 s deadline; nothing more went out after the refusal
    expect(fetchMock).toHaveBeenCalledTimes(2);
    endless.destroy();
  });
});
