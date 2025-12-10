import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { checkLogging } from '../../src/healthchecks/logging.js';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    stat: vi.fn(),
  },
}));

const mockFs = fs as {
  readFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
};

describe('LoggingHealthCheck', () => {
  const sessionLogPath = '/mock/path/session.log';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @behavior Commands log meaningful structured data to session.log
   * @acceptance-criteria AC-LOGGING-001: Recent logs with PHASE, TOOL, TEST entries = pass
   * @business-rule BR-LOGGING-001: Logs must contain structured lifecycle events
   * @boundary Filesystem
   */
  it('should pass when session.log has recent structured entries', async () => {
    // GIVEN - Recent log file with structured data
    const recentLogWithStructuredData = `
[2024-12-09 10:30:00] INIT build session started
[2024-12-09 10:30:05] PHASE build starting
[2024-12-09 10:30:10] TOOL Read src/file.ts
[2024-12-09 10:30:20] TEST 547 tests passing
`;
    mockFs.readFile.mockResolvedValue(recentLogWithStructuredData);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check logging health
    const result = await checkLogging({ sessionLogPath });

    // THEN - Should pass with structured entry details
    expect(result.status).toBe('pass');
    expect(result.details?.hasPhaseEntries).toBe(true);
    expect(result.details?.hasToolEntries).toBe(true);
  });

  /**
   * @behavior Detect stale logs during active sessions
   * @acceptance-criteria AC-LOGGING-002: Log >5min old during active session = warn
   * @business-rule BR-LOGGING-002: Active sessions must produce fresh logs
   * @boundary Filesystem
   */
  it('should warn when session.log is stale (>5 min old during active session)', async () => {
    // GIVEN - Stale log file (5 minutes old) during active session
    const fiveMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    mockFs.stat.mockResolvedValue({ mtime: fiveMinutesAgo });
    mockFs.readFile.mockResolvedValue('[2024-12-09 10:00:00] INIT session started');

    // WHEN - Check logging health with active session
    const result = await checkLogging({ sessionLogPath, sessionActive: true });

    // THEN - Should warn about stale log
    expect(result.status).toBe('warn');
    expect(result.message).toContain('stale');
  });

  /**
   * @behavior Handle missing log files gracefully
   * @acceptance-criteria AC-LOGGING-003: Missing log file = fail
   * @business-rule BR-LOGGING-003: Logging must be operational
   * @boundary Filesystem
   */
  it('should fail when session.log is missing', async () => {
    // GIVEN - Missing log file
    mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    // WHEN - Check logging health
    const result = await checkLogging({ sessionLogPath });

    // THEN - Should fail with missing file error
    expect(result.status).toBe('fail');
    expect(result.message).toContain('missing');
  });

  /**
   * @behavior Report discovered log entry types
   * @acceptance-criteria AC-LOGGING-004: Report entry types found (INIT, PHASE, TOOL, TEST)
   * @business-rule BR-LOGGING-004: Observability requires entry type tracking
   * @boundary Filesystem
   */
  it('should report log entry types found', async () => {
    // GIVEN - Log with various entry types
    const logWithVariousTypes = `
[2024-12-09 10:30:00] INIT build session started
[2024-12-09 10:30:05] PHASE build starting
[2024-12-09 10:30:10] TOOL Read src/file.ts
[2024-12-09 10:30:20] TEST 547 tests passing
`;
    mockFs.readFile.mockResolvedValue(logWithVariousTypes);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check logging health
    const result = await checkLogging({ sessionLogPath });

    // THEN - Should report all entry types found
    expect(result.details?.entryTypes).toEqual(
      expect.arrayContaining(['INIT', 'PHASE', 'TOOL', 'TEST'])
    );
  });

  /**
   * @behavior Allow stale logs when session is inactive
   * @acceptance-criteria AC-LOGGING-005: Stale log + inactive session = pass (no warning)
   * @business-rule BR-LOGGING-005: Only active sessions must produce fresh logs
   * @boundary Filesystem
   */
  it('should pass when session.log is stale but session is inactive', async () => {
    // GIVEN - Stale log file but inactive session
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    mockFs.stat.mockResolvedValue({ mtime: tenMinutesAgo });
    mockFs.readFile.mockResolvedValue(`
[2024-12-09 10:00:00] INIT session started
[2024-12-09 10:00:05] PHASE build starting
`);

    // WHEN - Check logging health with inactive session
    const result = await checkLogging({ sessionLogPath, sessionActive: false });

    // THEN - Should pass (no staleness warning for inactive sessions)
    expect(result.status).toBe('pass');
  });

  /**
   * @behavior Warn when logs lack structured entries
   * @acceptance-criteria AC-LOGGING-006: No PHASE/TOOL entries = warn
   * @business-rule BR-LOGGING-006: Commands must log lifecycle events
   * @boundary Filesystem
   */
  it('should warn when logs have no structured entries', async () => {
    // GIVEN - Log with only INIT entry (no PHASE/TOOL/TEST)
    const logWithoutStructuredEntries = `
[2024-12-09 10:30:00] INIT session started
[2024-12-09 10:30:01] Some unstructured output
`;
    mockFs.readFile.mockResolvedValue(logWithoutStructuredEntries);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check logging health
    const result = await checkLogging({ sessionLogPath });

    // THEN - Should warn about lack of structured entries
    expect(result.status).toBe('warn');
    expect(result.message).toContain('no structured entries');
    expect(result.details?.hasPhaseEntries).toBe(false);
    expect(result.details?.hasToolEntries).toBe(false);
  });

  /**
   * @behavior Recognize actual workflow log format [timestamp] [command] [event]
   * @acceptance-criteria AC-LOGGING-007: Logs with workflow commands (ideate/plan/build/ship) = pass
   * @business-rule BR-LOGGING-007: Actual log format must be recognized
   * @boundary Filesystem
   */
  it('should pass when session.log has workflow command entries', async () => {
    // GIVEN - Log file with actual workflow format
    const workflowLog = `
[13:40:01] [ideate] [start] idea=Improve supervisor
[13:46:16] [ideate] [complete] requirementsCount=7
[13:47:47] [plan] [start]
[13:56:53] [plan] [complete] taskCount=11, phases=6
[14:01:24] [build] [start] totalTasks=11
[14:03:42] [build] [task_complete] current=1, total=11
`;
    mockFs.readFile.mockResolvedValue(workflowLog);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check logging health
    const result = await checkLogging({ sessionLogPath });

    // THEN - Should pass and recognize workflow entries
    expect(result.status).toBe('pass');
    expect(result.details?.hasWorkflowEntries).toBe(true);
    expect(result.details?.workflowCommands).toEqual(
      expect.arrayContaining(['ideate', 'plan', 'build'])
    );
    expect(result.details?.workflowEvents).toEqual(
      expect.arrayContaining(['start', 'complete', 'task_complete'])
    );
  });

  /**
   * @behavior Recognize IRON_LAW entries in workflow logs
   * @acceptance-criteria AC-LOGGING-008: IRON_LAW events indicate TDD compliance logging
   * @business-rule BR-LOGGING-008: TDD compliance must be tracked
   * @boundary Filesystem
   */
  it('should recognize IRON_LAW and other workflow events', async () => {
    // GIVEN - Log file with IRON_LAW entries
    const ironLawLog = `
[15:47:50] [test] [IRON_LAW] PASSED
[15:47:50] [test] [IRON_LAW] FAILED violations=[1,4]
[15:48:07] [build] [PROGRESS] 1/5 - Phase 1
[16:03:02] [ship] [quality_passed] checks=["tests","build"]
[16:13:02] [ship] [pr_created] prNumber=17
[16:13:25] [ship] [merged] branch=feat/agent-feature
`;
    mockFs.readFile.mockResolvedValue(ironLawLog);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check logging health
    const result = await checkLogging({ sessionLogPath });

    // THEN - Should pass and recognize all event types
    expect(result.status).toBe('pass');
    expect(result.details?.hasWorkflowEntries).toBe(true);
    expect(result.details?.workflowCommands).toEqual(
      expect.arrayContaining(['test', 'build', 'ship'])
    );
    expect(result.details?.workflowEvents).toEqual(
      expect.arrayContaining(['IRON_LAW', 'PROGRESS', 'quality_passed', 'pr_created', 'merged'])
    );
  });

  /**
   * @behavior Report workflow command count in pass message
   * @acceptance-criteria AC-LOGGING-009: Pass message shows command/event counts
   * @business-rule BR-LOGGING-009: Observability requires visibility into log contents
   * @boundary Filesystem
   */
  it('should report command and event counts in pass message', async () => {
    // GIVEN - Log with multiple workflow entries
    const workflowLog = `
[10:00:00] [ideate] [start] idea=Feature
[10:01:00] [ideate] [complete] done
[10:02:00] [plan] [start]
[10:03:00] [plan] [complete] tasks=5
`;
    mockFs.readFile.mockResolvedValue(workflowLog);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check logging health
    const result = await checkLogging({ sessionLogPath });

    // THEN - Message should contain counts
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/\d+ commands/);
    expect(result.message).toMatch(/\d+ events/);
  });
});
