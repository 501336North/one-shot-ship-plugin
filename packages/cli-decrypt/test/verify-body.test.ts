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

import { runCli } from '../src/cli-entry.js';
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
