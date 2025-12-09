import { describe, it, expect, beforeEach } from 'vitest';
import { IronLawLogParser, IronLawResult } from '../../src/monitors/iron-law-log-parser.js';

interface IronLawViolationRecord {
  law: number;
  message: string;
  correction?: string;
  timestamp: string;
}

describe('IronLawLogParser - PRE-CHECK Parsing', () => {
  let monitor: IronLawLogParser;

  beforeEach(() => {
    monitor = new IronLawLogParser();
  });

  describe('isIronLawCheck', () => {
    it('should detect IRON LAW PRE-CHECK in log line', () => {
      const line = 'IRON LAW PRE-CHECK';
      expect(monitor.isIronLawCheck(line)).toBe(true);
    });

    it('should detect IRON LAW PRE-CHECK in log line with content', () => {
      const line = 'Running IRON LAW PRE-CHECK before proceeding';
      expect(monitor.isIronLawCheck(line)).toBe(true);
    });

    it('should return false for non-IRON-LAW lines', () => {
      const line = 'Some random log output';
      expect(monitor.isIronLawCheck(line)).toBe(false);
    });
  });

  describe('parseViolation', () => {
    it('should parse violation from log line', () => {
      const line = "├─ ❌ LAW #4: On 'main' branch (should be feature branch)";
      const result = monitor.parseViolation(line);

      expect(result).toEqual({
        law: 4,
        message: "On 'main' branch (should be feature branch)",
        passed: false,
      });
    });

    it('should parse violation with different law number', () => {
      const line = "├─ ❌ LAW #1: Tests failing";
      const result = monitor.parseViolation(line);

      expect(result).toEqual({
        law: 1,
        message: "Tests failing",
        passed: false,
      });
    });

    it('should return null for non-violation lines', () => {
      const line = "Some random log output";
      const result = monitor.parseViolation(line);

      expect(result).toBeNull();
    });
  });

  describe('parsePass', () => {
    it('should parse pass from log line', () => {
      const line = "├─ ✅ LAW #1: No skipped tests found";
      const result = monitor.parsePass(line);

      expect(result).toEqual({
        law: 1,
        message: "No skipped tests found",
        passed: true,
      });
    });

    it('should parse pass with different law number', () => {
      const line = "├─ ✅ LAW #4: On feature branch";
      const result = monitor.parsePass(line);

      expect(result).toEqual({
        law: 4,
        message: "On feature branch",
        passed: true,
      });
    });

    it('should return null for non-pass lines', () => {
      const line = "Some random log output";
      const result = monitor.parsePass(line);

      expect(result).toBeNull();
    });
  });

  describe('extractCorrectionHint', () => {
    it('should extract correction hint from log line', () => {
      const line = "│  → Create feature branch before making changes";
      const result = monitor.extractCorrectionHint(line);

      expect(result).toBe("Create feature branch before making changes");
    });

    it('should extract correction hint with different text', () => {
      const line = "│  → Run tests before committing";
      const result = monitor.extractCorrectionHint(line);

      expect(result).toBe("Run tests before committing");
    });

    it('should return null for non-correction lines', () => {
      const line = "Some random log output";
      const result = monitor.extractCorrectionHint(line);

      expect(result).toBeNull();
    });
  });

  describe('isIronLawCheckPassed', () => {
    it('should handle PRE-CHECK PASSED header', () => {
      const line = "✅ IRON LAW PRE-CHECK PASSED";
      expect(monitor.isIronLawCheckPassed(line)).toBe(true);
    });

    it('should handle PRE-CHECK PASSED with extra text', () => {
      const line = "✅ IRON LAW PRE-CHECK PASSED - All laws satisfied";
      expect(monitor.isIronLawCheckPassed(line)).toBe(true);
    });

    it('should return false for non-passed lines', () => {
      const line = "Some random log output";
      expect(monitor.isIronLawCheckPassed(line)).toBe(false);
    });
  });

  describe('parseLine - integration', () => {
    it('should parse complete PRE-CHECK block', () => {
      const lines = [
        'IRON LAW PRE-CHECK',
        '├─ ✅ LAW #1: No skipped tests found',
        '├─ ❌ LAW #4: On \'main\' branch (should be feature branch)',
        '│  → Create feature branch before making changes',
        '└─ ✅ LAW #6: Dev docs in sync',
      ];

      const results: Array<IronLawResult | string | null> = [];

      lines.forEach(line => {
        if (monitor.isIronLawCheck(line)) {
          results.push('CHECK_START');
        }

        const violation = monitor.parseViolation(line);
        if (violation) {
          results.push(violation);
        }

        const pass = monitor.parsePass(line);
        if (pass) {
          results.push(pass);
        }

        const hint = monitor.extractCorrectionHint(line);
        if (hint) {
          results.push(hint);
        }
      });

      expect(results).toEqual([
        'CHECK_START',
        { law: 1, message: 'No skipped tests found', passed: true },
        { law: 4, message: 'On \'main\' branch (should be feature branch)', passed: false },
        'Create feature branch before making changes',
        { law: 6, message: 'Dev docs in sync', passed: true },
      ]);
    });
  });

  describe('return null for non-IRON-LAW lines', () => {
    it('should return null from all parse methods for random log line', () => {
      const line = 'Starting build process...';

      expect(monitor.isIronLawCheck(line)).toBe(false);
      expect(monitor.parseViolation(line)).toBeNull();
      expect(monitor.parsePass(line)).toBeNull();
      expect(monitor.extractCorrectionHint(line)).toBeNull();
      expect(monitor.isIronLawCheckPassed(line)).toBe(false);
    });
  });
});

