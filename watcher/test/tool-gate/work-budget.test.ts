/**
 * @behavior The gate does a bounded amount of work per call. It asks git once per folder and
 *   question, and remembers each path it resolved on disk, so a call repeating the same word or the
 *   same `git commit` costs the same as one. Past a per-call limit (distinct git runs, time spent in
 *   git, names looked up or walked on disk) it stops and the call is refused as too complex to
 *   check, never allowed.
 * @business-rule ADR-005: a decision slower than the gate's limit allows the call, so work an
 *   input can multiply must be capped and refused (fix round 4, K1).
 */

import { describe, it, expect, vi } from 'vitest';
import { budgetedGitReader, OverBudget } from '../../src/tool-gate/budget.js';
import type { GitReader } from '../../src/tool-gate/git-reader.js';
import { createPathResolver } from '../../src/tool-gate/path-resolver.js';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/**
 * A disk with folders, files and symlinks given by absolute path; counts each lookup. Anything
 * not listed doesn't exist.
 */
function fakeDisk(entries: { dirs?: string[]; links?: Record<string, string> }) {
  const dirs = new Set(['/', ...(entries.dirs ?? [])]);
  const links = new Map(Object.entries(entries.links ?? {}));
  const readlink = vi.fn((p: string): string => {
    const target = links.get(p);
    if (target !== undefined) return target;
    throw errno(dirs.has(p) ? 'EINVAL' : 'ENOENT');
  });
  return { readlink };
}

const LIMITS = { maxLookups: 20_000, maxSteps: 200_000 };

describe('path resolver: remembers what it resolved within one call', () => {
  it('should look each name up on disk once, however often the same path is asked for', () => {
    const { readlink } = fakeDisk({ dirs: ['/repo', '/repo/src'] });
    const paths = createPathResolver(LIMITS, readlink);
    for (let n = 0; n < 50; n++) expect(paths.realpath('/repo/src/a.ts')).toBe('/repo/src/a.ts');
    expect(readlink).toHaveBeenCalledTimes(3);
  });

  it('should look a shared folder up once for many files under it', () => {
    const { readlink } = fakeDisk({ dirs: ['/repo', '/repo/big'] });
    const paths = createPathResolver(LIMITS, readlink);
    for (let n = 0; n < 100; n++) paths.realpath(`/repo/big/f${n}`);
    expect(readlink).toHaveBeenCalledTimes(2 + 100);
  });
});

describe('path resolver: refuses work over the per-call limit', () => {
  /** `s` points at `x/../x/../…/.` (400 names), which lands back in /repo, so `s/s/s…` stays in /repo. */
  const longLink = `${'x/../'.repeat(200)}.`;
  const disk = () => fakeDisk({ dirs: ['/repo', '/repo/x'], links: { '/repo/s': longLink } });

  it('should stop with OverBudget when words walk a long link 40 deep, many times over', () => {
    const { readlink } = disk();
    const paths = createPathResolver(LIMITS, readlink);
    const deep = `/repo/${'s/'.repeat(40)}`;
    expect(() => {
      for (let n = 0; n < 35; n++) paths.realpath(`${deep}w${n}`);
    }).toThrow(OverBudget);
  });

  it('should resolve one such word within the limit', () => {
    const { readlink } = disk();
    const paths = createPathResolver(LIMITS, readlink);
    expect(paths.realpath(`/repo/${'s/'.repeat(40)}w`)).toBe('/repo/w');
  });

  it('should stop with OverBudget past the lookup limit', () => {
    const { readlink } = fakeDisk({ dirs: ['/repo'] });
    const paths = createPathResolver({ maxLookups: 100, maxSteps: 200_000 }, readlink);
    expect(() => {
      for (let n = 0; n < 200; n++) paths.realpath(`/repo/f${n}`);
    }).toThrow(OverBudget);
  });
});

/** A git reader answering "feat/x" and [] and counting what it is asked; `tick` runs on each call. */
function countingGit(tick: () => void = () => {}) {
  const currentBranch = vi.fn(async (_dir: string, _timeoutMs?: number) => {
    tick();
    return 'feat/x';
  });
  const wouldClean = vi.fn(async (_dir: string, _options: string[], _pathspecs: string[], _timeoutMs?: number) => {
    tick();
    return [] as string[];
  });
  const git: GitReader = { currentBranch, wouldClean };
  return { git, currentBranch, wouldClean };
}

describe('git reader within one call: asks once per question, refuses past the limit', () => {
  it('should ask git for the branch of a folder once, however many parts commit there', async () => {
    const { git, currentBranch } = countingGit();
    const budgeted = budgetedGitReader(git, { maxRuns: 8, timeMs: 1200 });
    for (let n = 0; n < 300; n++) expect(await budgeted.currentBranch('/repo')).toBe('feat/x');
    expect(currentBranch).toHaveBeenCalledTimes(1);
  });

  it('should ask for the same dry run once', async () => {
    const { git, wouldClean } = countingGit();
    const budgeted = budgetedGitReader(git, { maxRuns: 8, timeMs: 1200 });
    for (let n = 0; n < 20; n++) await budgeted.wouldClean('/repo', ['-d'], ['build']);
    expect(wouldClean).toHaveBeenCalledTimes(1);
  });

  it('should refuse (OverBudget) the 9th different git question in one call', async () => {
    const { git } = countingGit();
    const budgeted = budgetedGitReader(git, { maxRuns: 8, timeMs: 1200 });
    for (let n = 0; n < 8; n++) await budgeted.wouldClean('/repo', [], [`nx${n}`]);
    await expect(budgeted.wouldClean('/repo', [], ['nx8'])).rejects.toThrow(OverBudget);
    await expect(budgeted.currentBranch('/other')).rejects.toThrow(OverBudget);
  });

  it('should give git only the time left in the call, and refuse once it is used up', async () => {
    let clock = 0;
    const { git, currentBranch } = countingGit(() => {
      clock += 700;
    });
    const budgeted = budgetedGitReader(git, { maxRuns: 8, timeMs: 1200 }, () => clock);
    await budgeted.currentBranch('/a');
    expect(currentBranch).toHaveBeenLastCalledWith('/a', 1200);
    await expect(budgeted.currentBranch('/b')).rejects.toThrow(OverBudget);
    expect(currentBranch).toHaveBeenLastCalledWith('/b', 500);
    await expect(budgeted.currentBranch('/c')).rejects.toThrow(OverBudget);
    expect(currentBranch).toHaveBeenCalledTimes(2);
  });
});
