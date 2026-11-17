/**
 * Pattern matchers for the tool gate. The patterns themselves come from the rule file
 * (config/tool-gates.json and the repo's .oss/tool-gates.json); this module holds none.
 *
 * - matchPath / matchAnyPath: path globs. `~/` is the user's home, a leading `**\/` matches at any depth
 *   (also outside the repo, by the path's tail), other relative globs are anchored at the
 *   repo root. `*` and `?` stay within one segment and match dotfiles; `**` crosses
 *   segments; a trailing `/**` matches what is under a folder, not the folder itself.
 * - matchCommand: the command's leading words match the pattern words one by one, each as
 *   a whole word where `*` matches any characters.
 */

import path from 'node:path';
import { tick } from './deadline.js';

/*
 * Matching is done without regular expressions, so no pattern can make it slow: a pattern from
 * a repo rule file (many `**` segments, or `a*a*a*b`) would make a backtracking regex take
 * seconds, and the hook allows the call when it times out. The classic greedy wildcard walk
 * below takes at most (pattern length x text length) steps.
 */

/** Glob syntax (code, not a rule value): a segment that is exactly `**` spans any number of folders. */
const ANY_FOLDERS = '**';
/** A segment that matches one folder or file name with at least one character. */
const ONE_NAME = '?*';

/**
 * Greedy wildcard match: `isStar` atoms match any run (also empty) of text items, every other
 * atom matches exactly one item when `matches` says so. On a mismatch it retries from the last
 * star with one more item swallowed, so each (atom, item) pair is tried a bounded number of times.
 */
function wildcardMatch<P, T>(
  pattern: ArrayLike<P>,
  text: ArrayLike<T>,
  isStar: (atom: P) => boolean,
  matches: (atom: P, item: T) => boolean,
): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    tick();
    if (p < pattern.length && isStar(pattern[p])) {
      star = p++;
      mark = t;
    } else if (p < pattern.length && matches(pattern[p], text[t])) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && isStar(pattern[p])) p++;
  return p === pattern.length;
}

/** One name against one glob segment: `*` is any run of characters, `?` any one character. */
function segmentMatches(glob: string, name: string): boolean {
  return wildcardMatch(
    glob,
    name,
    (c) => c === '*',
    (c, d) => c === '?' || c === d,
  );
}

/** The glob's segments; a trailing `/**` needs at least one name below the folder, not the folder itself. */
function globSegments(glob: string): string[] {
  const segments = glob.split('/');
  if (segments.length > 1 && segments[segments.length - 1] === ANY_FOLDERS) {
    segments.splice(segments.length - 1, 1, ONE_NAME, ANY_FOLDERS);
  }
  return segments;
}

function segmentsMatch(glob: readonly string[], target: readonly string[]): boolean {
  return wildcardMatch(glob, target, (s) => s === ANY_FOLDERS, segmentMatches);
}

/** Where relative globs are anchored, and whether letter case is ignored (a case-insensitive file system). */
export interface PathMatchOptions {
  home: string;
  root: string;
  caseInsensitive?: boolean;
}

/** The glob anchored as `opts` says, split into segments (lowercased on a case-insensitive file system). */
function compile(glob: string, opts: PathMatchOptions): string[] {
  let full: string;
  if (glob.startsWith('~/')) full = path.join(opts.home, glob.slice(2));
  else if (glob.startsWith('**/') || path.isAbsolute(glob)) full = path.normalize(glob);
  else full = path.join(opts.root, glob);
  return globSegments(opts.caseInsensitive === true ? full.toLowerCase() : full);
}

function targetOf(absPath: string, opts: PathMatchOptions): string[] {
  const target = path.normalize(absPath);
  return (opts.caseInsensitive === true ? target.toLowerCase() : target).split('/');
}

export function matchPath(glob: string, absPath: string, opts: PathMatchOptions): boolean {
  return segmentsMatch(compile(glob, opts), targetOf(absPath, opts));
}

/**
 * A compiled glob, and its segments with no wildcard: each of those matches only a name equal to it,
 * so a path lacking one of them can't match, and the wildcard walk is skipped (round 10, PERF MEDIUM-1).
 */
interface CompiledGlob {
  segments: string[];
  literals: string[];
}

/**
 * Compiled glob lists, per anchoring and per list. The gate makes its anchorings once per call,
 * so each glob is compiled once per call, not once per word it is matched against.
 */
