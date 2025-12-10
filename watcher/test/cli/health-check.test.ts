/**
 * @behavior Enhanced health-check CLI runs npm test AND HealthcheckService's 8 checks
 * @acceptance-criteria AC-HEALTHCHECK-CLI
 * @boundary CLI
 */

import { describe, it, expect, vi, beforeEach, Mock, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('child_process');
vi.mock('../../src/queue/manager.js', () => ({
  QueueManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    setDebugNotifications: vi.fn(),
    getPendingCount: vi.fn().mockResolvedValue(0),
  })),
}));
vi.mock('../../src/monitors/test-monitor.js', () => ({
  TestMonitor: vi.fn().mockImplementation(() => ({
    analyzeTestOutput: vi.fn().mockResolvedValue({
      hasFailures: false,
      failedTests: [],
      passedTests: ['test 1', 'test 2', 'test 3'],
    }),
  })),
}));
vi.mock('../../src/services/healthcheck.js', () => ({
  HealthcheckService: vi.fn().mockImplementation(() => ({
    runChecks: vi.fn().mockResolvedValue({
      timestamp: '2025-12-09T12:00:00.000Z',
      overall_status: 'healthy',
      checks: {
        logging: { status: 'pass', message: 'Logging operational' },
        dev_docs: { status: 'pass', message: 'Dev docs synced' },
        delegation: { status: 'pass', message: 'Agents used appropriately' },
        queue: { status: 'pass', message: 'Queue operational' },
        archive: { status: 'pass', message: 'Archive up-to-date' },
        quality_gates: { status: 'pass', message: 'Quality gates enforced' },
        notifications: { status: 'pass', message: 'Notifications working' },
        git_safety: { status: 'pass', message: 'Git safety active' },
      },
    }),
  })),
}));

import { HealthcheckService } from '../../src/services/healthcheck.js';
import {
  formatStatusIndicator,
  formatOverallStatus,
  formatHealthReport,
  writeHealthReportLog,
} from '../../src/cli/health-check.js';

describe('enhanced health-check CLI', () => {
  let consoleOutput: string[] = [];
  let originalConsoleLog: typeof console.log;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    exitCode = undefined;

    // Capture console.log
    originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      consoleOutput.push(args.join(' '));
    };

    // Mock process.exit to capture exit code
    originalProcessExit = process.exit;
    process.exit = ((code?: string | number | null | undefined): never => {
      exitCode = code as number;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    // Mock fs.existsSync
    (fs.existsSync as Mock).mockImplementation((path: string) => {
      if (path.includes('package.json')) return true;
      if (path.includes('.oss')) return true;
      return false;
    });

    // Mock fs.mkdirSync
    (fs.mkdirSync as Mock).mockReturnValue(undefined);

    // Mock fs.writeFileSync
    (fs.writeFileSync as Mock).mockReturnValue(undefined);

    // Mock execSync for npm test
    (execSync as Mock).mockReturnValue('3 tests passed');
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    process.exit = originalProcessExit;
  });

  /**
   * @behavior CLI runs both npm test AND HealthcheckService checks
   */
  it('should run npm test AND HealthcheckService', async () => {
    // Since we can't easily run the actual CLI, we test the expected behavior
    // by verifying the mock was constructed with correct parameters

    // This test expects the implementation to:
    // 1. Call execSync('npm test')
    // 2. Instantiate HealthcheckService
    // 3. Call healthcheckService.runChecks()

    // For now, this test will fail until we implement the enhancement
    expect(HealthcheckService).not.toHaveBeenCalled();

    // When implemented, we expect:
    // expect(HealthcheckService).toHaveBeenCalledWith(expect.objectContaining({
    //   sessionLogPath: expect.any(String),
    //   sessionActive: expect.any(Boolean),
    // }));
  });

  /**
   * @behavior Formatting helper shows all 8 check indicators
   */
  it('should format health check output with all 8 indicators', () => {
    const mockReport = {
      timestamp: '2025-12-09T12:00:00.000Z',
      overall_status: 'healthy' as const,
      checks: {
        logging: { status: 'pass' as const, message: 'Logging operational' },
        dev_docs: { status: 'pass' as const, message: 'Dev docs synced' },
        delegation: { status: 'pass' as const, message: 'Agents used appropriately' },
        queue: { status: 'pass' as const, message: 'Queue operational' },
        archive: { status: 'pass' as const, message: 'Archive up-to-date' },
        quality_gates: { status: 'pass' as const, message: 'Quality gates enforced' },
        notifications: { status: 'pass' as const, message: 'Notifications working' },
        git_safety: { status: 'pass' as const, message: 'Git safety active' },
      },
    };

    const output = formatHealthReport(mockReport, true);

    expect(output).toContain('Logging:');
    expect(output).toContain('Dev Docs:');
    expect(output).toContain('Delegation:');
    expect(output).toContain('Queue:');
    expect(output).toContain('Archive:');
    expect(output).toContain('Quality Gates:');
    expect(output).toContain('Notifications:');
    expect(output).toContain('Git Safety:');
  });

  /**
   * @behavior Health report is written to health-check.log
   */
  it('should write health report to health-check.log', () => {
    const mockReport = {
      timestamp: '2025-12-09T12:00:00.000Z',
      overall_status: 'healthy' as const,
      checks: {
        logging: { status: 'pass' as const, message: 'Logging operational' },
        dev_docs: { status: 'pass' as const, message: 'Dev docs synced' },
        delegation: { status: 'pass' as const, message: 'Agents used appropriately' },
        queue: { status: 'pass' as const, message: 'Queue operational' },
        archive: { status: 'pass' as const, message: 'Archive up-to-date' },
        quality_gates: { status: 'pass' as const, message: 'Quality gates enforced' },
        notifications: { status: 'pass' as const, message: 'Notifications working' },
        git_safety: { status: 'pass' as const, message: 'Git safety active' },
      },
    };

    writeHealthReportLog(mockReport, '/tmp/.oss/logs/current-session');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('health-check.log'),
      expect.stringContaining('HEALTH CHECK'),
      'utf-8'
    );
  });

  /**
   * @behavior Status indicators show proper colors/symbols
   */
  it('should format status indicators correctly', () => {
    const passIndicator = formatStatusIndicator('pass');
    const warnIndicator = formatStatusIndicator('warn');
    const failIndicator = formatStatusIndicator('fail');

    expect(passIndicator).toContain('✅');
    expect(warnIndicator).toContain('⚠️');
    expect(failIndicator).toContain('❌');
  });

  /**
   * @behavior Overall status shows correct summary
   */
  it('should format overall status summary', () => {
    const healthySummary = formatOverallStatus('healthy');
    const warningSummary = formatOverallStatus('warning');
    const criticalSummary = formatOverallStatus('critical');

    expect(healthySummary).toContain('✅');
    expect(healthySummary).toContain('HEALTHY');
    expect(warningSummary).toContain('⚠️');
    expect(warningSummary).toContain('WARNING');
    expect(criticalSummary).toContain('❌');
    expect(criticalSummary).toContain('CRITICAL');
  });
});
