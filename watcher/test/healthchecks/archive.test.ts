import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkArchive } from '../../src/healthchecks/archive.js';

describe('ArchiveHealthCheck', () => {
  let devActivePath: string;

  beforeEach(() => {
    devActivePath = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-archive-check-'));
  });

  afterEach(() => {
    fs.rmSync(devActivePath, { recursive: true, force: true });
  });

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
    // GIVEN - Completed feature not archived
    features({ 'completed-feature': '## Current Phase: ship\n\n- [x] All done' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should warn about unarchived feature
    expect(result.status).toBe('warn');
    expect(result.message).toContain('completed features not archived');
    expect(result.details?.unarchived).toContain('completed-feature');
  });

  it('should detect "ship" completion pattern', async () => {
    // GIVEN - Feature with "ship" phase
    features({ 'feature-1': '## Current Phase: ship' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-1');
  });

  it('should detect "SHIP" completion pattern (case insensitive)', async () => {
    // GIVEN - Feature with uppercase "SHIP" phase
    features({ 'feature-2': '## Current Phase: SHIP' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-2');
  });

  it('should detect "complete" completion pattern', async () => {
    // GIVEN - Feature with "complete" phase
    features({ 'feature-3': '## Current Phase: complete' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-3');
  });

  it('should detect "COMPLETE" completion pattern', async () => {
    // GIVEN - Feature with uppercase "COMPLETE" phase
    features({ 'feature-4': '## Current Phase: COMPLETE' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-4');
  });

  it('should detect "(COMPLETE)" completion pattern', async () => {
    // GIVEN - Feature with phase marked as complete with parentheses
    features({ 'feature-5': '## Current Phase: build (COMPLETE)' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-5');
  });

  it('should detect "(complete)" completion pattern (lowercase)', async () => {
    // GIVEN - Feature with phase marked as complete with lowercase parentheses
    features({ 'feature-6': '## Current Phase: build (complete)' });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-6');
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
    // GIVEN - Multiple completed features
    features({
      'feature-1': '## Current Phase: ship',
      'feature-2': '## Current Phase: build', // not complete
      'feature-3': '## Current Phase: complete',
    });

    // WHEN
    const result = await checkArchive({ devActivePath });

    // THEN - Should detect both completed features
    expect(result.status).toBe('warn');
    // (folder order is the filesystem's, so compared as sets)
    expect([...(result.details?.completedFeatures as string[])].sort()).toEqual(['feature-1', 'feature-3']);
    expect([...(result.details?.unarchived as string[])].sort()).toEqual(['feature-1', 'feature-3']);
  });
});