const compiled = new WeakMap<PathMatchOptions, WeakMap<readonly string[], CompiledGlob[]>>();

function compiledList(globs: readonly string[], opts: PathMatchOptions): CompiledGlob[] {
  let lists = compiled.get(opts);
  if (lists === undefined) {
    lists = new WeakMap();
    compiled.set(opts, lists);
  }
  let list = lists.get(globs);
  if (list === undefined) {
    list = globs.map((glob) => {
      const segments = compile(glob, opts);
      return { segments, literals: [...new Set(segments.filter((s) => !s.includes('*') && !s.includes('?')))] };
    });
    lists.set(globs, list);
  }
  return list;
}

/** True when any of the globs matches the path (see matchPath). */
export function matchAnyPath(globs: readonly string[], absPath: string, opts: PathMatchOptions): boolean {
  const target = targetOf(absPath, opts);
  const names = new Set(target);
  return compiledList(globs, opts).some(({ segments, literals }) => literals.every((name) => names.has(name)) && segmentsMatch(segments, target));
}

/** A whole word against a pattern word where `*` is any run of characters (`?` is plain text). */
function wordMatches(patternWord: string, word: string): boolean {
  return wildcardMatch(
    patternWord,
    word,
    (c) => c === '*',
    (c, d) => c === d,
  );
}

export function matchCommand(pattern: string, words: string[]): boolean {
  const patternWords = pattern.split(' ');
  return (
    words.length >= patternWords.length &&
    patternWords.every((patternWord, i) => wordMatches(patternWord, words[i] ?? ''))
  );
}

/*
 * Shell wildcards (`.oss/*`, `.os?`, `tool-gate[s]`): the shell expands them to whatever matches
 * when the command runs, so the gate asks whether a pattern COULD match a protected path, without
 * listing the disk. Both sides are globs, so this is an intersection test, done segment by
 * segment and, within a segment, character by character, as a walk over pairs of positions
 * (each pair visited once, so it stays linear in the product of the lengths).
 */

/** Characters that make a word a shell pattern, and the escape that keeps one literal (shell syntax). */
const SHELL_GLOB_CHARS = /[*?[\]\\]/g;

/** `text` with every shell wildcard character escaped, so it reads as plain text inside a pattern. */
export function escapeGlob(text: string): string {
  return text.replace(SHELL_GLOB_CHARS, '\\$&');
}

/**
 * A shell pattern for `glob` (`~/` expanded) joined as text onto `base`, itself a pattern (a plain
 * folder goes through escapeGlob first); `..` is kept, as joinRaw does.
 */
export function globPathOf(glob: string, base: string, home: string): string {
  let expanded = glob;
  if (glob === '~') expanded = escapeGlob(home);
  else if (glob.startsWith('~/')) expanded = escapeGlob(home) + glob.slice(1);
  const full = expanded.startsWith('/') ? expanded : `${base}/${expanded}`;
  return `/${full.split('/').filter((s) => s !== '' && s !== '.').join('/')}`;
}

/** One step of a glob segment: a run of any characters (`*`), or one character that `test` accepts. */
type Atom = { run: true } | { run: false; char: string | null; test: (c: string) => boolean };

const ANY_CHAR = (): boolean => true;

function literal(c: string): Atom {
  return { run: false, char: c, test: (d) => d === c };
}

/**
 * Where the `]` that closes a bracket expression opened at `open` is, or -1 (then `[` is plain text),
 * for every `[` of one segment. The walk inside a class only ever moves forward and depends only on
 * where it stands, so where a walk from each position ends is worked out once, from the end of the
 * segment back (R-266 round 9, perf CRITICAL-1: a walk per `[`, with a search per `[:` in it, was
 * cubic in the segment's length).
 */
