/**
 * Review agents' Read, Grep and Glob calls (R-266 round 9 D-R9-2, round 10 D-R10-1): these tools run
 * in Claude Code itself, outside the review sandbox, so the gate holds them to the sandbox's own
 * read allowlist (review-places.ts, one source for both layers):
 * - under a home folder (HOME and the password-database home, also through the
 *   `/System/Volumes/Data` firmlink), only the reviewed repos, the agent's private folder and the
 *   toolchain folders; never a credential store;
 * - outside the homes, anything but Claude Code's session transcripts (`<temp>/claude-*\/**\/tasks/**`);
 * - `/.vol/…` and `~user/…` paths are refused outright, and so is a Grep or Glob rooted at or above a
 *   home, at `/System/Volumes/Data`, or where it could reach the transcripts.
 * Each path is judged as written and as it is on disk (the nearest existing folder above it
 * resolved). Builders and the main agent are not checked. A few path operations per call, no folder walk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { credentialPaths } from '../credential-places.js';
import { tick } from '../deadline.js';
import { FIRMLINK_ROOT, inTranscripts, linkInto, linkUnder, reviewFoldersRoot, reachesTranscripts, readableUnderHome, transcriptRoots, within, withoutFirmlink, withReal, type ReadPlaces } from '../review-places.js';
import type { Refusal } from './refusal.js';

export const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob']);

const WILDCARD = /[*?[{]/;
/** Longest path or pattern, and most segments, the gate does path work on (same limits as the Bash path check). */
const MAX_CHARS = 4096;
const MAX_SEGMENTS = 512;

/** What a review agent does instead of reading Claude Code's saved outputs (round 11, CR MEDIUM-A). */
const SAVED_OUTPUT = "page the output with `| sed -n 'START,ENDp'` or write it to $TMPDIR and Read it there";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function refused(what: string): Refusal {
  return {
    rule: 'gate-agent-write',
    reason: `Refused by gate-agent-write: ${what}. A review agent may read the repo it reviews, the toolchain folders and system or temp paths, never other files under the home folder, the user's credential stores or Claude Code's session transcripts; report what you need to the main agent.`,
  };
}

/** What the read gate checks a call against. */
export interface ReadScope extends ReadPlaces {
  /** The session's TMPDIR, whose `claude-*` folders hold transcripts too. */
  tmpdir?: string;
  /** Why the reviewed repos can't be used (SEC HIGH-1): every call is refused. */
  problem?: string | null;
}

function expand(p: string, home: string, cwd: string): string {
  if (p === '~' || p.startsWith('~/')) return path.join(home, p.slice(1));
  return path.resolve(cwd, p);
}

/**
 * The path as written and as it is on disk (the nearest existing folder above it resolved, the rest
 * kept), firmlink taken off; the on-disk form last.
 */
function forms(p: string, caseInsensitive: boolean): string[] {
  let at = p;
  const rest: string[] = [];
  let real: string | null = null;
  for (;;) {
    tick();
    try {
      real = path.join(fs.realpathSync(at), ...rest.reverse());
      break;
    } catch {
      if (path.dirname(at) === at) break;
      rest.push(path.basename(at));
      at = path.dirname(at);
    }
  }
  return [...new Set([p, ...(real === null ? [] : [real])].map((form) => withoutFirmlink(form, caseInsensitive)))];
}

/** The path up to its first wildcard segment. */
function fixedPart(glob: string): string {
  const segments = glob.split('/');
  const first = segments.findIndex((segment) => WILDCARD.test(segment));
  return first === -1 ? glob : segments.slice(0, first).join('/') || '/';
}

function tooLong(p: string): boolean {
  return p.length > MAX_CHARS || p.split('/').length > MAX_SEGMENTS;
}

