import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkArchive } from '../../src/healthchecks/archive.js';
import { openLedger } from '../../src/phase-results/ledger.js';

describe('ArchiveHealthCheck', () => {
  let tmp: string;
  let repo: string;
  let devActivePath: string;
  const realHome = process.env.HOME;

  beforeEach(() => {
    // dev/active inside a real git repo, with a private HOME for the ledger (R-257 T14)
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-archive-check-')));
    repo = path.join(tmp, 'repo');
    devActivePath = path.join(repo, '.oss', 'dev', 'active');
    fs.mkdirSync(devActivePath, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'home'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    process.env.HOME = path.join(tmp, 'home');
  });

  afterEach(() => {
    process.env.HOME = realHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A results/ship.json for the feature (fields override the valid default); bound in the ledger unless told not. */
  function shipResult(feature: string, fields: Record<string, unknown> = {}, bind = true): void {
    const sha = 'a'.repeat(40);
    const result = {
      v: 1, phase: 'ship', feature, startedAt: '2026-11-13T00:00:00Z', assembledAt: '2026-11-13T00:00:01Z',
      headSha: sha, sources: { diff: 'code', verdict: 'code', summary: 'model' }, verification: 'verified',
      claims: [], chain: [], diff: { base: sha, baseRef: 'main', files: 1, insertions: 1, deletions: 0 }, gates: [], overrides: [],
      blockers: [], verdict: 'ready_to_merge', summary: 'shipped', ...fields,
    };
    const dir = path.join(devActivePath, feature, 'results');
    fs.mkdirSync(dir, { recursive: true });
    const bytes = Buffer.from(JSON.stringify(result));
    fs.writeFileSync(path.join(dir, 'ship.json'), bytes);
    if (!bind) return;
    openLedger(repo).appendRow(`results/${feature}/ship`, {
      sha256: createHash('sha256').update(bytes).digest('hex'), feature, phase: 'ship',
      startedAt: result.startedAt, headSha: sha, session: 's1',
    });
  }

  /** Real feature folders in dev/active: each with this PROGRESS.md text, or none (null). */
  function features(progress: Record<string, string | null>): void {
    for (const [name, text] of Object.entries(progress)) {
      fs.mkdirSync(path.join(devActivePath, name));
      if (text !== null) fs.writeFileSync(path.join(devActivePath, name, 'PROGRESS.md'), text);
    }
  }

  it('should pass when no completed features remain in dev/active/', async () => {
    // GIVEN - Feature in progress (not completed)
    features({ 'in-progress-feature': '## Current Phase: build\n\n- [ ] Task 1' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should pass (no completed features to archive)
    expect(result.status).toBe('pass');
    expect(result.message).toContain('All completed features have been archived');
  });

  it('should warn when shipped feature still in dev/active/', async () => {
    // GIVEN - Completed feature not archived (a valid, bound ship result: AC-006.1)
    features({ 'completed-feature': '## Current Phase: ship\n\n- [x] All done' });
    shipResult('completed-feature');

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should warn about unarchived feature
    expect(result.status).toBe('warn');
    expect(result.message).toContain('completed features not archived');
    expect(result.details?.unarchived).toContain('completed-feature');
  });

  it('should not count "ship" completion pattern in PROGRESS.md prose (AC-006.1)', async () => {
    // GIVEN - prose only, no ship result
    features({ 'feature-1': '## Current Phase: ship' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - PROGRESS.md prose never decides "shipped"
    expect(result.details?.completedFeatures).not.toContain('feature-1');
    expect(result.status).toBe('pass');
  });

  it('should not count "SHIP" completion pattern (case insensitive) in PROGRESS.md prose (AC-006.1)', async () => {
    // GIVEN - prose only, no ship result
    features({ 'feature-2': '## Current Phase: SHIP' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - PROGRESS.md prose never decides "shipped"
    expect(result.details?.completedFeatures).not.toContain('feature-2');
    expect(result.status).toBe('pass');
  });

  it('should not count "complete" completion pattern in PROGRESS.md prose (AC-006.1)', async () => {
    // GIVEN - prose only, no ship result
    features({ 'feature-3': '## Current Phase: complete' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - PROGRESS.md prose never decides "shipped"
    expect(result.details?.completedFeatures).not.toContain('feature-3');
    expect(result.status).toBe('pass');
  });

  it('should not count "COMPLETE" completion pattern in PROGRESS.md prose (AC-006.1)', async () => {
    // GIVEN - prose only, no ship result
    features({ 'feature-4': '## Current Phase: COMPLETE' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - PROGRESS.md prose never decides "shipped"
    expect(result.details?.completedFeatures).not.toContain('feature-4');
    expect(result.status).toBe('pass');
  });

  it('should not count "(COMPLETE)" completion pattern in PROGRESS.md prose (AC-006.1)', async () => {
    // GIVEN - prose only, no ship result
    features({ 'feature-5': '## Current Phase: build (COMPLETE)' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - PROGRESS.md prose never decides "shipped"
    expect(result.details?.completedFeatures).not.toContain('feature-5');
    expect(result.status).toBe('pass');
  });

  it('should not count "(complete)" completion pattern (lowercase) in PROGRESS.md prose (AC-006.1)', async () => {
    // GIVEN - prose only, no ship result
    features({ 'feature-6': '## Current Phase: build (complete)' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - PROGRESS.md prose never decides "shipped"
    expect(result.details?.completedFeatures).not.toContain('feature-6');
    expect(result.status).toBe('pass');
  });

  it('should provide archive command suggestion', async () => {
    // GIVEN - Any scenario
    features({ 'feature': '## Current Phase: build' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should suggest using /oss:plan for auto-archive
    expect(result.details?.suggestedAction).toContain('/oss:plan');
  });

  it('should handle empty dev/active/ directory', async () => {
    // GIVEN - No features in dev/active
    // (dev/active exists and is empty)

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should pass (nothing to archive)
    expect(result.status).toBe('pass');
  });

  it('should skip non-directory entries', async () => {
    // GIVEN - Mix of files and directories
    features({ 'feature-1': '## Current Phase: build' });
    // a file that reads as completed, but is not a feature folder
    fs.writeFileSync(path.join(devActivePath, 'README.md'), '## Current Phase: ship');

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should only check directories
    expect(result.details?.completedFeatures).toEqual([]);
    expect(result.status).toBe('pass');
  });

  it('should handle missing PROGRESS.md file', async () => {
    // GIVEN - Feature directory without PROGRESS.md
    features({ 'feature-no-progress': null });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should skip feature (treat as not completed)
    expect(result.status).toBe('pass');
    expect(result.details?.completedFeatures).not.toContain('feature-no-progress');
  });

  it('should detect multiple completed features', async () => {
    // GIVEN - Multiple completed features (valid, bound ship results: AC-006.1)
    features({
      'feature-1': '## Current Phase: ship',
      'feature-2': '## Current Phase: build', // not complete
      'feature-3': '## Current Phase: complete',
    });
    shipResult('feature-1');
    shipResult('feature-3');

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect both completed features
    expect(result.status).toBe('warn');
    // (folder order is the filesystem's, so compared as sets)
    expect([...(result.details?.completedFeatures as string[])].sort()).toEqual(['feature-1', 'feature-3']);
    expect([...(result.details?.unarchived as string[])].sort()).toEqual(['feature-1', 'feature-3']);
  });

  // R-257 T14. User behaviour: the health check flags a feature as "completed, not archived" only when its ship
  // phase result proves it shipped. Business rule: AC-006.1 and AC-004.5, the archive rule shared with
  // oss-archive-check.sh (valid, bound in the ledger, verified, ready_to_merge, no unverified marker).
  describe('ship phase results (R-257 T14)', () => {
    it('a valid ship result gives a "completed, not archived" issue', async () => {
      features({ shipped: '## Current Phase: build' });
      shipResult('shipped');

      const result = await checkArchive({ devActivePath });

      expect(result.status).toBe('warn');
      expect(result.details?.unarchived).toEqual(['shipped']);
    });

    it('PROGRESS.md "ship (merged)" prose alone gives no issue', async () => {
      features({ prose: '## Current Phase: ship (merged)\n\n- [x] done' });

      const result = await checkArchive({ devActivePath });

      expect(result.status).toBe('pass');
      expect(result.details?.completedFeatures).toEqual([]);
    });

    it('an unverified ship result gives no issue', async () => {
      features({ unverified: null });
      shipResult('unverified', { verification: 'unverified' });

      const result = await checkArchive({ devActivePath });

      expect(result.status).toBe('pass');
    });

    it('a ship result with no ledger entry gives no issue', async () => {
      features({ unbound: null });
      shipResult('unbound', {}, false);

      const result = await checkArchive({ devActivePath });

      expect(result.status).toBe('pass');
    });

    it('a blocked ship verdict gives no issue', async () => {
      features({ blocked: null });
      shipResult('blocked', { verdict: 'blocked' });

      const result = await checkArchive({ devActivePath });

      expect(result.status).toBe('pass');
    });
  });
});