function classEnds(segment: string): (open: number) => number {
  const n = segment.length;
  // the next `:]`, `.]`, `=]` at or after each position
  const nextPair = { ':': new Int32Array(n + 2).fill(-1), '.': new Int32Array(n + 2).fill(-1), '=': new Int32Array(n + 2).fill(-1) };
  // where a walk standing at each position stops: its `]`, or -1
  const stop = new Int32Array(n + 2).fill(-1);
  for (let j = n - 1; j >= 0; j--) {
    tick();
    for (const mark of [':', '.', '='] as const) {
      nextPair[mark][j] = segment[j] === mark && segment[j + 1] === ']' ? j : nextPair[mark][j + 1];
    }
    const c = segment[j];
    if (c === ']') {
      stop[j] = j;
    } else if (c === '\\') {
      stop[j] = stop[j + 2];
    } else if (c === '[' && (segment[j + 1] === ':' || segment[j + 1] === '.' || segment[j + 1] === '=')) {
      // `[:alpha:]`, `[.a.]`, `[=a=]` inside the class: their `]` doesn't close it
      const close = nextPair[segment[j + 1] as ':' | '.' | '='][j + 2];
      stop[j] = close === -1 ? stop[j + 1] : stop[close + 2];
    } else {
      stop[j] = stop[j + 1];
    }
  }
  return (open) => {
    let j = open + 1;
    if (segment[j] === '!' || segment[j] === '^') j++;
    if (segment[j] === ']') j++;
    return j < n ? stop[j] : -1;
  };
}

/** The test of a bracket expression's body (`a-z`, `!x`); a character class (`[:alpha:]`) accepts anything. */
function classTest(body: string): (c: string) => boolean {
  const negate = body[0] === '!' || body[0] === '^';
  const items = negate ? body.slice(1) : body;
  if (/\[[:.=]/.test(items)) return ANY_CHAR;
  const singles = new Set<string>();
  const ranges: [string, string][] = [];
  for (let k = 0; k < items.length; k++) {
    let c = items[k];
    if (c === '\\' && k + 1 < items.length) c = items[++k];
    if (items[k + 1] === '-' && k + 2 < items.length) {
      let end = items[k + 2];
      k += 2;
      if (end === '\\' && k + 1 < items.length) end = items[++k];
      ranges.push([c, end]);
    } else {
      singles.add(c);
    }
  }
  return (d) => (singles.has(d) || ranges.some(([from, to]) => d >= from && d <= to)) !== negate;
}

/** The atoms of one shell pattern segment: `\x` is x, `*`, `?`, and `[…]`; a `[` with no `]` is plain. */
function shellAtoms(segment: string): Atom[] {
  const atoms: Atom[] = [];
  let classEnd: ((open: number) => number) | null = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === '\\' && i + 1 < segment.length) {
      atoms.push(literal(segment[++i]));
    } else if (c === '*') {
      if (atoms[atoms.length - 1]?.run !== true) atoms.push({ run: true });
    } else if (c === '?') {
      atoms.push({ run: false, char: null, test: ANY_CHAR });
    } else if (c === '[' && (classEnd ??= classEnds(segment))(i) !== -1) {
      const end = classEnd(i);
      atoms.push({ run: false, char: null, test: classTest(segment.slice(i + 1, end)) });
      i = end;
    } else {
      atoms.push(literal(c));
    }
  }
  return atoms;
}

/** The atoms of one config glob segment: `*` and `?` only (see segmentMatches). */
function configAtoms(segment: string): Atom[] {
  return [...segment].map((c): Atom => (c === '*' ? { run: true } : c === '?' ? { run: false, char: null, test: ANY_CHAR } : literal(c)));
}

function charsMeet(x: Extract<Atom, { run: false }>, y: Extract<Atom, { run: false }>): boolean {
  if (x.char !== null && y.char !== null) return x.char === y.char;
  if (x.char !== null) return y.test(x.char);
  if (y.char !== null) return x.test(y.char);
  return true;
}

/** True for a config segment whose names all start with `.` (`.oss`, `.git`). */
function dotOnly(b: Atom[] | null): boolean {
  return b !== null && b[0]?.run === false && b[0].char === '.';
}

/**
 * True when some name matches both the shell segment `a` and the config segment `b`. As in bash and
 * zsh, a shell segment that starts with a wildcard never matches a name that starts with `.`,
 * unless `dots` (dotglob, GLOB_DOTS, a `(D)` qualifier) says it does.
 */
