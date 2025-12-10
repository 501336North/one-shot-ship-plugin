import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkArchive } from '../../src/healthchecks/archive.js';
import { promises as fs } from 'fs';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}));

describe('ArchiveHealthCheck', () => {
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass when no completed features remain in dev/active/', async () => {
    // GIVEN - Feature in progress (not completed)
    mockFs.readdir.mockResolvedValue([
      { name: 'in-progress-feature', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: build\n\n- [ ] Task 1');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should pass (no completed features to archive)
    expect(result.status).toBe('pass');
    expect(result.message).toContain('All completed features have been archived');
  });

  it('should warn when shipped feature still in dev/active/', async () => {
    // GIVEN - Completed feature not archived
    mockFs.readdir.mockResolvedValue([
      { name: 'completed-feature', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: ship\n\n- [x] All done');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should warn about unarchived feature
    expect(result.status).toBe('warn');
    expect(result.message).toContain('completed features not archived');
    expect(result.details?.unarchived).toContain('completed-feature');
  });

  it('should detect "ship" completion pattern', async () => {
    // GIVEN - Feature with "ship" phase
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-1', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: ship');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-1');
  });

  it('should detect "SHIP" completion pattern (case insensitive)', async () => {
    // GIVEN - Feature with uppercase "SHIP" phase
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-2', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: SHIP');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-2');
  });

  it('should detect "complete" completion pattern', async () => {
    // GIVEN - Feature with "complete" phase
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-3', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: complete');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-3');
  });

  it('should detect "COMPLETE" completion pattern', async () => {
    // GIVEN - Feature with uppercase "COMPLETE" phase
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-4', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: COMPLETE');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-4');
  });

  it('should detect "(COMPLETE)" completion pattern', async () => {
    // GIVEN - Feature with phase marked as complete with parentheses
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-5', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: build (COMPLETE)');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-5');
  });

  it('should detect "(complete)" completion pattern (lowercase)', async () => {
    // GIVEN - Feature with phase marked as complete with lowercase parentheses
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-6', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: build (complete)');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should detect as completed
    expect(result.details?.completedFeatures).toContain('feature-6');
  });

  it('should provide archive command suggestion', async () => {
    // GIVEN - Any scenario
    mockFs.readdir.mockResolvedValue([
      { name: 'feature', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: build');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should suggest using /oss:plan for auto-archive
    expect(result.details?.suggestedAction).toContain('/oss:plan');
  });

  it('should handle empty dev/active/ directory', async () => {
    // GIVEN - No features in dev/active
    mockFs.readdir.mockResolvedValue([] as any);

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should pass (nothing to archive)
    expect(result.status).toBe('pass');
  });

  it('should skip non-directory entries', async () => {
    // GIVEN - Mix of files and directories
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-1', isDirectory: () => true },
      { name: 'README.md', isDirectory: () => false },
    ] as any);
    mockFs.readFile.mockResolvedValue('## Current Phase: build');

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should only check directories
    expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    expect(mockFs.readFile).toHaveBeenCalledWith(
      'dev/active/feature-1/PROGRESS.md',
      'utf-8'
    );
  });

  it('should handle missing PROGRESS.md file', async () => {
    // GIVEN - Feature directory without PROGRESS.md
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-no-progress', isDirectory: () => true },
    ] as any);
    mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file'));

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should skip feature (treat as not completed)
    expect(result.status).toBe('pass');
    expect(result.details?.completedFeatures).not.toContain('feature-no-progress');
  });

  it('should detect multiple completed features', async () => {
    // GIVEN - Multiple completed features
    mockFs.readdir.mockResolvedValue([
      { name: 'feature-1', isDirectory: () => true },
      { name: 'feature-2', isDirectory: () => true },
      { name: 'feature-3', isDirectory: () => true },
    ] as any);
    mockFs.readFile
      .mockResolvedValueOnce('## Current Phase: ship') // feature-1
      .mockResolvedValueOnce('## Current Phase: build') // feature-2 (not complete)
      .mockResolvedValueOnce('## Current Phase: complete'); // feature-3

    // WHEN
    const result = await checkArchive({ devActivePath: 'dev/active' });

    // THEN - Should detect both completed features
    expect(result.status).toBe('warn');
    expect(result.details?.completedFeatures).toEqual(['feature-1', 'feature-3']);
    expect(result.details?.unarchived).toEqual(['feature-1', 'feature-3']);
  });
});
