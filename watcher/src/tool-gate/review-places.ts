/**
 * What a review agent may read (R-266 round 10, D-R10-1): ONE allowlist, shared by the review
 * sandbox's profile (sandbox.ts, for its Bash calls) and the Read/Grep/Glob gate
 * (rules/review-read.ts, for the tools Claude Code runs itself), so the two layers can't drift.
 *
 * - Under a home folder (HOME and the password-database home, also through the
 *   `/System/Volumes/Data` firmlink): only the reviewed repos (real git toplevels), the agent's own
 *   private folder and the read-only toolchain folders below; never the credential stores
 *   (credential-places.ts). Everything else under a home is refused.
 * - Outside the homes, temp and system paths stay readable, except Claude Code's session transcript
 *   folders (`<temp>/claude-*\/<project>/<session>/tasks/**` in /private/tmp and the session TMPDIR).
 * - A readable repo root that is a home, holds one, or holds ~/.oss or ~/.claude makes the call fail
 *   closed (round 10, SEC HIGH-1). Its git folders (a worktree's, a submodule's) are readable roots
 *   too (round 11, CR HIGH-A); other repos and worktrees inside it are not (SEC LOW-1, nested-repos.ts).
 * - Of `<user temp>/oss-review/**`, only the agent's own folder (round 11, SEC LOW-3); a path with a
 *   link in or into it is refused (SEC CRITICAL-1).
 */

import fs from 'node:fs';
import path from 'node:path';

/** The data volume's firmlink: `/System/Volumes/Data/Users/x` is `/Users/x` (round 10, SEC HIGH-2). */
export const FIRMLINK_ROOT = '/System/Volumes/Data';

/**
 * The toolchain places under a home folder a review agent may read (D-R9-1, round 10 CR MEDIUM-3),
 * read-only. `miniconda3` is added on evidence: this Mac's pytest and ruff live there. fnm's own
 * folder only, never `Library/Application Support` as a whole.
 */
export const TOOLCHAIN_PLACES: readonly { rel: string; kind: 'file' | 'folder' }[] = [
  { rel: '.gitconfig', kind: 'file' },
  ...[
    '.config/git',
    '.nvm',
    '.npm',
    '.cargo',
    '.rustup',
    'go',
    '.pyenv',
    '.local/bin',
    '.local/lib',
    '.local/share/uv',
    '.deno',
    '.bun',
    '.volta',
    '.asdf',
    '.rbenv',
    '.sdkman',
    'Library/Caches/pip',
    'Library/pnpm',
    'miniconda3',
    // round 10, CR MEDIUM-3
    'Library/Python',
    '.gem',
    'Library/Caches/pypoetry/virtualenvs',
    '.local/pipx',
    '.local/share/mise',
    '.rvm',
    '.local/share/fnm',
    'Library/Application Support/fnm',
    '.yarn/berry',
    // round 11, CR LOW-B (their credential files stay denied: credential-places.ts)
    '.pub-cache',
    '.virtualenvs',
    '.cabal',
    '.ghcup',
    '.opam',
    '.composer',
  ].map((rel) => ({ rel, kind: 'folder' as const })),
];

/** The user-level folders no readable repo root may hold (round 10, SEC HIGH-1). */
const USER_LEVEL = ['.oss', '.claude'];

/** A readable place: a folder and everything in it, or one file. */
export interface ReadablePlace {
  at: string;
  kind: 'file' | 'folder';
}

/** What a review agent may read under the home folders. */
export interface ReadPlaces {
  /** HOME and the password-database home. */
  homes: readonly string[];
  /** The reviewed repos' roots (real git toplevels). */
  repos: readonly string[];
  /** The agent's own private folder, when known. */
  privateDir?: string | null;
  /** Other repos and worktrees inside the reviewed repos, which stay unreadable (round 11, SEC LOW-1). */
  hidden?: readonly string[];
}

function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** True when `p` is `dir` or inside it (plain prefix compare on normalized absolute paths). */
export function within(dir: string, p: string, caseInsensitive: boolean): boolean {
  const d = caseInsensitive ? dir.toLowerCase() : dir;
  const q = caseInsensitive ? p.toLowerCase() : p;
  return q === d || d === '/' || q.startsWith(`${d}/`);
}

/** The path with the data-volume firmlink taken off (`/System/Volumes/Data/Users/x` is `/Users/x`). */
export function withoutFirmlink(p: string, caseInsensitive: boolean): string {
  let at = p;
  while (within(FIRMLINK_ROOT, at, caseInsensitive)) at = at.slice(FIRMLINK_ROOT.length) || '/';
  return at;
}

/**
 * True when a link on the way to `p` is in the agent's private folder or leads into it (round 11,
 * SEC CRITICAL-1): each part is lstat'ed from `/` down; links elsewhere (`/var`, `/tmp`) are followed.
 */