function segmentsMeet(a: Atom[], b: Atom[], dots = false): boolean {
  const first = a[0];
  if (!dots && first !== undefined && (first.run || first.char === null) && dotOnly(b)) return false;
  const n = a.length;
  const m = b.length;
  const seen = new Uint8Array((n + 1) * (m + 1));
  const todo: number[] = [0];
  const visit = (i: number, j: number): void => {
    const k = i * (m + 1) + j;
    if (seen[k] === 0) {
      seen[k] = 1;
      todo.push(k);
    }
  };
  seen[0] = 1;
  for (let k = todo.pop(); k !== undefined; k = todo.pop()) {
    tick();
    const i = Math.floor(k / (m + 1));
    const j = k % (m + 1);
    if (i === n && j === m) return true;
    const x = a[i];
    const y = b[j];
    if (x?.run === true) {
      visit(i + 1, j);
      if (j < m) visit(i, j + 1);
    }
    if (y?.run === true) {
      visit(i, j + 1);
      if (i < n) visit(i + 1, j);
    }
    if (x !== undefined && y !== undefined && !x.run && !y.run && charsMeet(x, y)) visit(i + 1, j + 1);
  }
  return false;
}

/** A config glob ready for intersection: its segments' atoms (null for `**`), fixed folder depth and anchor depth. */
interface GlobShape {
  atoms: (Atom[] | null)[];
  /** Segments before the first wildcard one: the fixed folder (see protected-path.ts). */
  fixed: number;
  /** Segments of the folder the glob is anchored at (repo root or home); 0 for `**` and absolute globs. */
  anchor: number;
}

const shapes = new WeakMap<PathMatchOptions, WeakMap<readonly string[], GlobShape[]>>();

function shapesOf(globs: readonly string[], opts: PathMatchOptions): GlobShape[] {
  let lists = shapes.get(opts);
  if (lists === undefined) {
    lists = new WeakMap();
    shapes.set(opts, lists);
  }
  let list = lists.get(globs);
  if (list === undefined) {
    const segmentLists = compiledList(globs, opts);
    list = globs.map((glob, n): GlobShape => {
      const { segments } = segmentLists[n];
      const wild = segments.findIndex((s) => /[*?]/.test(s));
      let anchor = 0;
      if (glob.startsWith('~/')) anchor = path.normalize(opts.home).split('/').length;
      else if (!glob.startsWith('**/') && !path.isAbsolute(glob)) anchor = path.normalize(opts.root).split('/').length;
      return {
        atoms: segments.map((s) => (s === ANY_FOLDERS ? null : configAtoms(s))),
        fixed: wild === -1 ? segments.length : wild,
        anchor,
      };
    });
    lists.set(globs, list);
  }
  return list;
}

/**
 * Whether a path matching the shell pattern `g` can be a path the glob matches, or a folder holding
 * one: the glob's fixed folder or a folder above it (below the anchor, with `exemptAnchor`).
 */
function pathMeets(g: (Atom[] | null)[], p: GlobShape, exemptAnchor: boolean, dots: boolean): boolean {
  const m = p.atoms.length;
  return (
    walk(g, p.atoms, (j) => j === m, dots) ||
    walk(g, p.atoms.slice(0, p.fixed), (j) => j >= 1 && (!exemptAnchor || j > p.anchor), dots)
  );
}

/**
 * Walks the shell pattern `g` against the glob segments `atoms` (null is `**` on either side) and
 * says whether all of `g` can be matched with `accept(j)` true for the glob segments used up.
 */
function walk(
  g: (Atom[] | null)[],
  atoms: (Atom[] | null)[],
  accept: (j: number) => boolean,
  dots = false,
  starts: readonly number[] = [0],
  ends?: Set<number>,
): boolean {
  const n = g.length;
  const m = atoms.length;
  const seen = new Uint8Array((n + 1) * (m + 1));
  const todo: number[] = [...starts];
  for (const j of starts) seen[j] = 1;
  const visit = (i: number, j: number): void => {
    const k = i * (m + 1) + j;
    if (seen[k] === 0) {
      seen[k] = 1;
      todo.push(k);
    }
  };
  for (let k = todo.pop(); k !== undefined; k = todo.pop()) {
    tick();
    const i = Math.floor(k / (m + 1));
    const j = k % (m + 1);
    if (i === n) {
      // `ends`: collect every glob position the whole of `g` can stop at, without deciding
      if (ends !== undefined) ends.add(j);
      else if (accept(j)) return true;
    }
    const x = i < n ? g[i] : undefined;
    const y = j < m ? atoms[j] : undefined;
    if (x === null) {
      visit(i + 1, j);
      // a shell `**` goes into dot folders only with dot matching on (zsh GLOB_DOTS, bash dotglob)
      if (j < m && (dots || !dotOnly(atoms[j]))) visit(i, j + 1);
    }
    if (y === null) {
      visit(i, j + 1);
      if (i < n) visit(i + 1, j);
    }
    if (x != null && y != null && segmentsMeet(x, y, dots)) visit(i + 1, j + 1);
  }
  return false;
}

