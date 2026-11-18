/**
 * @behavior Manifest verifier fetches and validates Ed25519-signed manifest
 * @acceptance-criteria Verify signature, detect tampering, handle fetch errors
 * @boundary CLI Verification
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import {
  MANIFEST_MAX_BYTES,
  verifyManifestSignature,
  fetchManifest,
  type SignedManifest,
} from '../src/manifest-verifier.js';

function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64'),
  };
}

function createTestManifest(privateKey: string): SignedManifest {
  const prompts: Record<string, { hash: string; size: number }> = {
    'commands/plan': { hash: 'abc123', size: 100 },
    'commands/build': { hash: 'def456', size: 200 },
  };
  const sortedKeys = Object.keys(prompts).sort();
  const sortedPrompts: Record<string, { hash: string; size: number }> = {};
  for (const key of sortedKeys) {
    sortedPrompts[key] = prompts[key];
  }
  const data = JSON.stringify({
    version: 1,
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts: sortedPrompts,
  });
  const sig = crypto.sign(
    null,
    Buffer.from(data, 'utf8'),
    crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  );
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts,
    signature: sig.toString('base64'),
  };
}

describe('Manifest Signature Verifier', () => {
  it('should return true for a valid signed manifest', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);

    const result = verifyManifestSignature(manifest, keypair.publicKey);

    expect(result).toBe(true);
  });

  it('should return false when prompts have been tampered with', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);
    manifest.prompts['commands/plan'].hash = 'tampered';

    const result = verifyManifestSignature(manifest, keypair.publicKey);

    expect(result).toBe(false);
  });

  it('should return false when signature is from a different key', () => {
    const keypair1 = generateTestKeypair();
    const keypair2 = generateTestKeypair();
    const manifest = createTestManifest(keypair1.privateKey);

    const result = verifyManifestSignature(manifest, keypair2.publicKey);

    expect(result).toBe(false);
  });

  it('should reject signature when version field is tampered', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);
    manifest.version = 999;

    const result = verifyManifestSignature(manifest, keypair.publicKey);

    expect(result).toBe(false);
  });

  it('should reject signature when algorithm field is tampered', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);
    manifest.algorithm = 'md5';

    const result = verifyManifestSignature(manifest, keypair.publicKey);

    expect(result).toBe(false);
  });

  it('should reject signature when signing field is tampered', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);
    manifest.signing = 'rsa';

    const result = verifyManifestSignature(manifest, keypair.publicKey);

    expect(result).toBe(false);
  });

  it('should produce a manifest verifiable by verifyManifestSignature', () => {
    const keypair = generateTestKeypair();
    const manifest = createTestManifest(keypair.privateKey);

    expect(verifyManifestSignature(manifest, keypair.publicKey)).toBe(true);
  });

  /**
   * @behavior A manifest carrying an own "__proto__" prompt key is refused
   * @business-rule R-273 P1 (Revision 3): a "__proto__" key could otherwise be dropped from the
   *   signed data and later turn into inherited prompt entries
   */
  it('rejects a signed manifest whose prompts has its own "__proto__" key', () => {
    const keypair = generateTestKeypair();
    // Signed over exactly the bytes the verifier would rebuild from it, so the signature itself is good and
    // only the "__proto__" guard can refuse it.
    const prompts =
      '{"__proto__":{"workflows/plan":{"hash":"evil","size":1}},' +
      '"commands/build":{"hash":"def456","size":200},"commands/plan":{"hash":"abc123","size":100}}';
    const signedBytes = Buffer.from(`{"version":1,"algorithm":"sha256","signing":"ed25519","prompts":${prompts}}`, 'utf8');
    const privateKey = crypto.createPrivateKey({ key: Buffer.from(keypair.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
    const publicKey = crypto.createPublicKey({ key: Buffer.from(keypair.publicKey, 'base64'), format: 'der', type: 'spki' });
    const signature = crypto.sign(null, signedBytes, privateKey).toString('base64');
    const withProto = JSON.parse(
      `{"version":1,"generatedAt":"2026-11-18T00:00:00Z","algorithm":"sha256","signing":"ed25519","prompts":${prompts},"signature":"${signature}"}`
    ) as SignedManifest;
    expect(Object.prototype.hasOwnProperty.call(withProto.prompts, '__proto__')).toBe(true);
    expect(crypto.verify(null, signedBytes, publicKey, Buffer.from(signature, 'base64'))).toBe(true);

    expect(verifyManifestSignature(withProto, keypair.publicKey)).toBe(false);
  });

  describe('fetchManifest', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch and parse manifest from API', async () => {
      const keypair = generateTestKeypair();
      const manifest = createTestManifest(keypair.privateKey);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(manifest), { status: 200 })
      );

      const result = await fetchManifest('https://api.example.com');

      expect(result).toEqual(manifest);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/prompts/manifest',
        expect.objectContaining({ method: 'GET' })
      );
    });

    /**
     * @behavior A misbehaving or hostile API cannot make oss-decrypt buffer an endless manifest or follow
     *   a redirect to another host for it
     * @business-rule R-273 ship round 1: the manifest body is capped at MANIFEST_MAX_BYTES (2 MiB) and
     *   redirects are refused, like every other API call
     * @boundary HTTP (a local 127.0.0.1 server)
     */
    describe('bounds (a local server)', () => {
      let server: Server;
      let baseUrl: string;
      let handler: (req: IncomingMessage, res: ServerResponse) => void;

      beforeEach(async () => {
        server = createServer((req, res) => handler(req, res));
        await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      });

      afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>(done => server.close(() => done()));
      });

      const manifestJson = (): string => JSON.stringify(createTestManifest(generateTestKeypair().privateKey));

      it('reads a manifest under the cap', async () => {
        const body = manifestJson();
        handler = (_req, res) => res.end(body);

        expect(await fetchManifest(baseUrl)).toEqual(JSON.parse(body));
      });

      it('refuses a body announced (Content-Length) as larger than the cap', async () => {
        handler = (_req, res) => {
          res.writeHead(200, { 'Content-Length': String(MANIFEST_MAX_BYTES + 1) });
          res.write('{');
        };

        expect(await fetchManifest(baseUrl)).toBeNull();
      });

      it('refuses an endless streamed body once it passes the cap, without waiting for its end', async () => {
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        handler = (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.write('{"pad":"');
          const pump = (): void => {
            while (!res.destroyed && res.write(chunk)) {
              // keep the pipe full
            }
            if (!res.destroyed) res.once('drain', pump);
          };
          pump();
        };

        expect(await fetchManifest(baseUrl)).toBeNull();
      }, 10_000);

      it('refuses a redirect, even to a valid manifest', async () => {
        const body = manifestJson();
        handler = (req, res) => {
          if (req.url === '/elsewhere') {
            res.end(body);
            return;
          }
          res.writeHead(302, { Location: `${baseUrl}/elsewhere` });
          res.end();
        };

        expect(await fetchManifest(baseUrl)).toBeNull();
      });
    });

    it('should return null on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );

      const result = await fetchManifest('https://api.example.com');

      expect(result).toBeNull();
    });
  });
});
