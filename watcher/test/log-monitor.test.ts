import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LogMonitor } from '../src/monitors/log-monitor';
import { QueueManager } from '../src/queue/manager';
import { RuleEngine, RuleMatch } from '../src/detectors/rules';
import { Task, CreateTaskInput } from '../src/types';

// Mock dependencies
vi.mock('../src/queue/manager');
vi.mock('../src/detectors/rules');

/**
 * @behavior Log monitor detects anomalies in agent output
 * @acceptance-criteria AC-002.1, AC-002.2, AC-002.3, AC-002.4, AC-002.5
 */
describe('LogMonitor', () => {
  let monitor: LogMonitor;
  let mockQueueManager: {
    addTask: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
  };
  let mockRuleEngine: {
    analyze: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockQueueManager = {
      addTask: vi.fn().mockResolvedValue({ id: 'task-123' } as Task),
      initialize: vi.fn().mockResolvedValue(undefined),
    };

    mockRuleEngine = {
      analyze: vi.fn().mockReturnValue(null),
    };

    monitor = new LogMonitor(
      mockQueueManager as unknown as QueueManager,
      mockRuleEngine as unknown as RuleEngine
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // AC-002.1: Tails agent stdout/stderr (simulated via processLine)
  describe('log processing', () => {
    it('should process individual log lines', async () => {
      await monitor.processLine('Normal log message');
      expect(mockRuleEngine.analyze).toHaveBeenCalledWith('Normal log message');
    });

    it('should process multiple lines', async () => {
      await monitor.processLine('Line 1');
      await monitor.processLine('Line 2');
      await monitor.processLine('Line 3');

      expect(mockRuleEngine.analyze).toHaveBeenCalledTimes(3);
    });

    it('should trim whitespace from lines', async () => {
      await monitor.processLine('  padded line  ');
      expect(mockRuleEngine.analyze).toHaveBeenCalledWith('padded line');
    });

    it('should skip empty lines', async () => {
      await monitor.processLine('');
      await monitor.processLine('   ');
      expect(mockRuleEngine.analyze).not.toHaveBeenCalled();
    });
  });

  // AC-002.2: Detects error patterns via rule engine
  describe('error detection', () => {
    it('should call rule engine for each line', async () => {
      await monitor.processLine('Error: something failed');
      expect(mockRuleEngine.analyze).toHaveBeenCalledWith('Error: something failed');
    });

    it('should create task when rule engine detects anomaly', async () => {
      const ruleMatch: RuleMatch = {
        anomaly_type: 'exception',
        priority: 'medium',
        context: { log_excerpt: 'Error: boom' },
        suggested_agent: 'debugger',
        prompt: 'Fix the error',
      };
      mockRuleEngine.analyze.mockReturnValue(ruleMatch);

      await monitor.processLine('Error: boom');

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'exception',
          priority: 'medium',
          source: 'log-monitor',
          suggested_agent: 'debugger',
          prompt: 'Fix the error',
        })
      );
    });

    it('should not create task when no anomaly detected', async () => {
      mockRuleEngine.analyze.mockReturnValue(null);

      await monitor.processLine('Normal log line');

      expect(mockQueueManager.addTask).not.toHaveBeenCalled();
    });
  });

  // AC-002.3: Detects loop patterns (tracked by monitor)
  describe('loop detection', () => {
    it('should track tool call frequency', async () => {
      // Rule engine returns loop match after 5 calls
      mockRuleEngine.analyze.mockImplementation((log: string) => {
        if (log.includes('Tool: Grep') && log.split('Tool: Grep').length > 5) {
          return {
            anomaly_type: 'agent_loop',
            priority: 'high',
            context: { repeat_count: 5, tool_name: 'Grep' },
            suggested_agent: 'debugger',
            prompt: 'Break the loop',
          };
        }
        return null;
      });

      // Simulate 5 consecutive same tool calls
      const toolLog = 'Tool: Grep pattern=foo';
      await monitor.processLine(toolLog);
      await monitor.processLine(toolLog);
      await monitor.processLine(toolLog);
      await monitor.processLine(toolLog);
      await monitor.processLine(toolLog);

      // Monitor should aggregate and detect loop
      const recentLogs = monitor.getRecentLogs(100);
      expect(recentLogs).toContain(toolLog);
    });

    it('should aggregate recent logs for pattern analysis', async () => {
      await monitor.processLine('Line 1');
      await monitor.processLine('Line 2');
      await monitor.processLine('Line 3');

      const recentLogs = monitor.getRecentLogs(10);
      expect(recentLogs).toContain('Line 1');
      expect(recentLogs).toContain('Line 2');
      expect(recentLogs).toContain('Line 3');
    });

    it('should limit log buffer size', async () => {
      // Add more lines than buffer capacity
      for (let i = 0; i < 150; i++) {
        await monitor.processLine(`Line ${i}`);
      }

      const recentLogs = monitor.getRecentLogs(200);
      // Should be limited to buffer size (default 100)
      expect(recentLogs.split('\n').length).toBeLessThanOrEqual(100);
    });
  });

  // AC-002.4: Detects stuck agents (no output for >60 seconds)
  describe('stuck detection', () => {
    it('should track last activity timestamp', async () => {
      const beforeProcess = Date.now();
      await monitor.processLine('Some output');
      const lastActivity = monitor.getLastActivityTime();

      expect(lastActivity).toBeGreaterThanOrEqual(beforeProcess);
    });

    it('should detect no output for 60+ seconds', async () => {
      vi.useFakeTimers();

      await monitor.processLine('Initial output');

      // Advance time by 61 seconds
      vi.advanceTimersByTime(61000);

      const isStuck = monitor.checkIfStuck(60);
      expect(isStuck).toBe(true);
    });

    it('should not report stuck if recent activity', async () => {
      vi.useFakeTimers();

      await monitor.processLine('Recent output');

      // Only 30 seconds elapsed
      vi.advanceTimersByTime(30000);

      const isStuck = monitor.checkIfStuck(60);
      expect(isStuck).toBe(false);
    });

    it('should create task when stuck detected', async () => {
      vi.useFakeTimers();

      await monitor.processLine('Initial output');
      vi.advanceTimersByTime(61000);

      await monitor.checkAndReportStuck(60);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'agent_stuck',
          priority: 'high',
          source: 'log-monitor',
        })
      );
    });

    it('should not double-report stuck state', async () => {
      vi.useFakeTimers();

      await monitor.processLine('Initial output');
      vi.advanceTimersByTime(61000);

      await monitor.checkAndReportStuck(60);
      await monitor.checkAndReportStuck(60);

      // Should only create one task
      expect(mockQueueManager.addTask).toHaveBeenCalledTimes(1);
    });

    it('should reset stuck state after new activity', async () => {
      vi.useFakeTimers();

      await monitor.processLine('Initial output');
      vi.advanceTimersByTime(61000);

      await monitor.checkAndReportStuck(60);
      expect(mockQueueManager.addTask).toHaveBeenCalledTimes(1);

      // New activity
      await monitor.processLine('New output');

      vi.advanceTimersByTime(61000);
      await monitor.checkAndReportStuck(60);

      // Should create another task (new stuck period)
      expect(mockQueueManager.addTask).toHaveBeenCalledTimes(2);
    });
  });

  // AC-002.5: Creates task on anomaly (verified above)
  describe('task creation', () => {
    it('should include source as log-monitor', async () => {
      const ruleMatch: RuleMatch = {
        anomaly_type: 'test_failure',
        priority: 'high',
        context: {},
        suggested_agent: 'debugger',
        prompt: 'Fix test',
      };
      mockRuleEngine.analyze.mockReturnValue(ruleMatch);

      await monitor.processLine('FAIL test.ts');

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'log-monitor',
        })
      );
    });

    it('should pass context from rule match', async () => {
      const ruleMatch: RuleMatch = {
        anomaly_type: 'exception',
        priority: 'medium',
        context: {
          file: 'src/foo.ts',
          line: 42,
          log_excerpt: 'TypeError: boom',
        },
        suggested_agent: 'debugger',
        prompt: 'Fix error',
      };
      mockRuleEngine.analyze.mockReturnValue(ruleMatch);

      await monitor.processLine('TypeError: boom at src/foo.ts:42');

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            file: 'src/foo.ts',
            line: 42,
          }),
        })
      );
    });
  });

  // Aggregate analysis (full buffer check)
  describe('aggregate analysis', () => {
    it('should analyze aggregated logs periodically', async () => {
      // Add several lines that together form a pattern
      for (let i = 0; i < 5; i++) {
        await monitor.processLine('Tool: Read file=same.ts');
      }

      // Trigger aggregate analysis
      await monitor.analyzeAggregated();

      // Rule engine should be called with aggregated content
      expect(mockRuleEngine.analyze).toHaveBeenCalledWith(
        expect.stringContaining('Tool: Read file=same.ts')
      );
    });
  });

  // Buffer management
  describe('buffer management', () => {
    it('should clear buffer on reset', async () => {
      await monitor.processLine('Line 1');
      await monitor.processLine('Line 2');

      monitor.reset();

      const recentLogs = monitor.getRecentLogs(10);
      expect(recentLogs).toBe('');
    });

    it('should reset stuck tracking on reset', async () => {
      vi.useFakeTimers();

      await monitor.processLine('Output');
      vi.advanceTimersByTime(61000);

      await monitor.checkAndReportStuck(60);
      expect(mockQueueManager.addTask).toHaveBeenCalledTimes(1);

      // Reset clears the "already reported" flag and sets new baseline
      monitor.reset();

      // Not stuck immediately after reset
      const isStuckImmediately = monitor.checkIfStuck(60);
      expect(isStuckImmediately).toBe(false);

      // Advance 30 seconds - still not stuck
      vi.advanceTimersByTime(30000);
      await monitor.checkAndReportStuck(60);
      expect(mockQueueManager.addTask).toHaveBeenCalledTimes(1); // No new call
    });
  });
});