export function linkInto(p: string, privateDir: string, caseInsensitive: boolean): boolean {
  let at = '/';
  for (const segment of path.normalize(p).split('/').filter((s) => s !== '')) {
    const next = path.join(at, segment);
    const stat = fs.lstatSync(next, { throwIfNoEntry: false });
    if (stat === undefined) return false;
    if (!stat.isSymbolicLink()) {
      at = next;
      continue;
    }
    const target = realOrNull(next);
    if (within(privateDir, next, caseInsensitive) || target === null || within(privateDir, target, caseInsensitive)) return true;
    at = target;
  }
  return false;
}

/** Most entries looked at under a search root in the private folder (round 12, SEC INFO-A); more is refused. */
export const MAX_PRIVATE_ENTRIES = 5000;

/**
 * Whether any entry under `dir` is a symlink (round 12, SEC INFO-A: Grep and Glob follow them),
 * looking at no more than `max` entries: 'link', 'too-many' (the bound was hit), or 'none'.
 */
export function linkUnder(dir: string, max = MAX_PRIVATE_ENTRIES): 'link' | 'too-many' | 'none' {
  const todo = [dir];
  let seen = 0;
  for (let at = todo.pop(); at !== undefined; at = todo.pop()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > max) return 'too-many';
      if (entry.isSymbolicLink()) return 'link';
      if (entry.isDirectory()) todo.push(path.join(at, entry.name));
    }
  }
  return 'none';
}

/** The `oss-review` folder above the agent's private folder (all agents' folders), or null (round 11, SEC LOW-3). */
export function reviewFoldersRoot(privateDir: string): string | null {
  for (let at = privateDir; path.dirname(at) !== at; at = path.dirname(at)) if (path.basename(at) === 'oss-review') return at;
  return null;
}

/** Each path as given and as it is on disk, without duplicates. */
export function withReal(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap((p) => [p, realOrNull(p) ?? p]))];
}

/** The places under the home folders a review agent may read: the repos, its private folder, the toolchain. */
export function readableUnderHome(places: ReadPlaces): ReadablePlace[] {
  const toolchain = places.homes.flatMap((home) => TOOLCHAIN_PLACES.map((place) => ({ at: path.join(home, place.rel), kind: place.kind })));
  const own = places.privateDir === undefined || places.privateDir === null ? [] : [{ at: places.privateDir, kind: 'folder' as const }];
  return [...places.repos.map((at) => ({ at, kind: 'folder' as const })), ...own, ...toolchain];
}

/**
 * The temp folders Claude Code keeps session transcripts in (`claude-*` below them): /tmp, and the
 * session's TMPDIR, as given and on disk.
 */
export function transcriptRoots(tmpdirs: readonly (string | undefined)[]): string[] {
  const given = ['/tmp', '/private/tmp', ...tmpdirs.filter((t): t is string => t !== undefined && path.isAbsolute(t)).map((t) => path.normalize(t).replace(/(.)\/+$/, '$1'))];
  return withReal(given).filter((p) => p !== '/');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The regex (JS and SBPL) for a transcript folder's contents under one temp folder, at the transcript
 * depth only: `<root>/claude-<uid>/<project>/<session>/tasks/**` (round 12, PERF INFO-1: a `tasks`
 * folder deeper down, in a reviewed repo, is not one).
 */
export function transcriptPattern(root: string): string {
  return `^${escapeRegex(root)}/claude-[^/]+/[^/]+/[^/]+/tasks(/|$)`;
}

/** True when the path is in a session transcript folder under one of the roots. */
export function inTranscripts(p: string, roots: readonly string[], caseInsensitive: boolean): boolean {
  return roots.some((root) => new RegExp(transcriptPattern(root), caseInsensitive ? 'i' : '').test(p));
}

/** True when the folder is at or above a transcript root, or inside a `claude-*` folder there: a search could reach a transcript. */
export function reachesTranscripts(dir: string, roots: readonly string[], caseInsensitive: boolean): boolean {
  return roots.some((root) => within(dir, root, caseInsensitive) || new RegExp(`^${escapeRegex(root)}/claude-[^/]+(/|$)`, caseInsensitive ? 'i' : '').test(dir));
}

/**
 * Why the readable repo roots can't be used (round 10, SEC HIGH-1), or null: a root that is a home
 * folder, holds one, or holds ~/.oss or ~/.claude (as given or on disk) would open them all.
 */
export function readRootsProblem(roots: readonly string[], homes: readonly string[], caseInsensitive: boolean): string | null {
  const guarded = withReal([...homes, ...homes.flatMap((home) => USER_LEVEL.map((rel) => path.join(home, rel)))]);
  for (const root of withReal(roots)) {
    const hit = guarded.find((p) => within(root, p, caseInsensitive));
    if (hit !== undefined) return `the reviewed repo \`${root}\` is or holds the home folder or ~/.oss or ~/.claude`;
  }
  return null;
}
