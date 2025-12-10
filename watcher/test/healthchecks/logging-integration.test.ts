/**
 * Health check logging integration tests
 *
 * @behavior Health check results are logged for supervisor analysis
 * @acceptance-criteria AC-HEALTH-LOG.1 through AC-HEALTH-LOG.3
 * @boundary Service Integration with Shell Script
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HealthcheckService } from '../../src/services/healthcheck.js';
import { promises as fs } from 'fs';
import { execAsync } from '../../src/utils/exec.js';

// Mock fs module for healthcheck dependencies
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

// Mock child_process.execSync to capture oss-log.sh calls
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockFs = fs as {
  readFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  access: ReturnType<typeof vi.fn>;
  readdir: ReturnType<typeof vi.fn>;
};

const mockExec = vi.mocked(execAsync);

describe('Health check logging integration', () => {
  let mockLogReader: any;
  let mockQueueManager: any;
  let mockFileSystem: any;
  let service: HealthcheckService;
  let mockExecSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Import mocked child_process and get reference to execSync mock
    const { execSync } = await import('child_process');
    mockExecSync = vi.mocked(execSync);
    mockExecSync.mockClear();
    mockExecSync.mockReturnValue(Buffer.from(''));

    // Mock all collaborators (London TDD)
    mockLogReader = {
      readLogs: vi.fn().mockResolvedValue([]),
    };

    mockQueueManager = {
      getQueue: vi.fn().mockResolvedValue({ tasks: [] }),
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
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);

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

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @behavior Health check results are logged to session.log via oss-log.sh
   * @acceptance-criteria AC-HEALTH-LOG.1
   */
  it('should log HEALTH_CHECK event to session.log', async () => {
    // WHEN - Run health checks
    await service.runChecks();

    // THEN - Verify oss-log.sh health was called
    expect(mockExecSync).toHaveBeenCalled();

    const calls = mockExecSync.mock.calls.map((call) => call[0] as string);
    const healthLogCalls = calls.filter((cmd) =>
      cmd.includes('oss-log.sh') && cmd.includes('health')
    );

    expect(healthLogCalls.length).toBeGreaterThan(0);

    // Verify the command includes health status
    const healthCall = healthLogCalls[0];
    expect(healthCall).toMatch(/health\s+(healthy|warning|critical)/);
  });

  /**
   * @behavior Individual check results are included in health log
   * @acceptance-criteria AC-HEALTH-LOG.2
   */
  it('should log individual check results', async () => {
    // WHEN - Run health checks
    await service.runChecks();

    // THEN - Verify health log includes details JSON
    const calls = mockExecSync.mock.calls.map((call) => call[0] as string);
    const healthLogCalls = calls.filter((cmd) =>
      cmd.includes('oss-log.sh') && cmd.includes('health')
    );

    expect(healthLogCalls.length).toBeGreaterThan(0);

    const healthCall = healthLogCalls[0];
    // Should include JSON with check statuses
    expect(healthCall).toContain('logging');
    expect(healthCall).toContain('git_safety');
  });

  /**
   * @behavior Suspicious patterns are logged for audit
   * @acceptance-criteria AC-HEALTH-LOG.3
   */
  it('should log suspicious patterns for audit', async () => {
    // GIVEN - Mock git-safety check to fail (agent pushed to main)
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('git branch --show-current')) {
        return { stdout: 'main\n', stderr: '' };
      }
      if (cmd.includes('--grep="Co-Authored-By: Claude"')) {
        // Simulate finding agent commit on main
        return { stdout: 'abc123 Agent pushed to main\n', stderr: '' };
      }
      if (cmd.includes('git log main -1 --format=%ci')) {
        return { stdout: '2025-12-09 10:00:00 -0800\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    // WHEN - Run health checks
    await service.runChecks();

    // THEN - Verify health log shows critical status
    const calls = mockExecSync.mock.calls.map((call) => call[0] as string);
    const healthLogCalls = calls.filter((cmd) =>
      cmd.includes('oss-log.sh') && cmd.includes('health')
    );

    expect(healthLogCalls.length).toBeGreaterThan(0);

    const healthCall = healthLogCalls[0];
    expect(healthCall).toMatch(/health\s+critical/);
  });

  /**
   * @behavior Health checks with all passing should log healthy status
   * @acceptance-criteria AC-HEALTH-LOG.1
   */
  it('should log healthy status when all checks pass', async () => {
    // GIVEN - All checks pass (default mocks)

    // WHEN - Run health checks
    await service.runChecks();

    // THEN - Verify healthy status logged
    const calls = mockExecSync.mock.calls.map((call) => call[0] as string);
    const healthLogCalls = calls.filter((cmd) =>
      cmd.includes('oss-log.sh') && cmd.includes('health')
    );

    expect(healthLogCalls.length).toBeGreaterThan(0);

    const healthCall = healthLogCalls[0];
    expect(healthCall).toMatch(/health\s+healthy/);
  });

  /**
   * @behavior Health checks with warnings should log warning status
   * @acceptance-criteria AC-HEALTH-LOG.1
   */
  it('should log warning status when any check has issues', async () => {
    // GIVEN - Mock session log with no structured entries to trigger warning
    const logWithNoStructure = `
[2024-12-09 10:30:00] INIT session started
[2024-12-09 10:30:01] Some unstructured output
`;
    mockFs.readFile.mockResolvedValue(logWithNoStructure);

    // WHEN - Run health checks
    await service.runChecks();

    // THEN - Verify warning status logged
    const calls = mockExecSync.mock.calls.map((call) => call[0] as string);
    const healthLogCalls = calls.filter((cmd) =>
      cmd.includes('oss-log.sh') && cmd.includes('health')
    );

    expect(healthLogCalls.length).toBeGreaterThan(0);

    const healthCall = healthLogCalls[0];
    expect(healthCall).toMatch(/health\s+warning/);
  });
});