/**
 * True when the absolute shell pattern `globPath` could match a path one of the globs matches, or a
 * folder holding one (a folder on the way to a glob's fixed folder). With `exemptAnchor`, the repo
 * root, home and the folders above them don't count as holding (as for the words a program names).
 * A `**` segment of the pattern spans any folders, as in zsh. Letter case is ignored when `opts` says so.
 */
export function shellGlobMayMatch(
  globPath: string,
  globs: readonly string[],
  opts: PathMatchOptions,
  exemptAnchor = false,
  dots = false,
): boolean {
  const g = shellSegments(globPath, opts);
  return shapesOf(globs, opts).some((p) => pathMeets(g, p, exemptAnchor, dots));
}

/**
 * shellGlobMayMatch for many patterns `<prefix>/<tail>` that share one prefix: the prefix is walked
 * once, and each tail (relative, no `.` or `..` segments) only from where the prefix can stop
 * (R-266 round 11, PERF LOW-1). Same answer as shellGlobMayMatch(`${prefix}/${tail}`, …).
 */
export function shellGlobTailMatcher(
  prefix: string,
  globs: readonly string[],
  opts: PathMatchOptions,
  exemptAnchor = false,
  dots = false,
): (tail: string) => boolean {
  const g = shellSegments(prefix, opts);
  // a prefix ending in `/` (the root) ends in an empty segment the joined pattern doesn't have
  const last = g[g.length - 1];
  if (g.length > 1 && last !== null && last !== undefined && last.length === 0) g.pop();
  const plans = shapesOf(globs, opts).map((p) => {
    const fixedAtoms = p.atoms.slice(0, p.fixed);
    const full = new Set<number>();
    const held = new Set<number>();
    walk(g, p.atoms, () => false, dots, [0], full);
    walk(g, fixedAtoms, () => false, dots, [0], held);
    return { p, fixedAtoms, full: [...full], held: [...held] };
  });
  return (tail) => {
    const t = shellSegments(tail, opts);
    return plans.some(
      ({ p, fixedAtoms, full, held }) =>
        (full.length > 0 && walk(t, p.atoms, (j) => j === p.atoms.length, dots, full)) ||
        (held.length > 0 && walk(t, fixedAtoms, (j) => j >= 1 && (!exemptAnchor || j > p.anchor), dots, held)),
    );
  };
}

/** A shell pattern's segments as atoms (null for `**`), lowercased when letter case doesn't matter. */
function shellSegments(pattern: string, opts: PathMatchOptions): (Atom[] | null)[] {
  const normal = path.posix.normalize(opts.caseInsensitive === true ? pattern.toLowerCase() : pattern);
  return normal.split('/').map((s) => (s === ANY_FOLDERS ? null : shellAtoms(s)));
}

/** True for a config segment that names something: not only wildcards (`*`, `?*`, `**`). */
function named(b: Atom[] | null): boolean {
  return b !== null && b.some((atom) => !atom.run && atom.char !== null);
}

/**
 * True when a relative shell pattern (a plain path through escapeGlob) written in a folder the gate
 * can't follow could be the end of a protected path: some protected glob, cut anywhere up to its
 * last named segment, matches it whole (fix round 4, K2). A name that only a folder's `/**` covers
 * (`out.txt` under a folder's `/**`) doesn't count: any file name would, so it says nothing.
 */
export function tailMayBeProtected(tail: string, globs: readonly string[], opts: PathMatchOptions, dots = false, contents = false): boolean {
  const g = shellSegments(belowClimb(tail), opts).filter((s, n) => n > 0 || s === null || s.length > 0);
  const gLast = g[g.length - 1];
  return shapesOf(globs, opts).some((p) => {
    // every cut ends in the glob's last segment: when it names something the tail's last can't be, none matches (round 11, PERF LOW-1)
    const pLast = p.atoms[p.atoms.length - 1];
    if (!contents && gLast != null && pLast != null && !segmentsMeet(gLast, pLast, dots)) return false;
    // `contents`: a name any protected folder's `/**` covers counts too (a wildcard, a whole folder), fix round 4, K3
    let last = contents ? p.atoms.length - 1 : -1;
    p.atoms.forEach((b, j) => {
      if (named(b)) last = Math.max(last, j);
    });
    for (let from = 0; from <= last; from++) {
      const rest = p.atoms.slice(from);
      if (walk(g, rest, (j) => j === rest.length, dots)) return true;
    }
    return false;
  });
}

