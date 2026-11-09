/**
 * Skipped/focused tests rule (US-003): refuses an edit to a file matching `testFilePatterns`
 * that adds a skip, focus or todo marker (or its `If` form). Only newly added markers count:
 * each change compares the per-marker counts in its text before and after.
 */

import path from 'node:path';
import type { EditCall } from '../edit-call.js';
import { matchPath } from '../patterns.js';
import type { GateSettings } from '../rule-file.js';
import type { Refusal } from './refusal.js';

/** Test-framework marker syntax (code, not a rule value): `.skip(`, `.onlyIf (` and the like. */
const MARKER = /\.(skip|only|todo)(If)?\s*\(/g;

function countMarkers(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(MARKER)) {
    const name = match[1] + (match[2] ?? '');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
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

export function checkFocusedTests(call: EditCall, settings: GateSettings, root: string, home: string): Refusal | null {
  if (!settings.testFilePatterns.some((glob) => matchPath(glob, call.filePath, { home, root }))) return null;
  for (const { before, after } of call.changes) {
    const marker = addedMarker(before, after);
    if (marker !== undefined) {
      return {
        rule: 'focused-tests',
        reason: `Refused: adds \`.${marker}(\` to the test file \`${displayPath(call.filePath, root)}\`. IRON LAW #1: never skip or focus tests. Fix or delete the test instead.`,
      };
    }
  }
  return null;
}
