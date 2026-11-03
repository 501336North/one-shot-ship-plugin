/**
 * HealthcheckService Tests
 *
 * @behavior HealthcheckService runs all checks and returns aggregated report
 * @acceptance-criteria AC-HEALTH.1 through AC-HEALTH.8
 * @boundary Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HealthcheckService } from '../../src/services/healthcheck.js';
import { execAsync } from '../../src/utils/exec.js';

// Mock execAsync for git-safety check
vi.mock('../../src/utils/exec', () => ({
  execAsync: vi.fn(),
}));

const mockExec = vi.mocked(execAsync);

type Deps = ConstructorParameters<typeof HealthcheckService>[0];

describe('HealthcheckService', () => {
  let tmp: string;
  let sessionLogPath: string;
  let service: HealthcheckService;

  /** The real session.log the logging and delegation checks read. */
  function writeLog(text: string): void {
    fs.writeFileSync(sessionLogPath, text);
  }

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Real files: a session.log, and an empty dev/active (no features to archive)
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-healthcheck-service-'));
    sessionLogPath = path.join(tmp, 'session.log');
    const devActivePath = path.join(tmp, 'dev', 'active');
    fs.mkdirSync(devActivePath, { recursive: true });

    // Mock the queue collaborator (London TDD)
    const queueManager: Deps['queueManager'] = {
      getTasks: vi.fn().mockResolvedValue([]),
    };

    // Session log file for checkLogging
    const validSessionLog = `
[2024-12-09 10:30:00] INIT session started
[2024-12-09 10:30:05] PHASE build starting
[2024-12-09 10:30:10] TOOL Read src/file.ts
`;
    writeLog(validSessionLog);

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
      logReader: {},
      queueManager,
      fileSystem: {},
      sessionLogPath,
      devActivePath,
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
      writeLog(logWithNoStructure);

      const report = await service.runChecks();

      // Should detect the warning condition
      expect(report.overall_status).toBe('warning');

      // At least one check should have warning
      const statuses = Object.values(report.checks).map((c) => c.status);
      expect(statuses).toContain('warn');
    });

    it('should return critical when any check fails', async () => {
      // A critical failure condition - missing session log
      fs.rmSync(sessionLogPath);

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
      fs.rmSync(sessionLogPath);

      const report = await service.runChecks();

      // Critical should take priority
      expect(report.overall_status).toBe('critical');
    });

    it('should prioritize warning over healthy', async () => {
      // Setup condition for warning only (no structured entries)
      const logWithNoStructure = `
[2024-12-09 10:30:00] INIT session started
`;
      writeLog(logWithNoStructure);

      const report = await service.runChecks();

      // Should be warning, not healthy
      expect(report.overall_status).toBe('warning');
    });
  });

  describe('check execution', () => {
    it('should call all check methods', async () => {
      // Spy on individual check methods (private: reached through a typed view of the service)
      type CheckName = 'checkLogging' | 'checkDevDocs' | 'checkDelegation' | 'checkQueue' | 'checkArchive'
        | 'checkQualityGates' | 'checkNotifications' | 'checkGitSafety';
      const checks = service as unknown as Record<CheckName, () => Promise<unknown>>;
      const checkLoggingSpy = vi.spyOn(checks, 'checkLogging');
      const checkDevDocsSpy = vi.spyOn(checks, 'checkDevDocs');
      const checkDelegationSpy = vi.spyOn(checks, 'checkDelegation');
      const checkQueueSpy = vi.spyOn(checks, 'checkQueue');
      const checkArchiveSpy = vi.spyOn(checks, 'checkArchive');
      const checkQualityGatesSpy = vi.spyOn(checks, 'checkQualityGates');
      const checkNotificationsSpy = vi.spyOn(checks, 'checkNotifications');
      const checkGitSafetySpy = vi.spyOn(checks, 'checkGitSafety');

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