describe('IronLawLogParser - Violation State Tracking', () => {
  let monitor: IronLawLogParser;

  beforeEach(() => {
    monitor = new IronLawLogParser();
  });

  describe('recordViolation & getViolationCount', () => {
    it('should track first violation for a law', () => {
      monitor.recordViolation(4, "On main branch");
      expect(monitor.getViolationCount(4)).toBe(1);
    });

    it('should track multiple violations for same law', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");
      monitor.recordViolation(4, "Still on main branch again");
      expect(monitor.getViolationCount(4)).toBe(3);
    });

    it('should track violations independently per law', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");
      monitor.recordViolation(1, "Tests failing");

      expect(monitor.getViolationCount(4)).toBe(2);
      expect(monitor.getViolationCount(1)).toBe(1);
    });
  });

  describe('recordPass', () => {
    it('should reset violations when law passes', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");

      monitor.recordPass(4);

      expect(monitor.getViolationCount(4)).toBe(0);
    });
  });

  describe('getViolationHistory', () => {
    it('should track violation history with timestamps', () => {
      monitor.recordViolation(4, "First violation");
      monitor.recordViolation(4, "Second violation");

      const history = monitor.getViolationHistory(4);

      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        law: 4,
        message: "First violation",
      });
      expect(history[0].timestamp).toBeDefined();
      expect(history[1]).toMatchObject({
        law: 4,
        message: "Second violation",
      });
      expect(history[1].timestamp).toBeDefined();
    });

    it('should preserve history even after reset', () => {
      monitor.recordViolation(4, "First violation");
      monitor.recordViolation(4, "Second violation");
      monitor.recordPass(4);
      monitor.recordViolation(4, "Third violation after reset");

      const history = monitor.getViolationHistory(4);

      expect(history).toHaveLength(3);
      expect(history[0].message).toBe("First violation");
      expect(history[1].message).toBe("Second violation");
      expect(history[2].message).toBe("Third violation after reset");
    });
  });
});

describe('IronLawLogParser - Intervention Task Creation', () => {
  let monitor: IronLawLogParser;

  beforeEach(() => {
    monitor = new IronLawLogParser();
  });

  describe('createInterventionTask', () => {
    it('should return null for 1st violation (no task created)', () => {
      monitor.recordViolation(4, "On main branch");

      const task = monitor.createInterventionTask(4, "On main branch");

      expect(task).toBeNull();
    });

    it('should return LOW priority task for 2nd violation', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");

      const task = monitor.createInterventionTask(4, "Still on main branch");

      expect(task).not.toBeNull();
      expect(task?.priority).toBe('low');
    });

    it('should return HIGH priority task for 3rd violation', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");
      monitor.recordViolation(4, "Still on main branch again");

      const task = monitor.createInterventionTask(4, "Still on main branch again");

      expect(task).not.toBeNull();
      expect(task?.priority).toBe('high');
    });

    it('should have correct anomaly_type for 2nd violation', () => {
      monitor.recordViolation(1, "Tests failing");
      monitor.recordViolation(1, "Tests still failing");

      const task = monitor.createInterventionTask(1, "Tests still failing");

      expect(task).not.toBeNull();
      expect(task?.anomaly_type).toBe('iron_law_violation');
    });

    it('should have correct anomaly_type for 3rd+ violation', () => {
      monitor.recordViolation(1, "Tests failing");
      monitor.recordViolation(1, "Tests still failing");
      monitor.recordViolation(1, "Tests still failing again");

      const task = monitor.createInterventionTask(1, "Tests still failing again");

      expect(task).not.toBeNull();
      expect(task?.anomaly_type).toBe('iron_law_repeated');
    });

    it('should include IRON LAWS fetch instruction for 3rd+ violation', () => {
      monitor.recordViolation(1, "Tests failing");
      monitor.recordViolation(1, "Tests still failing");
      monitor.recordViolation(1, "Tests still failing again");

      const task = monitor.createInterventionTask(1, "Tests still failing again", "Run tests before committing");

      expect(task).not.toBeNull();
      expect(task?.prompt).toContain('MANDATORY: Fetch IRON LAWS and place at top of context');
      expect(task?.prompt).toContain('IRON LAW #1 violated 3+ times');
    });

    it('should include API URL in prompt for 3rd+ violation', () => {
      monitor.recordViolation(2, "Using any type");
      monitor.recordViolation(2, "Using any type again");
      monitor.recordViolation(2, "Using any type still");

      const task = monitor.createInterventionTask(2, "Using any type still");

      expect(task).not.toBeNull();
      expect(task?.prompt).toContain('https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws');
      expect(task?.prompt).toContain('curl -s -H "Authorization: Bearer {apiKey}"');
    });

    it('should have correct source', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");

      const task = monitor.createInterventionTask(4, "Still on main branch");

      expect(task).not.toBeNull();
      expect(task?.source).toBe('iron-law-monitor');
    });

    it('should include law number in context', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");

      const task = monitor.createInterventionTask(4, "Still on main branch");

      expect(task).not.toBeNull();
      expect(task?.context.law).toBe(4);
    });

    it('should include correction hint in context when provided', () => {
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");

      const task = monitor.createInterventionTask(4, "Still on main branch", "Create feature branch before making changes");

      expect(task).not.toBeNull();
      expect(task?.prompt).toContain("Create feature branch before making changes");
    });
  });
});

