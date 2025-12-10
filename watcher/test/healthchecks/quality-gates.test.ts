/**
 * @behavior Verify parallel quality gates are working (code-review, performance, security)
 * @acceptance-criteria All three gates must run in parallel during ship
 * @boundary Health Check System
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkQualityGates } from '../../src/healthchecks/quality-gates';
import { promises as fs } from 'fs';

// Mock the fs module
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

const mockFs = fs as {
  readFile: ReturnType<typeof vi.fn>;
};

describe('QualityGatesHealthCheck', () => {
  const sessionLogPath = '/tmp/session.log';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass when all 3 quality gates ran in last ship', async () => {
    // GIVEN - Mock log file with all 3 gates passed
    const logContent = `[2024-12-09T10:30:00] info QUALITY_GATE code-review passed
[2024-12-09T10:30:00] info QUALITY_GATE performance passed
[2024-12-09T10:30:01] info QUALITY_GATE security passed`;
    mockFs.readFile.mockResolvedValue(logContent);

    // WHEN - Check quality gates health
    const result = await checkQualityGates({ sessionLogPath });

    // THEN - Should pass with all gates run
    expect(result.status).toBe('pass');
    expect(result.message).toContain('All quality gates passed');
    expect(result.details?.gatesRun).toEqual(['code-review', 'performance', 'security']);
  });

  it('should warn when not all gates ran', async () => {
    // GIVEN - Mock log file with only one gate
    const logContent = `[2024-12-09T10:30:00] info QUALITY_GATE code-review passed`;
    mockFs.readFile.mockResolvedValue(logContent);

    // WHEN - Check quality gates health
    const result = await checkQualityGates({ sessionLogPath });

    // THEN - Should warn with missing gates
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Not all quality gates ran');
    expect(result.details?.gatesRun).toEqual(['code-review']);
    expect(result.details?.missingGates).toContain('performance');
    expect(result.details?.missingGates).toContain('security');
  });

  it('should fail when any gate failed', async () => {
    // GIVEN - Mock log file with a failed gate
    const logContent = `[2024-12-09T10:30:00] error QUALITY_GATE security failed: SQL injection vulnerabilities found`;
    mockFs.readFile.mockResolvedValue(logContent);

    // WHEN - Check quality gates health
    const result = await checkQualityGates({ sessionLogPath });

    // THEN - Should fail with failed gates
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Quality gate failures detected');
    expect(result.details?.failedGates).toContain('security');
    expect(result.details?.failures).toEqual([
      { gate: 'security', reason: 'SQL injection vulnerabilities found' }
    ]);
  });

  it('should track if gates ran in parallel', async () => {
    // GIVEN - Mock log file with gates starting within 1 second
    const logContent = `[2024-12-09T10:30:00] info QUALITY_GATE code-review passed
[2024-12-09T10:30:00] info QUALITY_GATE performance passed
[2024-12-09T10:30:01] info QUALITY_GATE security passed`;
    mockFs.readFile.mockResolvedValue(logContent);

    // WHEN - Check quality gates health
    const result = await checkQualityGates({ sessionLogPath });

    // THEN - Should detect parallel execution
    expect(result.details?.ranInParallel).toBe(true);
  });

  it('should warn if gates did not run in parallel', async () => {
    // GIVEN - Mock log file with gates with >1 second gaps
    const logContent = `[2024-12-09T10:30:00] info QUALITY_GATE code-review passed
[2024-12-09T10:30:03] info QUALITY_GATE performance passed
[2024-12-09T10:30:06] info QUALITY_GATE security passed`;
    mockFs.readFile.mockResolvedValue(logContent);

    // WHEN - Check quality gates health
    const result = await checkQualityGates({ sessionLogPath });

    // THEN - Should detect sequential execution
    expect(result.details?.ranInParallel).toBe(false);
    expect(result.message).toContain('not running in parallel');
  });

  it('should handle no quality gate entries', async () => {
    // GIVEN - Mock log file with no gate entries
    const logContent = `[2024-12-09T10:30:00] info Some other log entry`;
    mockFs.readFile.mockResolvedValue(logContent);

    // WHEN - Check quality gates health
    const result = await checkQualityGates({ sessionLogPath });

    // THEN - Should fail with no gates found
    expect(result.status).toBe('fail');
    expect(result.message).toContain('No quality gates found');
    expect(result.details?.gatesRun).toEqual([]);
  });
});
