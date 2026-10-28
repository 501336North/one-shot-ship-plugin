/**
 * @behavior oss-decrypt checks the prompt manifest's signature with the public key that belongs to the
 *           API address it is talking to: production address -> production key; staging address or a
 *           loopback DEV address -> staging key; any other address -> refused, naming apiUrl.
 * @acceptance-criteria AC-004.x, AC-001.3 (release-channels, Task 10)
 * @business-rule ADR-005 decision 1: the production private key never leaves production, a staging key can
 *                never sign for production users, and an unknown server is never trusted.
 * @boundary publicKeyFor(apiUrl, keys) -> verifyManifestSignature (real Ed25519, throwaway keys made here)
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

import {
  publicKeyFor,
  PINNED_KEYS,
  STAGING_API_URL,
  type ManifestKeys,
} from '../src/manifest-keys.js';
import { DEFAULT_API_URL } from '../src/config.js';
import { verifyManifestSignature, type SignedManifest } from '../src/manifest-verifier.js';

// The production public key that every released oss-decrypt has pinned. Customers' installs verify
// against this; it must never change as a side effect of adding a channel.
const PRODUCTION_KEY_TODAY = 'MCowBQYDK2VwAyEAAwFG32b8TuiVTxrDnXzNrb2v68YN5U9epLnZ3O7pQaI=';

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

function signedManifest(privateKey: string): SignedManifest {
  const prompts = { 'commands/build': { hash: 'abc123', size: 100 } };
  const data = JSON.stringify({ version: 1, algorithm: 'sha256', signing: 'ed25519', prompts });
  const signature = crypto.sign(
    null,
    Buffer.from(data, 'utf8'),
    crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  );
  return {
    version: 1,
    generatedAt: '2026-10-26T00:00:00Z',
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts,
    signature: signature.toString('base64'),
  };
}

const prod = makeKeypair();
const staging = makeKeypair();
const testKeys: ManifestKeys = { production: prod.publicKey, staging: staging.publicKey };
const prodSigned = signedManifest(prod.privateKey);
const stagingSigned = signedManifest(staging.privateKey);

/** Accepted means: a key was chosen for the address and the manifest verifies against it. */
function accepted(apiUrl: string, manifest: SignedManifest, keys: ManifestKeys = testKeys): boolean {
  return verifyManifestSignature(manifest, publicKeyFor(apiUrl, keys));
}

const LOOPBACK_ADDRESSES = [
  'http://localhost',
  'http://localhost:4100',
  'http://127.0.0.1',
  'http://127.0.0.1:4100',
  'http://[::1]',
  'http://[::1]:4100',
];

describe('the manifest key is chosen by the API address', () => {
  it('should accept a production-signed manifest from the production address', () => {
    expect(accepted(DEFAULT_API_URL, prodSigned)).toBe(true);
  });

  it('should accept a staging-signed manifest from the staging address', () => {
    expect(accepted(STAGING_API_URL, stagingSigned)).toBe(true);
  });

  it.each(LOOPBACK_ADDRESSES)('should accept a staging-signed manifest from loopback %s', (apiUrl) => {
    expect(accepted(apiUrl, stagingSigned)).toBe(true);
  });

  it('should refuse a staging-signed manifest from the production address', () => {
    expect(accepted(DEFAULT_API_URL, stagingSigned)).toBe(false);
  });

  it('should refuse a production-signed manifest from the staging address', () => {
    expect(accepted(STAGING_API_URL, prodSigned)).toBe(false);
  });

  it.each(LOOPBACK_ADDRESSES)('should refuse a production-signed manifest from loopback %s', (apiUrl) => {
    expect(accepted(apiUrl, prodSigned)).toBe(false);
  });

  it('should refuse an unknown https address with a message that names apiUrl', () => {
    expect(() => publicKeyFor('https://api.example.com', testKeys)).toThrow(/apiUrl/);
  });

  it('should say which addresses are accepted when it refuses one', () => {
    expect(() => publicKeyFor('https://api.example.com', testKeys)).toThrow(DEFAULT_API_URL);
    expect(() => publicKeyFor('https://api.example.com', testKeys)).toThrow(STAGING_API_URL);
    expect(() => publicKeyFor('https://api.example.com', testKeys)).toThrow(/localhost/);
  });

  it.each([
    ['production host as a prefix of another host', `${DEFAULT_API_URL}.evil.com`],
    ['staging host as a prefix of another host', `${STAGING_API_URL}.evil.com`],
    ['production host with another port', `${DEFAULT_API_URL}:8443`],
    ['userinfo in front of the production host', 'https://user@one-shot-ship-api.onrender.com'],
    ['production host as userinfo of another host', 'https://one-shot-ship-api.onrender.com@evil.com'],
    ['plain http to the production host', 'http://one-shot-ship-api.onrender.com'],
    ['https to a loopback host', 'https://localhost:4100'],
    ['loopback as a label of another host', 'http://localhost.evil.com'],
    ['production host as a subdomain label', 'https://evil.one-shot-ship-api.onrender.com'],
  ])('should refuse a look-alike address: %s', (_why, apiUrl) => {
    expect(() => publicKeyFor(apiUrl, testKeys)).toThrow(/apiUrl/);
  });

  it('should keep the production public key byte-identical to today', () => {
    expect(PINNED_KEYS.production).toBe(PRODUCTION_KEY_TODAY);
    expect(publicKeyFor(DEFAULT_API_URL)).toBe(PRODUCTION_KEY_TODAY);
  });

  it.each([STAGING_API_URL, ...LOOPBACK_ADDRESSES])(
    'should use the pinned staging key for %s (Task 11)',
    (apiUrl) => {
      expect(publicKeyFor(apiUrl)).toBe(PINNED_KEYS.staging);
      expect(publicKeyFor(apiUrl)).not.toBe(PINNED_KEYS.production);
    }
  );

  it('should fail closed, never falling back to the production key, when a build has no staging key', () => {
    const noStaging: ManifestKeys = { production: prod.publicKey, staging: 'PLACEHOLDER-NOT-A-KEY' };
    expect(() => publicKeyFor(STAGING_API_URL, noStaging)).toThrow('staging signing key not configured in this build');
  });

  it('should never hand out the production key for a non-production address', () => {
    const noStaging: ManifestKeys = { production: prod.publicKey, staging: 'PLACEHOLDER-NOT-A-KEY' };
    expect(() => publicKeyFor(STAGING_API_URL, noStaging)).toThrow(/not configured/);
  });
});