describe('IronLawLogParser - Session Reset', () => {
  let monitor: IronLawLogParser;

  beforeEach(() => {
    monitor = new IronLawLogParser();
  });

  describe('reset', () => {
    it('should clear active violation counts', () => {
      // Record violations for multiple laws
      monitor.recordViolation(1, "Tests failing");
      monitor.recordViolation(1, "Tests still failing");
      monitor.recordViolation(4, "On main branch");
      monitor.recordViolation(4, "Still on main branch");
      monitor.recordViolation(4, "Still on main branch again");

      // Verify violations are recorded
      expect(monitor.getViolationCount(1)).toBe(2);
      expect(monitor.getViolationCount(4)).toBe(3);

      // Reset should clear active violations
      monitor.reset();

      // Violation counts should be 0
      expect(monitor.getViolationCount(1)).toBe(0);
      expect(monitor.getViolationCount(4)).toBe(0);
    });

    it('should preserve violation history', () => {
      // Record violations
      monitor.recordViolation(4, "First violation");
      monitor.recordViolation(4, "Second violation");
      monitor.recordViolation(1, "Different law violation");

      // Get history before reset
      const historyBeforeReset = monitor.getViolationHistory(4);
      expect(historyBeforeReset).toHaveLength(2);

      // Reset
      monitor.reset();

      // History should still be accessible
      const historyAfterReset = monitor.getViolationHistory(4);
      expect(historyAfterReset).toHaveLength(2);
      expect(historyAfterReset[0].message).toBe("First violation");
      expect(historyAfterReset[1].message).toBe("Second violation");

      // History for other laws should also be preserved
      const law1History = monitor.getViolationHistory(1);
      expect(law1History).toHaveLength(1);
      expect(law1History[0].message).toBe("Different law violation");
    });

    it('should allow new violations to accumulate from 1', () => {
      // Record 3 violations (triggers high-priority intervention)
      monitor.recordViolation(4, "First violation");
      monitor.recordViolation(4, "Second violation");
      monitor.recordViolation(4, "Third violation");
      expect(monitor.getViolationCount(4)).toBe(3);

      // Reset
      monitor.reset();
      expect(monitor.getViolationCount(4)).toBe(0);

      // New violations should start counting from 1
      monitor.recordViolation(4, "First violation after reset");
      expect(monitor.getViolationCount(4)).toBe(1);

      // First violation should not create intervention task
      const task1 = monitor.createInterventionTask(4, "First violation after reset");
      expect(task1).toBeNull();

      // Second violation should create low-priority task
      monitor.recordViolation(4, "Second violation after reset");
      expect(monitor.getViolationCount(4)).toBe(2);
      const task2 = monitor.createInterventionTask(4, "Second violation after reset");
      expect(task2).not.toBeNull();
      expect(task2?.priority).toBe('low');

      // Third violation should create high-priority task
      monitor.recordViolation(4, "Third violation after reset");
      expect(monitor.getViolationCount(4)).toBe(3);
      const task3 = monitor.createInterventionTask(4, "Third violation after reset");
      expect(task3).not.toBeNull();
      expect(task3?.priority).toBe('high');
    });
  });
});
