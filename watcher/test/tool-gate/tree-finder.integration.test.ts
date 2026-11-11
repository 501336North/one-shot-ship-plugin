/**
 * @behavior Before a recursive delete, the gate searches the folder on disk for names a protected
 *   pattern can match anywhere (a nested `.git`), the way `rm -r` would reach them: it doesn't follow
 *   links or go inside what it found, and it stops past its per-call limit, which refuses the call
 *   as too complex rather than letting it through (fix round 4, K3).
 * @business-rule US-006: `rm -rf build` removes `build/sub/.git` as surely as `rm -rf build/sub/.git` does.
 * @boundary createTreeFinder over a real temp folder.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OverBudget } from '../../src/tool-gate/budget.js';
import { createTreeFinder } from '../../src/tool-gate/tree-finder.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tree-finder-')));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const isGit = (name: string): boolean => name === '.git';

describe('createTreeFinder: names below a folder', () => {
  it('finds a nested .git at any depth, and nothing inside it', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'build', 'a', 'sub', '.git', 'refs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'build', 'b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'build', 'other.git'), '');
    expect(createTreeFinder().namedBelow(path.join(root, 'build'), isGit)).toEqual([path.join(root, 'build', 'a', 'sub', '.git')]);
  });

  it('finds a .git file (a worktree or submodule) too', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'w'));
    fs.writeFileSync(path.join(root, 'w', '.git'), 'gitdir: x\n');
    expect(createTreeFinder().namedBelow(root, isGit)).toEqual([path.join(root, 'w', '.git')]);
  });

  it('does not follow a link to another folder (rm -r removes the link, not what it points at)', () => {
    const root = tempDir();
    const elsewhere = tempDir();
    fs.mkdirSync(path.join(elsewhere, 'repo', '.git'), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, 'repo'), path.join(root, 'link'));
    expect(createTreeFinder().namedBelow(root, isGit)).toEqual([]);
  });

  it('finds nothing in a folder that does not exist', () => {
    expect(createTreeFinder().namedBelow(path.join(tempDir(), 'missing'), isGit)).toEqual([]);
  });

  it('reads each folder once per call, however often it is asked', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    let reads = 0;
    const finder = createTreeFinder({ maxDirs: 100 }, (dir) => {
      reads++;
      return fs.readdirSync(dir, { withFileTypes: true });
    });
    finder.namedBelow(root, isGit);
    finder.namedBelow(root, isGit);
    expect(reads).toBe(3);
  });

  it('stops past its folder limit with OverBudget (refused as too complex, never allowed)', () => {
    const root = tempDir();
    for (let i = 0; i < 6; i++) fs.mkdirSync(path.join(root, `d${i}`));
    const finder = createTreeFinder({ maxDirs: 5 });
    expect(() => finder.namedBelow(root, isGit)).toThrow(OverBudget);
  });

  it('stops once its time is up with OverBudget', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'a'));
    let now = 0;
    const finder = createTreeFinder({ maxDirs: 100, timeMs: 10 }, undefined, () => (now += 20));
    expect(() => finder.namedBelow(root, isGit)).toThrow(OverBudget);
  });

  it('stops past its entry limit with OverBudget, however few folders hold them', () => {
    const root = tempDir();
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(root, `f${i}`), '');
    const finder = createTreeFinder({ maxDirs: 100, maxEntries: 20 });
    expect(() => finder.namedBelow(root, isGit)).toThrow(OverBudget);
  });

  it('refuses (OverBudget) a folder it may not list: what it holds is unknown, not nothing', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'locked', 'sub', '.git'), { recursive: true });
    const finder = createTreeFinder({ maxDirs: 100 }, (dir) => {
      if (dir.endsWith('locked')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return fs.readdirSync(dir, { withFileTypes: true });
    });
    expect(() => finder.namedBelow(root, isGit)).toThrow(OverBudget);
  });

  it('finds nothing below a file (rm -r of a file removes only that file)', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'f'), '');
    expect(createTreeFinder().namedBelow(path.join(root, 'f'), isGit)).toEqual([]);
  });
});

describe('tree finder: its time starts at its first read (fix part K12, item 5c)', () => {
  it('does not count the time before the search (git dry run) against the search', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'a'));
    let now = 0;
    const finder = createTreeFinder({ maxDirs: 100, timeMs: 1000 }, undefined, () => now);
    now = 990;
    expect(finder.namedBelow(root, isGit)).toEqual([]);
  });

  it('still stops a search that itself runs past its time', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'a'));
    let now = 990;
    const finder = createTreeFinder({ maxDirs: 100, timeMs: 1000 }, undefined, () => (now += 600));
    expect(() => finder.namedBelow(root, isGit)).toThrow(OverBudget);
  });
});
