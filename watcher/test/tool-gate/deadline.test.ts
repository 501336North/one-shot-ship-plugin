/**
 * @behavior Every loop an input can make long (reading the command, matching patterns, resolving
 *   paths, searching folders) looks at the call's deadline as it goes; once the deadline has passed
 *   it stops with OverBudget, which refuses the call as too complex, so no input can push the
 *   decision past the worker's hard limit, where the call would be allowed unchecked (fix round 4, K8).
 * @business-rule US-010: a gate that runs out of time refuses; it never lets the call through unchecked.
 * @boundary withDeadline + the gate's hot loops, with an injected clock (no wall-clock assertions).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OverBudget } from '../../src/tool-gate/budget.js';
import { withDeadline } from '../../src/tool-gate/deadline.js';
import { tokenize } from '../../src/tool-gate/tokenize.js';
import { readCommand } from '../../src/tool-gate/command-reader.js';
import { matchAnyPath, shellGlobMayMatch } from '../../src/tool-gate/patterns.js';
import { createPathResolver } from '../../src/tool-gate/path-resolver.js';
import { createTreeFinder } from '../../src/tool-gate/tree-finder.js';

/** A clock that reads 0 when the call starts and long past any deadline after that. */
function pastAfterStart(): () => number {
  let started = false;
  return () => {
    if (started) return 1e12;
    started = true;
    return 0;
  };
}

/** A clock that never moves. */
const stopped = (): number => 0;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the per-call deadline', () => {
  it('stops reading a long command once the deadline has passed', () => {
    const long = `git status${' '.repeat(100_000)}`;
    expect(() => withDeadline(1500, pastAfterStart(), () => tokenize(long))).toThrow(OverBudget);
  });

  it('reads the same long command when there is time left', () => {
    const long = `git status${' '.repeat(100_000)}`;
    expect(withDeadline(1500, stopped, () => tokenize(long))).toHaveProperty('tokens');
  });

  it('lets a short command finish even when the clock has run out (it looks only every so often)', () => {
    expect(withDeadline(1500, pastAfterStart(), () => tokenize('git status'))).toHaveProperty('tokens');
  });

  it('has no deadline outside a call (the recorder reads commands after they ran)', () => {
    expect(tokenize(`git status${' '.repeat(100_000)}`)).toHaveProperty('tokens');
  });

  it('stops the command reader on many separators', () => {
    const many = 'true;'.repeat(1500);
    expect(() => withDeadline(1500, pastAfterStart(), () => readCommand(many, '/repo', '/home/u'))).toThrow(OverBudget);
  });

  it('stops pattern matching on a long backtracking match', () => {
    const name = `/repo/${'a'.repeat(5000)}`;
    expect(() =>
      withDeadline(1500, pastAfterStart(), () => matchAnyPath([`/repo/*a*a*a*a*b`], name, { home: '/home/u', root: '/repo', caseInsensitive: false })),
    ).toThrow(OverBudget);
  });

  it('stops matching a shell pattern against the protected globs', () => {
    const pattern = `/repo/${'*/'.repeat(300)}x`;
    expect(() =>
      withDeadline(1500, pastAfterStart(), () => shellGlobMayMatch(pattern, ['/repo/**/.oss/**', '/repo/**/.git/**'], { home: '/home/u', root: '/repo', caseInsensitive: false })),
    ).toThrow(OverBudget);
  });

  it('stops resolving a path with many names', () => {
    const resolver = createPathResolver();
    const long = `/${Array.from({ length: 3000 }, (_, n) => `n${n}`).join('/')}`;
    expect(() => withDeadline(1500, pastAfterStart(), () => resolver.realpath(long))).toThrow(OverBudget);
  });

  it('stops searching a folder with many entries', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-deadline-')));
    dirs.push(root);
    for (let n = 0; n < 2100; n++) fs.writeFileSync(path.join(root, `f${n}`), '');
    expect(() => withDeadline(1500, pastAfterStart(), () => createTreeFinder().namedBelow(root, (n) => n === '.git'))).toThrow(OverBudget);
  });
});

describe('the per-call deadline, looked at every 256 steps (fix part K12, item 7)', () => {
  it('stops a command of a few hundred characters once the deadline has passed', () => {
    expect(() => withDeadline(1000, pastAfterStart(), () => tokenize(`echo ${'a'.repeat(600)}`))).toThrow(OverBudget);
  });

  it('lets a very short command finish even when the clock has run out', () => {
    expect(withDeadline(1000, pastAfterStart(), () => tokenize('git status'))).toHaveProperty('tokens');
  });
});
