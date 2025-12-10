import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { checkDevDocs } from '../../src/healthchecks/dev-docs.js';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
  },
}));

const mockFs = fs as {
  stat: ReturnType<typeof vi.fn>;
  access: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
};

describe('DevDocsHealthCheck', () => {
  const featurePath = '/Users/test/.oss/dev/active/test-feature';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @behavior Dev docs are updated regularly during active work
   * @acceptance-criteria AC-DEVDOCS-001: PROGRESS.md updated <1 hour ago = pass
   * @business-rule BR-DEVDOCS-001: Active features must track progress
   * @boundary Filesystem
   */
  it('should pass when PROGRESS.md updated within 1 hour', async () => {
    // GIVEN - Recent PROGRESS.md file (30 minutes ago)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    mockFs.stat.mockResolvedValue({ mtime: thirtyMinutesAgo } as any);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('# Progress\n## Tasks\n- [x] Task 1');

    // WHEN - Check dev docs health
    const result = await checkDevDocs({ featurePath });

    // THEN - Should pass with fresh timestamp
    expect(result.status).toBe('pass');
    expect(result.message).toContain('up-to-date');
  });

  /**
   * @behavior Detect stale progress tracking during active work
   * @acceptance-criteria AC-DEVDOCS-002: PROGRESS.md >1 hour old + active session = warn
   * @business-rule BR-DEVDOCS-002: Stale progress indicates missing updates
   * @boundary Filesystem
   */
  it('should warn when PROGRESS.md is stale (>1 hour during active work)', async () => {
    // GIVEN - Stale PROGRESS.md (2 hours old) during active session
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockFs.stat.mockResolvedValue({ mtime: twoHoursAgo } as any);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('# Progress\n## Tasks\n- [x] Task 1');

    // WHEN - Check dev docs health with active session
    const result = await checkDevDocs({ featurePath, sessionActive: true });

    // THEN - Should warn about stale progress
    expect(result.status).toBe('warn');
    expect(result.message).toContain('stale');
  });

  /**
   * @behavior Required dev docs must exist
   * @acceptance-criteria AC-DEVDOCS-003: Missing PROGRESS.md or PLAN.md = fail
   * @business-rule BR-DEVDOCS-003: All features must have plan and progress tracking
   * @boundary Filesystem
   */
  it('should fail when PROGRESS.md or PLAN.md missing', async () => {
    // GIVEN - Missing PROGRESS.md file
    mockFs.access.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    // WHEN - Check dev docs health
    const result = await checkDevDocs({ featurePath });

    // THEN - Should fail with missing docs error
    expect(result.status).toBe('fail');
    expect(result.message).toContain('missing');
    expect(result.details?.missingDocs).toBeDefined();
    expect(result.details?.missingDocs).toEqual(expect.arrayContaining(['PROGRESS.md']));
  });

  /**
   * @behavior Verify all required docs exist
   * @acceptance-criteria AC-DEVDOCS-004: Report which required docs exist
   * @business-rule BR-DEVDOCS-004: Observability requires doc presence tracking
   * @boundary Filesystem
   */
  it('should verify all required docs exist', async () => {
    // GIVEN - All required docs exist
    mockFs.access.mockResolvedValue(undefined);
    mockFs.stat.mockResolvedValue({ mtime: new Date() } as any);
    mockFs.readFile.mockResolvedValue('# Content');

    // WHEN - Check dev docs health
    const result = await checkDevDocs({ featurePath });

    // THEN - Should report all docs present
    expect(result.details?.hasPlan).toBe(true);
    expect(result.details?.hasProgress).toBe(true);
  });

  /**
   * @behavior Allow stale docs when session is inactive
   * @acceptance-criteria AC-DEVDOCS-005: Stale docs + inactive session = pass (no warning)
   * @business-rule BR-DEVDOCS-005: Only active sessions must produce fresh updates
   * @boundary Filesystem
   */
  it('should pass when PROGRESS.md is stale but session is inactive', async () => {
    // GIVEN - Stale PROGRESS.md but inactive session
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    mockFs.stat.mockResolvedValue({ mtime: threeHoursAgo } as any);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('# Progress\n## Tasks\n- [x] Task 1');

    // WHEN - Check dev docs health with inactive session
    const result = await checkDevDocs({ featurePath, sessionActive: false });

    // THEN - Should pass (no staleness warning for inactive sessions)
    expect(result.status).toBe('pass');
  });

  /**
   * @behavior Handle partial doc presence gracefully
   * @acceptance-criteria AC-DEVDOCS-006: Missing optional docs = pass, missing required = fail
   * @business-rule BR-DEVDOCS-006: Required docs enforce IRON LAW #6
   * @boundary Filesystem
   */
  it('should pass when optional docs missing but required docs present', async () => {
    // GIVEN - PLAN.md and PROGRESS.md exist, DESIGN.md missing (optional)
    mockFs.access.mockImplementation((path: any) => {
      const pathStr = path.toString();
      if (pathStr.includes('DESIGN.md') || pathStr.includes('TESTING.md')) {
        return Promise.reject(new Error('ENOENT'));
      }
      return Promise.resolve(undefined);
    });
    mockFs.stat.mockResolvedValue({ mtime: new Date() } as any);
    mockFs.readFile.mockResolvedValue('# Content');

    // WHEN - Check dev docs health
    const result = await checkDevDocs({ featurePath });

    // THEN - Should pass (optional docs can be missing)
    expect(result.status).toBe('pass');
    expect(result.details?.hasPlan).toBe(true);
    expect(result.details?.hasProgress).toBe(true);
  });

  /**
   * @behavior Report both required and optional docs
   * @acceptance-criteria AC-DEVDOCS-007: Report presence of all doc types
   * @business-rule BR-DEVDOCS-007: Full observability of dev docs state
   * @boundary Filesystem
   */
  it('should report presence of both required and optional docs', async () => {
    // GIVEN - All docs exist
    mockFs.access.mockResolvedValue(undefined);
    mockFs.stat.mockResolvedValue({ mtime: new Date() } as any);
    mockFs.readFile.mockResolvedValue('# Content');

    // WHEN - Check dev docs health
    const result = await checkDevDocs({ featurePath });

    // THEN - Should report all doc types
    expect(result.details?.hasPlan).toBe(true);
    expect(result.details?.hasProgress).toBe(true);
    expect(result.details?.hasDesign).toBe(true);
    expect(result.details?.hasTesting).toBe(true);
  });

  /**
   * @behavior Handle filesystem errors gracefully
   * @acceptance-criteria AC-DEVDOCS-008: Filesystem error = fail with clear message
   * @business-rule BR-DEVDOCS-008: Robust error handling for observability
   * @boundary Filesystem
   */
  it('should fail gracefully on filesystem errors', async () => {
    // GIVEN - Filesystem error (permission denied on stat)
    mockFs.access.mockResolvedValue(undefined);
    mockFs.stat.mockRejectedValue(new Error('EACCES: permission denied'));

    // WHEN - Check dev docs health
    const result = await checkDevDocs({ featurePath });

    // THEN - Should fail with clear error message
    expect(result.status).toBe('fail');
    expect(result.message).toContain('error');
  });
});
