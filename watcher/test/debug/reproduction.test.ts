/**
 * Reproduction Test Generation Tests
 * @behavior Generates failing test that proves bug exists (TDD RED phase)
 */

import { describe, it, expect } from 'vitest';
import {
  getTestPath,
  generateTestContent,
  createTestTask,
  type ConfirmedBug,
} from '../../src/debug/reproduction.js';

describe('Reproduction Test Generation', () => {
  /**
   * @behavior System generates test file path based on bug location
   * @acceptance-criteria AC-DBG-005
   * @boundary Test Path Generation
   */
  describe('getTestPath', () => {
    it('should generate test file path based on bug location', () => {
      // GIVEN - Bug in src/auth.ts
      const bug = {
        type: 'error' as const,
        errorType: 'TypeError',
        file: 'src/auth.ts',
      };

      // WHEN - Getting test path
      const result = getTestPath(bug);

      // THEN - Returns path like 'test/auth/bug-{timestamp}.test.ts'
      expect(result).toMatch(/^test\/auth\/bug-\d+\.test\.ts$/);
    });

    it('should handle bugs without file location', () => {
      // GIVEN - Bug without file specified
      const bug = {
        type: 'error' as const,
        errorType: 'TypeError',
      };

      // WHEN - Getting test path
      const result = getTestPath(bug);

      // THEN - Returns default path like 'test/bug-{timestamp}.test.ts'
      expect(result).toMatch(/^test\/bug-\d+\.test\.ts$/);
    });
  });

  /**
   * @behavior System creates test that encodes expected behavior
   * @acceptance-criteria AC-DBG-005
   * @boundary Test Content Generation
   */
  describe('generateTestContent', () => {
    it('should create test that encodes expected behavior', () => {
      // GIVEN - Confirmed bug with root cause
      const bug: ConfirmedBug = {
        type: 'error',
        errorType: 'TypeError',
        message: "Cannot read property 'id' of undefined",
        component: 'auth',
        expected: 'user object with id',
        actual: 'undefined',
        rootCause: {
          cause: 'Missing null check before accessing user.id',
          evidence: 'Line 42: return user.id without validation',
        },
        severity: 'high',
      };

      // WHEN - Generating test content
      const result = generateTestContent(bug);

      // THEN - Test contains describe block
      expect(result).toContain('describe(');

      // THEN - Test contains it block
      expect(result).toContain('it(');

      // THEN - Test contains expected vs actual assertion
      expect(result).toContain('expect(');

      // THEN - Test includes bug context
      expect(result).toContain('auth');
    });
  });

  /**
   * @behavior System delegates test writing to test-engineer agent
   * @acceptance-criteria AC-DBG-005
   * @boundary Agent Delegation
   */
  describe('createTestTask', () => {
    it('should delegate test writing to test-engineer agent', () => {
      // GIVEN - Confirmed bug
      const bug: ConfirmedBug = {
        type: 'error',
        errorType: 'TypeError',
        message: "Cannot read property 'id'",
        rootCause: {
          cause: 'Missing null check',
          evidence: 'Line 42',
        },
        severity: 'high',
      };

      // WHEN - Creating test task
      const result = createTestTask(bug);

      // THEN - Returns valid TaskParams
      expect(result).toHaveProperty('subagent_type', 'test-engineer');
      expect(result).toHaveProperty('prompt');

      // THEN - Prompt includes bug context
      expect(result.prompt).toContain('TypeError');
      expect(result.prompt).toContain('Missing null check');
    });
  });
});