export function checkReviewRead(toolName: string, toolInput: unknown, cwd: string, scope: ReadScope, caseInsensitive: boolean): Refusal | null {
  if (!READ_TOOLS.has(toolName) || typeof toolInput !== 'object' || toolInput === null) return null;
  const input = toolInput as Record<string, unknown>;
  const text = (key: string): string | undefined => (typeof input[key] === 'string' && input[key] !== '' ? (input[key] as string) : undefined);
  const raw = toolName === 'Read' ? [text('file_path')] : [text('path'), text('pattern')];
  for (const word of raw) {
    if (word === undefined) continue;
    if (tooLong(word)) return refused(`a path or pattern over ${MAX_CHARS} characters or ${MAX_SEGMENTS} segments can't be checked`);
    if (/^~[^/]/.test(word)) return refused(`\`~user\` paths are not allowed`);
  }
  if (scope.problem !== undefined && scope.problem !== null) return refused(scope.problem);

  const homes = withReal(scope.homes).map((h) => withoutFirmlink(h, caseInsensitive));
  const home = scope.homes[0] ?? '/';
  // each place as it is on disk, even when it doesn't exist yet (its nearest existing folder resolved)
  const readable = readableUnderHome({ ...scope, privateDir: scope.privateDir }).flatMap((place) => forms(place.at, caseInsensitive).map((at) => ({ at, kind: place.kind })));
  const credentials = credentialPaths(homes);
  const transcripts = transcriptRoots([scope.tmpdir]);
  const fold = (p: string): string => (caseInsensitive ? p.toLowerCase() : p);

  const vol = (p: string): boolean => within('/.vol', p, caseInsensitive);
  const inCredential = (p: string): boolean =>
    credentials.some((place) => (place.kind === 'folder' ? within(place.path, p, caseInsensitive) : place.kind === 'file' ? fold(p) === fold(place.path) : fold(p).startsWith(fold(place.path))));
  // round 11, SEC LOW-3: the other agents' private folders and the session folders above them
  const own0 = scope.privateDir ?? null;
  const agents = own0 === null ? null : reviewFoldersRoot(own0);
  const othersFolder = (p: string): boolean => agents !== null && own0 !== null && within(agents, p, caseInsensitive) && !within(own0, p, caseInsensitive);
  const hidden = (scope.hidden ?? []).flatMap((h) => forms(h, caseInsensitive));
  const inHidden = (p: string): boolean => hidden.some((h) => within(h, p, caseInsensitive));
  const denied = (p: string): boolean => vol(p) || inTranscripts(p, transcripts, caseInsensitive) || inCredential(p) || othersFolder(p) || inHidden(p);
  /** True when the on-disk form is outside the homes, or in a place under one that may be read. */
  const allowedOnDisk = (p: string): boolean =>
    !homes.some((h) => within(h, p, caseInsensitive)) || readable.some((place) => (place.kind === 'file' ? fold(place.at) === fold(p) : within(place.at, p, caseInsensitive)));
  const own = own0;
  /** Every form free of the denied places and of links in the private folder (round 11, SEC CRITICAL-1), and the on-disk form (the last) allowed. */
  const readableForms = (all: readonly string[]): boolean =>
    !all.some(denied) && (own === null || !all.some((p) => linkInto(p, own, caseInsensitive))) && allowedOnDisk(all[all.length - 1] ?? '/');
  // round 11, PERF INFO-2: a reviewed repo in a `claude-*` temp folder may be searched, but not from a transcript folder
  const repoForms = scope.repos.flatMap((r) => forms(r, caseInsensitive));
  const inReviewedRepo = (dir: string): boolean => !inTranscripts(dir, transcripts, caseInsensitive) && repoForms.some((r) => within(r, dir, caseInsensitive));
  /** A search rooted there: not at or above a home, can't reach the transcripts, and readable. */
  const searchable = (all: readonly string[]): boolean =>
    !all.some((dir) => homes.some((h) => within(dir, h, caseInsensitive)) || (reachesTranscripts(dir, transcripts, caseInsensitive) && !inReviewedRepo(dir)) || (agents !== null && within(dir, agents, caseInsensitive)) || hidden.some((h) => within(dir, h, caseInsensitive))) && readableForms(all);

  if (toolName === 'Read') {
    const file = text('file_path');
    if (file === undefined) return null;
    const all = forms(expand(file, home, cwd), caseInsensitive);
    if (readableForms(all)) return null;
    // round 11, CR MEDIUM-A: a saved output of Claude Code's own (a long tool result, a background task)
    const saved = all.some((p) => homes.some((h) => new RegExp(`^${escapeRegex(path.join(h, '.claude', 'projects'))}/[^/]+/[^/]+/tool-results/`, caseInsensitive ? 'i' : '').test(p)) || inTranscripts(p, transcripts, caseInsensitive));
    return refused(`\`${file}\` is outside what a review agent may read${saved ? `; it is a saved tool output: ${SAVED_OUTPUT}` : ''}`);
  }
  const given = text('path') ?? cwd;
  const base = expand(given, home, cwd);
  const firmlinkRoot = (p: string): boolean => within(p, FIRMLINK_ROOT, caseInsensitive);
  // round 12, SEC INFO-A: a search in the private folder follows any link under its root
  const ownSearch = (root: string): Refusal | null => {
    const onDisk = forms(root, caseInsensitive).at(-1) ?? root;
    if (own === null || !within(own, onDisk, caseInsensitive)) return null;
    const found = linkUnder(onDisk);
    if (found === 'none') return null;
    return refused(found === 'link' ? `a search of \`${given}\` would follow a link in your private folder` : `a search of \`${given}\` covers too many entries in your private folder to check`);
  };
  if (toolName === 'Grep') {
    return !firmlinkRoot(base) && searchable(forms(base, caseInsensitive)) ? ownSearch(base) : refused(`a search of \`${given}\` reaches beyond what a review agent may read`);
  }
  const pattern = text('pattern');
  if (pattern === undefined) return null;
  const glob = pattern.startsWith('~') ? expand(pattern, home, cwd) : path.isAbsolute(pattern) ? pattern : `${base}/${pattern}`;
  // round 11, PERF LOW-3: the joined path and pattern are held to the same limits
  if (tooLong(glob)) return refused(`a path or pattern over ${MAX_CHARS} characters or ${MAX_SEGMENTS} segments can't be checked`);
  const fixed = path.normalize(fixedPart(glob));
  // a `..` after the first wildcard climbs out of the folder the search is rooted at
  const climbs = glob.slice(fixedPart(glob).length).split('/').includes('..');
  return !climbs && !firmlinkRoot(fixed) && searchable(forms(fixed, caseInsensitive)) ? ownSearch(fixed) : refused(`the pattern \`${pattern}\` reaches beyond what a review agent may read`);
}
