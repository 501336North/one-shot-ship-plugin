/**
 * HealthcheckService Tests
 *
 * @behavior HealthcheckService runs all checks and returns aggregated report
 * @acceptance-criteria AC-HEALTH.1 through AC-HEALTH.8
 * @boundary Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthcheckService } from '../../src/services/healthcheck.js';
import { promises as fs } from 'fs';
import { execAsync } from '../../src/utils/exec.js';

// Mock fs module for checkLogging, checkDevDocs, and checkArchive
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn(),
  },
}));

// Mock execAsync for git-safety check
vi.mock('../../src/utils/exec', () => ({
  execAsync: vi.fn(),
}));

const mockFs = fs as {
  readFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  access: ReturnType<typeof vi.fn>;
  readdir: ReturnType<typeof vi.fn>;
};

const mockExec = vi.mocked(execAsync);

describe('HealthcheckService', () => {
  let mockLogReader: any;
  let mockQueueManager: any;
  let mockFileSystem: any;
  let service: HealthcheckService;

  beforeEach(() => {
    // Mock all collaborators (London TDD)
    mockLogReader = {
      readLogs: vi.fn().mockResolvedValue([]),
    };

    mockQueueManager = {
      getTasks: vi.fn().mockResolvedValue([]),
    };

    mockFileSystem = {
      exists: vi.fn().mockReturnValue(true),
      readFile: vi.fn().mockReturnValue('{}'),
    };

    // Mock session log file for checkLogging
    const validSessionLog = `
[2024-12-09 10:30:00] INIT session started
[2024-12-09 10:30:05] PHASE build starting
[2024-12-09 10:30:10] TOOL Read src/file.ts
`;
    mockFs.readFile.mockResolvedValue(validSessionLog);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });
    mockFs.access.mockResolvedValue(undefined); // Dev docs exist
    mockFs.readdir.mockResolvedValue([]); // Empty dev/active (no features to archive)

    // Mock git commands for checkGitSafety (default: passing)
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('git branch --show-current')) {
        return { stdout: 'feat/my-feature\n', stderr: '' };
      }
      if (cmd.includes('--grep="Co-Authored-By: Claude"')) {
        return { stdout: '', stderr: '' }; // No agent commits on main
      }
      if (cmd.includes('git log main -1 --format=%ci')) {
        return { stdout: '2025-12-09 10:00:00 -0800\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    service = new HealthcheckService({
      logReader: mockLogReader,
      queueManager: mockQueueManager,
      fileSystem: mockFileSystem,
      sessionLogPath: '/tmp/test-session.log',
      sessionActive: false,
    });
  });

  describe('runChecks', () => {
    it('should return HealthReport with all 8 check results', async () => {
      const report = await service.runChecks();

      // Verify report structure
      expect(report.timestamp).toBeDefined();
      expect(report.overall_status).toMatch(/healthy|warning|critical/);

      // Verify all 8 checks are present
      expect(Object.keys(report.checks)).toHaveLength(8);
      expect(report.checks).toHaveProperty('logging');
      expect(report.checks).toHaveProperty('dev_docs');
      expect(report.checks).toHaveProperty('delegation');
      expect(report.checks).toHaveProperty('queue');
      expect(report.checks).toHaveProperty('archive');
      expect(report.checks).toHaveProperty('quality_gates');
      expect(report.checks).toHaveProperty('notifications');
      expect(report.checks).toHaveProperty('git_safety');

      // Verify each check has required fields
      Object.values(report.checks).forEach((check) => {
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('message');
        expect(check.status).toMatch(/pass|warn|fail/);
      });
    });

    it('should return healthy when all checks pass', async () => {
      const report = await service.runChecks();

      // With default mocks (no issues), should be healthy
      expect(report.overall_status).toBe('healthy');

      // All checks should pass
      Object.values(report.checks).forEach((check) => {
        expect(check.status).toBe('pass');
      });
    });

    it('should return warning when any check has issues', async () => {
      // Mock session log with no structured entries to trigger warning
      const logWithNoStructure = `
[2024-12-09 10:30:00] INIT session started
[2024-12-09 10:30:01] Some unstructured output
`;
      mockFs.readFile.mockResolvedValue(logWithNoStructure);

      const report = await service.runChecks();

      // Should detect the warning condition
      expect(report.overall_status).toBe('warning');

      // At least one check should have warning
      const statuses = Object.values(report.checks).map((c) => c.status);
      expect(statuses).toContain('warn');
    });

    it('should return critical when any check fails', async () => {
      // Mock a critical failure condition - missing session log
      mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const report = await service.runChecks();

      // Should detect the failure
      expect(report.overall_status).toBe('critical');

      // At least one check should have failed
      const statuses = Object.values(report.checks).map((c) => c.status);
      expect(statuses).toContain('fail');
    });
  });

  describe('check status aggregation', () => {
    it('should prioritize critical over warning', async () => {
      // Setup conditions for both warning and critical
      // Missing session log = fail, no structured entries = warn
      mockFs.readFile.mockRejectedValue(new Error('ENOENT: file not found'));

      const report = await service.runChecks();

      // Critical should take priority
      expect(report.overall_status).toBe('critical');
    });

    it('should prioritize warning over healthy', async () => {
      // Setup condition for warning only (no structured entries)
      const logWithNoStructure = `
[2024-12-09 10:30:00] INIT session started
`;
      mockFs.readFile.mockResolvedValue(logWithNoStructure);

      const report = await service.runChecks();

      // Should be warning, not healthy
      expect(report.overall_status).toBe('warning');
    });
  });

  describe('check execution', () => {
    it('should call all check methods', async () => {
      // Spy on individual check methods (will be implemented in GREEN phase)
      const checkLoggingSpy = vi.spyOn(service as any, 'checkLogging');
      const checkDevDocsSpy = vi.spyOn(service as any, 'checkDevDocs');
      const checkDelegationSpy = vi.spyOn(service as any, 'checkDelegation');
      const checkQueueSpy = vi.spyOn(service as any, 'checkQueue');
      const checkArchiveSpy = vi.spyOn(service as any, 'checkArchive');
      const checkQualityGatesSpy = vi.spyOn(service as any, 'checkQualityGates');
      const checkNotificationsSpy = vi.spyOn(service as any, 'checkNotifications');
      const checkGitSafetySpy = vi.spyOn(service as any, 'checkGitSafety');

      await service.runChecks();

      // Verify all checks were called
      expect(checkLoggingSpy).toHaveBeenCalledOnce();
      expect(checkDevDocsSpy).toHaveBeenCalledOnce();
      expect(checkDelegationSpy).toHaveBeenCalledOnce();
      expect(checkQueueSpy).toHaveBeenCalledOnce();
      expect(checkArchiveSpy).toHaveBeenCalledOnce();
      expect(checkQualityGatesSpy).toHaveBeenCalledOnce();
      expect(checkNotificationsSpy).toHaveBeenCalledOnce();
      expect(checkGitSafetySpy).toHaveBeenCalledOnce();
    });
  });
});
