/**
 * The credential stores under a home folder that a review agent may never read (R-266 round 9,
 * D-R9-1 and D-R9-2): the sandbox profile denies them, and the Read/Grep/Glob gate refuses them.
 * One list, so the two can't drift apart. Each is relative to a home folder (HOME, and the user's
 * home from the password database when that differs).
 */

import path from 'node:path';

export interface CredentialPlace {
  /** Relative to the home folder. */
  rel: string;
  /** `folder`: it and everything in it; `file`: that file; `prefix`: every path starting with it (`config.json.bak`). */
  kind: 'folder' | 'file' | 'prefix';
}

export const CREDENTIAL_PLACES: readonly CredentialPlace[] = [
  { rel: '.ssh', kind: 'folder' },
  { rel: '.config/gh', kind: 'folder' },
  { rel: '.aws', kind: 'folder' },
  { rel: '.codex', kind: 'folder' },
  { rel: '.kube', kind: 'folder' },
  { rel: '.gnupg', kind: 'folder' },
  { rel: 'Library/Keychains', kind: 'folder' },
  { rel: '.config/stripe', kind: 'folder' },
  { rel: '.config/gcloud', kind: 'folder' },
  { rel: '.docker/config.json', kind: 'file' },
  { rel: '.netrc', kind: 'file' },
  { rel: '.git-credentials', kind: 'file' },
  { rel: '.npmrc', kind: 'file' },
  { rel: '.claude.json', kind: 'prefix' },
  { rel: '.oss/config.json', kind: 'prefix' },
  { rel: '.oss/credentials', kind: 'prefix' },
  { rel: '.claude/.credentials', kind: 'prefix' },
  // inside toolchain folders the sandbox lets a review agent read
  { rel: '.cargo/credentials', kind: 'prefix' },
  { rel: '.config/git/credentials', kind: 'file' },
  // round 11, CR LOW-B: the new toolchain folders' tokens (pub, Composer, Hackage upload password)
  { rel: '.pub-cache/credentials.json', kind: 'prefix' },
  { rel: '.composer/auth.json', kind: 'prefix' },
  { rel: '.cabal/config', kind: 'prefix' },
];

/** The credential places under each home folder, as absolute paths. */
export function credentialPaths(homes: readonly string[]): { path: string; kind: CredentialPlace['kind'] }[] {
  return homes.flatMap((home) => CREDENTIAL_PLACES.map((place) => ({ path: path.join(home, place.rel), kind: place.kind })));
}
