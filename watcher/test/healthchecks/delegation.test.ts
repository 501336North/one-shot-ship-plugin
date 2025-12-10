import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { checkDelegation } from '../../src/healthchecks/delegation.js';

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

describe('DelegationHealthCheck', () => {
  const sessionLogPath = '/mock/path/session.log';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @behavior Agents are being delegated for specialized work
   * @acceptance-criteria AC-DELEGATION-001: AGENT entries in recent log = pass
   * @business-rule BR-DELEGATION-001: Specialized work must be delegated to agents
   * @boundary Filesystem
   */
  it('should pass when AGENT entries exist in recent log', async () => {
    // GIVEN - Recent log with AGENT delegation entries
    const logWithAgentDelegation = `
[2024-12-09 10:30:00] INIT build session started
[2024-12-09 10:30:10] AGENT typescript-pro "Implement service"
[2024-12-09 10:30:20] TOOL Read src/file.ts
[2024-12-09 10:30:30] AGENT test-engineer "Write unit tests"
`;
    mockFs.readFile.mockResolvedValue(logWithAgentDelegation);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check delegation health
    const result = await checkDelegation({ sessionLogPath });

    // THEN - Should pass with agent delegation details
    expect(result.status).toBe('pass');
    expect(result.message).toContain('Agent delegation is active');
  });

  /**
   * @behavior Detect lack of delegation during active work
   * @acceptance-criteria AC-DELEGATION-002: No AGENT entries in 30+ min of active work = warn
   * @business-rule BR-DELEGATION-002: Active sessions should use agents for specialized tasks
   * @boundary Filesystem
   */
  it('should warn when no delegation in last 30+ minutes of active work', async () => {
    // GIVEN - Active session log with no AGENT entries (30+ min of work)
    const logWithoutDelegation = `
[2024-12-09 10:00:00] INIT build session started
[2024-12-09 10:00:10] PHASE build starting
[2024-12-09 10:00:20] TOOL Read src/services/complex.ts
[2024-12-09 10:00:30] TOOL Edit src/services/complex.ts
[2024-12-09 10:30:00] TOOL Read test/services/complex.test.ts
`;
    mockFs.readFile.mockResolvedValue(logWithoutDelegation);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check delegation health with active session
    const result = await checkDelegation({ sessionLogPath, sessionActive: true });

    // THEN - Should warn about lack of delegation
    expect(result.status).toBe('warn');
    expect(result.message).toContain('delegation');
  });

  /**
   * @behavior Track which agent types are being used
   * @acceptance-criteria AC-DELEGATION-003: Report agent types found in log
   * @business-rule BR-DELEGATION-003: Observability requires agent type tracking
   * @boundary Filesystem
   */
  it('should track which agent types are being used', async () => {
    // GIVEN - Log with multiple agent types
    const logWithMultipleAgents = `
[2024-12-09 10:30:00] AGENT typescript-pro "Implement service"
[2024-12-09 10:35:00] AGENT test-engineer "Write unit tests"
[2024-12-09 10:40:00] AGENT typescript-pro "Refactor code"
`;
    mockFs.readFile.mockResolvedValue(logWithMultipleAgents);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check delegation health
    const result = await checkDelegation({ sessionLogPath });

    // THEN - Should report agent types found
    expect(result.details?.agentTypes).toContain('typescript-pro');
    expect(result.details?.agentTypes).toContain('test-engineer');
    expect(result.details?.agentCount).toBe(3);
  });

  /**
   * @behavior Suggest delegation when specialized code detected without agent
   * @acceptance-criteria AC-DELEGATION-004: Specialized file modifications without agent = suggest agent
   * @business-rule BR-DELEGATION-004: Complex work should be delegated
   * @boundary Filesystem
   */
  it('should suggest delegation when specialized code detected without agent', async () => {
    // GIVEN - TypeScript files modified but no typescript-pro agent
    const logWithSpecializedWorkNoAgent = `
[2024-12-09 10:30:00] INIT build session started
[2024-12-09 10:30:10] TOOL Edit src/services/complex.ts
[2024-12-09 10:30:20] TOOL Edit src/types.ts
[2024-12-09 10:30:30] TOOL Edit src/services/auth.ts
`;
    mockFs.readFile.mockResolvedValue(logWithSpecializedWorkNoAgent);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check delegation health with active session
    const result = await checkDelegation({ sessionLogPath, sessionActive: true });

    // THEN - Should suggest appropriate agent
    expect(result.details?.suggestedAgents).toContain('typescript-pro');
  });

  /**
   * @behavior Handle missing log files gracefully
   * @acceptance-criteria AC-DELEGATION-005: Missing log file = fail
   * @business-rule BR-DELEGATION-005: Delegation check requires log file
   * @boundary Filesystem
   */
  it('should fail when session.log is missing', async () => {
    // GIVEN - Missing log file
    mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    // WHEN - Check delegation health
    const result = await checkDelegation({ sessionLogPath });

    // THEN - Should fail with missing file error
    expect(result.status).toBe('fail');
    expect(result.message).toContain('missing');
  });

  /**
   * @behavior Allow no delegation when session is inactive
   * @acceptance-criteria AC-DELEGATION-006: No delegation + inactive session = pass (no warning)
   * @business-rule BR-DELEGATION-006: Only active sessions need delegation
   * @boundary Filesystem
   */
  it('should pass when no delegation but session is inactive', async () => {
    // GIVEN - Log with no AGENT entries but inactive session
    const logWithoutDelegation = `
[2024-12-09 10:00:00] INIT build session started
[2024-12-09 10:00:10] PHASE build starting
`;
    mockFs.readFile.mockResolvedValue(logWithoutDelegation);
    mockFs.stat.mockResolvedValue({ mtime: new Date() });

    // WHEN - Check delegation health with inactive session
    const result = await checkDelegation({ sessionLogPath, sessionActive: false });

    // THEN - Should pass (no delegation warning for inactive sessions)
    expect(result.status).toBe('pass');
  });
});
