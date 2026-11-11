/**
 * Skipped/focused tests rule (US-003): refuses an edit to a file matching `testFilePatterns`
 * that adds a skip, focus or todo marker (or its `If`, table or concurrent form), or an
 * `xit(` / `fit(` / `xdescribe(` / `fdescribe(` / `xtest(` call. Only newly added markers count:
 * each change compares the per-marker counts in its text before and after.
 */

import path from 'node:path';
import type { EditCall } from '../edit-call.js';
import { matchAnyPath } from '../patterns.js';
import type { GateSettings } from '../rule-file.js';
import type { Refusal } from './refusal.js';

/**
 * Test-framework marker syntax (code, not a rule value): `.skip(`, `.onlyIf (`, the chained
 * `.only.each(` / `.skip.each\`` table forms and `.skip.concurrent(`.
 */
const MARKER = /\.(skip|only|todo)(If)?(?:\.concurrent)?(?:\.each)?\s*[(`]/g;
/**
 * The Jasmine / Jest / Mocha prefixed calls `xit(`, `fit(`, `xdescribe(`, `fdescribe(`, `xtest(`:
 * a whole name, so `exit(`, `submit(`, `profit(` and `obj.xit(` don't count.
 */
const PREFIXED_CALL = /(?<![\w$.])(xit|fit|xdescribe|fdescribe|xtest)\s*\(/g;

function countMarkers(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (name: string): void => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  for (const match of text.matchAll(MARKER)) add(`.${match[1]}${match[2] ?? ''}`);
  for (const match of text.matchAll(PREFIXED_CALL)) add(match[1]);
  return counts;
}

/** The first marker the change adds, or undefined. */
function addedMarker(before: string, after: string): string | undefined {
  const old = countMarkers(before);
  for (const [name, count] of countMarkers(after)) {
    if (count > (old.get(name) ?? 0)) return name;
  }
  return undefined;
}

function displayPath(filePath: string, root: string): string {
  const relative = path.relative(root, filePath);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? filePath : relative;
}

export function checkFocusedTests(
  call: EditCall,
  settings: GateSettings,
  root: string,
  home: string,
  caseInsensitive = false,
): Refusal | null {
  if (!matchAnyPath(settings.testFilePatterns, call.filePath, { home, root, caseInsensitive })) return null;
  for (const { before, after } of call.changes) {
    const marker = addedMarker(before, after);
    if (marker !== undefined) {
      return {
        rule: 'focused-tests',
        reason: `Refused: adds \`${marker}(\` to the test file \`${displayPath(call.filePath, root)}\`. IRON LAW #1: never skip or focus tests. Fix or delete the test instead.`,
      };
    }
  }
  return null;
}