/**
 * True when a relative shell pattern written after a folder only known when it runs (`"$dir"/.oss`)
 * could be a folder holding a protected path (round 17, SEC LOW-1): some protected glob, cut anywhere up
 * to its last named segment, matches it up to a named segment before the glob's end (`.oss` holds
 * a protected file in it, `.git/hooks` holds `**\/.git/hooks/**`; `build` held under a `**` doesn't count).
 */
export function tailMayHoldProtected(tail: string, globs: readonly string[], opts: PathMatchOptions, dots = false): boolean {
  const g = shellSegments(belowClimb(tail), opts).filter((s, n) => n > 0 || s === null || s.length > 0);
  return shapesOf(globs, opts).some((p) => {
    let last = -1;
    p.atoms.forEach((b, j) => {
      if (named(b)) last = Math.max(last, j);
    });
    for (let from = 0; from <= last; from++) {
      const rest = p.atoms.slice(from);
      if (walk(g, rest, (j) => j >= 1 && j < rest.length && named(rest[j - 1]), dots)) return true;
    }
    return false;
  });
}

/**
 * True when the absolute shell pattern could be a folder on the way to a protected glob's fixed folder,
 * the repo root and home included (`~/*` could be `~/.oss`; `<repo>/../*` the repo itself): round 17, SEC LOW-1.
 */
export function shellGlobMayHold(globPath: string, globs: readonly string[], opts: PathMatchOptions, dots = false): boolean {
  const g = shellSegments(globPath, opts);
  return shapesOf(globs, opts).some((p) => walk(g, p.atoms.slice(0, p.fixed), (j) => j >= 1, dots));
}

/**
 * What is left of a relative path below its last `..` (`../../x` → `x`; `..` alone → `**`): the
 * folders it climbs to are as unknown as the one it started in, so only the rest says anything.
 */
function belowClimb(tail: string): string {
  const segments = path.posix.normalize(tail).split('/');
  const climb = segments.lastIndexOf('..');
  if (climb === -1) return tail;
  const rest = segments.slice(climb + 1).join('/');
  return rest === '' ? ANY_FOLDERS : rest;
}

/**
 * True when the shell would expand the absolute pattern to the absolute path (fix round 4, K3):
 * segment by segment, a `**` spanning folders, and a leading wildcard matching a `.` name only with
 * `dots` (as `segmentsMeet` reads it). Letter case is ignored when `opts` says so.
 */
export function shellPatternMatchesPath(pattern: string, absPath: string, opts: { caseInsensitive?: boolean }, dots: boolean): boolean {
  const g = shellSegments(pattern, { home: '', root: '', ...opts });
  const named = (opts.caseInsensitive === true ? path.posix.normalize(absPath).toLowerCase() : path.posix.normalize(absPath)).split('/');
  const atoms = named.map((name) => [...name].map(literal));
  return walk(g, atoms, (j) => j === atoms.length, dots);
}

/** Glob syntax: a glob that matches at any depth starts with `**\/`. */
const ANY_DEPTH = `${ANY_FOLDERS}/`;

/**
 * A test for the names that start a glob matching at any depth (`.git` in `**\/.git`,
 * `**\/.git/config`), so a search below a folder can find where such paths could be; null when
 * no glob matches at any depth (fix round 4, K3).
 */
export function floatingNames(globs: readonly string[], caseInsensitive: boolean): ((name: string) => boolean) | null {
  const fold = (text: string): string => (caseInsensitive ? text.toLowerCase() : text);
  const firsts = [...new Set(globs.filter((g) => g.startsWith(ANY_DEPTH)).map((g) => fold(g.slice(ANY_DEPTH.length).split('/')[0])))];
  if (firsts.length === 0) return null;
  return (name) => firsts.some((first) => segmentMatches(first, fold(name)));
}

/** True when `glob` (a shell pattern) holds an unescaped wildcard: `*`, `?`, or a closed `[…]`. */
export function hasShellWildcard(glob: string): boolean {
  let classEnd: ((open: number) => number) | null = null;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '\\') i++;
    else if (c === '*' || c === '?' || (c === '[' && (classEnd ??= classEnds(glob))(i) !== -1)) return true;
  }
  return false;
}
