/**
 * Test Runner Tests
 * @behavior Runs reproduction test and verifies it fails (RED confirmation)
 */

import { describe, it, expect } from 'vitest';
import {
  buildTestCommand,
  parseTestResult,
  verifyTestFails,
  type TestResult,
} from '../../src/debug/test-runner.js';

describe('Test Runner', () => {
  /**
   * @behavior System runs single test file
   * @acceptance-criteria AC-DBG-006
   * @boundary Test Execution
   */
  describe('buildTestCommand', () => {
    it('should run single test file', () => {
      // GIVEN - Test file path
      const testPath = 'test/auth/bug-123.test.ts';

      // WHEN - Building test command
      const result = buildTestCommand(testPath);

      // THEN - Returns npm test command with correct filter
      expect(result).toContain('npm test');
      expect(result).toContain('bug-123.test.ts');
    });
  });

  /**
   * @behavior System parses test failure output
   * @acceptance-criteria AC-DBG-006
   * @boundary Test Result Parsing
   */
  describe('parseTestResult', () => {
    it('should parse test failure output', () => {
      // GIVEN - Test failure output
      const failureOutput = `
 FAIL  test/auth/bug-123.test.ts
 ❯ test/auth/bug-123.test.ts > auth > Missing null check
   AssertionError: expected undefined to equal { id: 1 }
      `;

      // WHEN - Parsing test result
      const result = parseTestResult(failureOutput);

      // THEN - Returns failure with error message
      expect(result.passed).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain('AssertionError');
    });

    it('should parse test success output', () => {
      // GIVEN - Test success output
      const successOutput = `
 ✓ test/auth/bug-123.test.ts (1 test) 3ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
      `;

      // WHEN - Parsing test result
      const result = parseTestResult(successOutput);

      // THEN - Returns success
      expect(result.passed).toBe(true);
      expect(result.errorMessage).toBeUndefined();
    });
  });

  /**
   * @behavior System rejects if test passes (bug not reproduced)
   * @acceptance-criteria AC-DBG-006
   * @boundary Test Verification
   */
  describe('verifyTestFails', () => {
    it('should reject if test passes (bug not reproduced)', () => {
      // GIVEN - Test passed
      const result: TestResult = { passed: true };

      // WHEN - Verifying test fails
      const verification = verifyTestFails(result);

      // THEN - Returns error
      expect(verification.success).toBe(false);
      expect(verification.error).toContain('Bug not reproduced');
    });

    it('should accept if test fails', () => {
      // GIVEN - Test failed
      const result: TestResult = {
        passed: false,
        errorMessage: 'AssertionError',
      };

      // WHEN - Verifying test fails
      const verification = verifyTestFails(result);

      // THEN - Returns success
      expect(verification.success).toBe(true);
      expect(verification.error).toBeUndefined();
    });
  });
});
