/**
 * @behavior The faster protected-path checks (round 10) decide every path exactly as the checks before
 *   them did: the same paths are protected, the same folders hold protected paths, and the same
 *   folders lie at or above another, letter case ignored or not.
 * @business-rule R-266 round 10, PERF MEDIUM-1: speeding the checks up must not change what is refused.
 * @boundary isProtected, holdsProtected, isSameOrAncestor (rules/protected-path.ts) and matchAnyPath
 *   (patterns.ts), against copies of the round-9 functions kept here for this comparison only, on
 *   paths generated from a fixed seed.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchAnyPath, matchPath } from '../../../src/tool-gate/patterns.js';
import { holdsProtected, isProtected, isSameOrAncestor, type Places } from '../../../src/tool-gate/rules/protected-path.js';
import type { GateSettings } from '../../../src/tool-gate/rule-file.js';
import type { PathResolver } from '../../../src/tool-gate/path-resolver.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const BASE = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), 'utf8')) as { protectedPaths: string[] };

// ---- the round-9 functions, copied for this comparison only -------------------------------------
const OLD_WILDCARD = /[*?]/;

function oldIsSameOrAncestor(dir: string, of: string, caseInsensitive: boolean): boolean {
  const relative = caseInsensitive ? path.relative(dir.toLowerCase(), of.toLowerCase()) : path.relative(dir, of);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function oldFixedFolder(glob: string, at: Places): string {
  let full: string;
  if (glob.startsWith('~/')) full = path.join(at.home, glob.slice(2));
  else if (path.isAbsolute(glob)) full = path.normalize(glob);
  else full = path.join(at.root, glob);
  const segments = full.split(path.sep);
  const first = segments.findIndex((segment) => OLD_WILDCARD.test(segment));
  return first === -1 ? full : segments.slice(0, first).join(path.sep) || path.sep;
}

function oldFormsOf(absPath: string, paths: PathResolver): string[] {
  return [path.normalize(absPath), paths.realpath(absPath)];
}

function oldMatchAnyPath(globs: readonly string[], absPath: string, at: Places): boolean {
  return globs.some((glob) => matchPath(glob, absPath, at));
}

function oldIsProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  return oldFormsOf(absPath, paths).some((p) => places.some((at) => oldMatchAnyPath(settings.protectedPaths, p, at)));
}

/**
 * Round 21 (SEC HIGH-2) widened "holds" on purpose: a folder a glob's head matches (`**\/.git/hooks` of
 * `**\/.git/hooks/**`) holds what the glob matches below it. The reference adds that rule, written plainly.
 */
function oldFolderHeads(globs: readonly string[]): string[] {
  return globs.flatMap((glob) => {
    const segments = glob.split('/');
    return segments.slice(1).map((_, k) => segments.slice(0, k + 1)).filter((head) => head.some((s) => s.replace(/\*/g, '') !== '')).map((head) => head.join('/'));
  });
}

/** The reference's per-list work, built once per settings list and place rather than once per path. */
const oldHeadsCache = new WeakMap<readonly string[], string[]>();
const oldFixedCache = new WeakMap<readonly string[], WeakMap<Places, string[]>>();

function cachedFolderHeads(globs: readonly string[]): string[] {
  let heads = oldHeadsCache.get(globs);
  if (heads === undefined) {
    heads = oldFolderHeads(globs);
    oldHeadsCache.set(globs, heads);
  }
  return heads;
}

function cachedFixedFolders(globs: readonly string[], at: Places): string[] {
  let byPlace = oldFixedCache.get(globs);
  if (byPlace === undefined) {
    byPlace = new WeakMap();
    oldFixedCache.set(globs, byPlace);
  }
  let folders = byPlace.get(at);
  if (folders === undefined) {
    folders = globs.map((g) => oldFixedFolder(g, at));
    byPlace.set(at, folders);
  }
  return folders;
}

