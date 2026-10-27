/**
 * The signed prompt manifest, as oss-decrypt trusts it (FR3): fetched with a 10 s timeout, accepted only when its
 * Ed25519 signature verifies against the address's pinned key, and cached for 300 s per API origin in an
 * owner-only file under <config dir>/run. A cached manifest is re-verified on every read; one that fails is
 * deleted, never trusted. Anything short of a verified manifest is an error: there is no unverified fallback.
 */

import { createHash, randomBytes } from 'crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { getConfigDir } from './config.js';
import { fetchManifest, verifyManifestSignature, type SignedManifest } from './manifest-verifier.js';

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

/**
 * Write the cache without ever following a symlink: run/ is opened O_NOFOLLOW and must be a directory owned by this
 * user (else caching is skipped), its mode is fixed through that descriptor, and the entry is written to a fresh
 * O_EXCL temp file in run/ and renamed over the cache path (rename replaces a link, it never writes through one).
 */
function writeCachedManifest(origin: string, manifest: SignedManifest): void {
  const dir = runDir();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.()) return;
      fchmodSync(fd, 0o700);
    } finally {
      closeSync(fd);
    }
    const entry: CachedManifest = { origin, fetchedAt: Date.now(), manifest };
    const temp = join(dir, `.manifest-${randomBytes(8).toString('hex')}.tmp`);
    writeFileSync(temp, JSON.stringify(entry), { mode: 0o600, flag: 'wx' });
    renameSync(temp, cachePath(origin));
  } catch {
    // A cache that cannot be written only costs a fetch next time.
  }
}

/** Fetch the manifest from `origin` (10 s limit), verify it, cache it. Throws unless verified. */
export async function fetchVerifiedManifest(origin: string, publicKey: string): Promise<SignedManifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  let manifest: SignedManifest | null;
  try {
    manifest = await fetchManifest(origin, controller.signal);
  } finally {
    clearTimeout(timer);
  }
  if (manifest === null) throw new Error(UNAVAILABLE);
  if (!verifyManifestSignature(manifest, publicKey)) throw new Error(BAD_SIGNATURE);
  writeCachedManifest(origin, manifest);
  return manifest;
}
