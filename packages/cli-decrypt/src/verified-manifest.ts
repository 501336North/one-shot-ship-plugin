/**
 * The signed prompt manifest, as oss-decrypt trusts it (FR3): fetched with a 10 s timeout, accepted only when its
 * Ed25519 signature verifies against the address's pinned key, and cached for 300 s per API origin in an
 * owner-only file under <config dir>/run. A cached manifest is re-verified on every read; one that fails is
 * deleted, never trusted. Anything short of a verified manifest is an error: there is no unverified fallback.
 */

import { createHash } from 'crypto';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config.js';
import { writeFileNoFollow } from './safe-write.js';
import { fetchManifest, verifyManifestSignature, type SignedManifest } from './manifest-verifier.js';
import { withDeadline } from './with-deadline.js';

export const MANIFEST_TIMEOUT_MS = 10_000;
export const MANIFEST_CACHE_TTL_MS = 300_000;

const UNAVAILABLE =
  '[SECURITY] The signed prompt manifest could not be fetched from apiUrl. Prompt delivery blocked.';
const BAD_SIGNATURE = '[SECURITY] Manifest signature verification FAILED. Prompt delivery blocked.';

interface CachedManifest {
  origin: string;
  fetchedAt: number;
  manifest: SignedManifest;
}

function runDir(): string {
  return join(getConfigDir(), 'run');
}

function cachePath(origin: string): string {
  return join(runDir(), `manifest-${createHash('sha256').update(origin).digest('hex').slice(0, 16)}.json`);
}

function discard(path: string): null {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
  return null;
}

/** The cached manifest for `origin`, only when fresh and still signed with `publicKey`; otherwise null. */
export function readCachedManifest(origin: string, publicKey: string): SignedManifest | null {
  const path = cachePath(origin);
  let cached: CachedManifest;
  try {
    cached = JSON.parse(readFileSync(path, 'utf8')) as CachedManifest;
  } catch {
    return null;
  }
  const age = Date.now() - cached.fetchedAt;
  const fresh = cached.origin === origin && age >= 0 && age < MANIFEST_CACHE_TTL_MS;
  if (!fresh || !verifyManifestSignature(cached.manifest, publicKey)) return discard(path);
  return cached.manifest;
}

/** Cache the verified manifest owner-only under run/ (writeFileNoFollow); a cache that cannot be written is skipped. */
function writeCachedManifest(origin: string, manifest: SignedManifest): void {
  const entry: CachedManifest = { origin, fetchedAt: Date.now(), manifest };
  try {
    writeFileNoFollow(cachePath(origin), JSON.stringify(entry), { mode: 0o600, dirMode: 0o700, enforceDirMode: true });
  } catch {
    // A cache that cannot be written only costs a fetch next time.
  }
}

/** Fetch the manifest from `origin` (10 s limit), verify it, cache it. Throws unless verified. */
export async function fetchVerifiedManifest(origin: string, publicKey: string): Promise<SignedManifest> {
  const manifest = await withDeadline(
    MANIFEST_TIMEOUT_MS,
    (signal) => fetchManifest(origin, signal),
    () => new Error(UNAVAILABLE)
  );
  if (manifest === null) throw new Error(UNAVAILABLE);
  if (!verifyManifestSignature(manifest, publicKey)) throw new Error(BAD_SIGNATURE);
  writeCachedManifest(origin, manifest);
  return manifest;
}