function oldHoldsProtected(absPath: string, settings: GateSettings, places: Places[], paths: PathResolver): boolean {
  return oldFormsOf(absPath, paths).some((p) =>
    places.some(
      (at) =>
        cachedFixedFolders(settings.protectedPaths, at).some((f) => oldIsSameOrAncestor(p, f, at.caseInsensitive === true)) ||
        oldMatchAnyPath(cachedFolderHeads(settings.protectedPaths), p, at),
    ),
  );
}
// --------------------------------------------------------------------------------------------------

/** A fixed-seed generator (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOT = '/w/repo';
const HOME = '/h/u';
const NAMES = [
  '.git', '.GIT', 'hooks', 'HOOKS', 'config', 'Config', 'HEAD', '.oss', '.OSS', 'tool-gates.json', 'tool-gates', 'x', '..', '.', '',
  'src', 'file.txt', 'refs', 'worktrees', 'a', 'modules', '.claude', 'settings.json', 'settings.local.json', 'plugins', 'node-path',
  'packed-refs', 'commondir', 'gitdir', 'config.worktree', '.gitconfig', 'git', 'w', 'repo', 'h', 'u', 'link', 'İx', 'workflow-state.json',
  'ab', 'axb', 'a?b', 'a*b', '[x]',
];
const STARTS = ['/', `${ROOT}/`, `${HOME}/`, '/w/link/', '/h/l/', '/W/Repo/', '/H/U/', '/w/', '/h/', `${ROOT}/sub/`];

/** A resolver that follows two made-up links (`/w/link` → the repo, `/h/l` → home). */
const resolver: PathResolver = {
  realpath(p: string): string {
    const n = path.normalize(p);
    if (n === '/w/link' || n.startsWith('/w/link/')) return ROOT + n.slice('/w/link'.length);
    if (n === '/h/l' || n.startsWith('/h/l/')) return HOME + n.slice('/h/l'.length);
    return n;
  },
};

function randomPath(next: () => number): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const depth = Math.floor(next() * 7);
  const names = Array.from({ length: depth }, () => pick(NAMES));
  const p = pick(STARTS) + names.join(next() < 0.1 ? '//' : '/');
  return next() < 0.1 ? `${p}/` : p;
}

const SETTINGS_LISTS: string[][] = [
  BASE.protectedPaths,
  [...BASE.protectedPaths, '.oss/*/x', '~/a?b/**', '/w/repo/src/**', '**/x*y/**', 'src/a', '~/.config/git/config', '/abs/**', '**/HEAD'],
];

describe('the faster protected-path checks decide as the round-9 checks did', () => {
  for (const [n, protectedPaths] of SETTINGS_LISTS.entries()) {
    const settings = { protectedPaths } as GateSettings;
    for (const caseInsensitive of [false, true]) {
      it(`on 4,000 generated paths (rule list ${n}, case ${caseInsensitive ? 'ignored' : 'kept'})`, () => {
        const places: Places[] = [
          { home: HOME, root: ROOT, caseInsensitive },
          { home: resolver.realpath(HOME), root: resolver.realpath(ROOT), caseInsensitive },
        ];
        const next = random(0x5eed + n * 2 + (caseInsensitive ? 1 : 0));
        const differences: string[] = [];
        for (let i = 0; i < 4_000; i++) {
          const p = randomPath(next);
          const q = randomPath(next);
          if (isProtected(p, settings, places, resolver) !== oldIsProtected(p, settings, places, resolver)) differences.push(`isProtected ${p}`);
          if (holdsProtected(p, settings, places, resolver) !== oldHoldsProtected(p, settings, places, resolver)) differences.push(`holdsProtected ${p}`);
          if (isSameOrAncestor(p, q, caseInsensitive) !== oldIsSameOrAncestor(p, q, caseInsensitive)) differences.push(`isSameOrAncestor ${p} ${q}`);
          if (matchAnyPath(protectedPaths, p, places[0]) !== oldMatchAnyPath(protectedPaths, p, places[0])) differences.push(`matchAnyPath ${p}`);
        }
        expect(differences.slice(0, 10)).toEqual([]);
        // ~2.5 s idle and 6-7 s under heavy load, past vitest's 5 s default; the check is what matters, not the time.
      }, 30_000);
    }
  }
});
