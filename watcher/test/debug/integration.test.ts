/**
 * Command Integration Tests
 * Tests that all debug modules export correctly and work together
 */

import { describe, it, expect } from 'vitest';
import * as debugIndex from '../../src/debug/index.js';
import type { ParsedBug } from '../../src/debug/bug-parser.js';
import type { RootCause } from '../../src/debug/investigation.js';
import type { ConfirmedBug } from '../../src/debug/reproduction.js';

describe('Debug Module Integration', () => {
  describe('Module Exports', () => {
    it('should export all debug module functions', () => {
      // Bug parser exports
      expect(debugIndex.parseInput).toBeDefined();
      expect(debugIndex.parseStackTrace).toBeDefined();
      expect(debugIndex.parseDescription).toBeDefined();
      expect(debugIndex.mergeInputs).toBeDefined();

      // Investigation exports
      expect(debugIndex.createInvestigationTask).toBeDefined();
      expect(debugIndex.parseInvestigationResult).toBeDefined();

      // Confirmation exports
      expect(debugIndex.formatRootCauses).toBeDefined();
      expect(debugIndex.createConfirmationQuestion).toBeDefined();
      expect(debugIndex.shouldAutoConfirm).toBeDefined();

      // Severity exports
      expect(debugIndex.inferSeverity).toBeDefined();
      expect(debugIndex.createSeverityQuestion).toBeDefined();

      // Reproduction exports
      expect(debugIndex.getTestPath).toBeDefined();
      expect(debugIndex.createTestTask).toBeDefined();
      expect(debugIndex.generateTestContent).toBeDefined();

      // Test runner exports
      expect(debugIndex.buildTestCommand).toBeDefined();
      expect(debugIndex.parseTestResult).toBeDefined();
      expect(debugIndex.verifyTestFails).toBeDefined();

      // Documentation exports
      expect(debugIndex.generateDebugDoc).toBeDefined();

      // Progress update exports
      expect(debugIndex.appendFixTasks).toBeDefined();
      expect(debugIndex.createProgressContent).toBeDefined();

      // Directory exports
      expect(debugIndex.selectDirectory).toBeDefined();
      expect(debugIndex.createBugfixDirName).toBeDefined();
      expect(debugIndex.sanitizeDirName).toBeDefined();

      // Compatibility exports
      expect(debugIndex.formatForBuild).toBeDefined();
      expect(debugIndex.getCommandChainSuggestion).toBeDefined();

      // Logging exports
      expect(debugIndex.formatDebugLogEntry).toBeDefined();

      // Notification exports
      expect(debugIndex.createDebugNotification).toBeDefined();

      // Plugin exports
      expect(debugIndex.validateCommandFile).toBeDefined();
    });

    it('should verify complete debug workflow types', () => {
      // Type test: ensure types are exported and compatible
      const parsedBug: ParsedBug = {
        type: 'error',
        errorType: 'TypeError',
        message: 'test',
        component: 'auth',
      };

      const rootCause: RootCause = {
        description: 'Missing null check',
        likelihood: 'high',
        evidence: ['Line 42'],
        affectedFiles: ['src/auth.ts'],
      };

      const confirmedBug: ConfirmedBug = {
        ...parsedBug,
        rootCause,
        severity: 'high',
      };

      // If types compile, test passes
      expect(parsedBug.type).toBe('error');
      expect(rootCause.likelihood).toBe('high');
      expect(confirmedBug.severity).toBe('high');
    });

    it('should validate debug → build handoff', () => {
      // Test that debug output format is compatible with build input format
      const fixTasks = [
        {
          objective: 'Add null check',
          tests: 'reproduction test passes',
          implementation: 'Add if statement in auth.ts',
          acceptance: 'Test passes',
          phase: 'green' as const,
        },
        {
          objective: 'Extract validation logic',
          tests: 'All tests still pass',
          implementation: 'Move to validation module',
          acceptance: 'No duplication',
          phase: 'refactor' as const,
        },
      ];

      const buildTasks = debugIndex.formatForBuild(fixTasks);

      // Verify build-compatible format
      expect(buildTasks).toBeDefined();
      expect(buildTasks.phases).toBeDefined();
      expect(buildTasks.phases.length).toBeGreaterThan(0);
      expect(buildTasks.phases[0].name).toBe('green');
      expect(buildTasks.phases[0].tasks.length).toBe(1);
      expect(buildTasks.phases[1].name).toBe('refactor');
      expect(buildTasks.phases[1].tasks.length).toBe(1);
    });
  });
});
