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
});
