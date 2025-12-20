/**
 * @behavior Parse error messages and stack traces from user input
 * @acceptance-criteria AC-DBG-001
 * @boundary Input Parser
 */

import { describe, it, expect } from 'vitest';
import {
  parseInput,
  parseStackTrace,
  parseDescription,
  mergeInputs,
} from '../../src/debug/bug-parser.js';

describe('Bug Parser - Error Message Input', () => {
  /**
   * @behavior Extract error type and message from error string
   * @acceptance-criteria DBG-001
   */
  it('should extract error type from error message', () => {
    const result = parseInput("TypeError: Cannot read property 'id'");

    expect(result).toEqual({
      type: 'error',
      errorType: 'TypeError',
      message: "Cannot read property 'id'",
    });
  });

  /**
   * @behavior Parse file path, line, and column from stack trace
   * @acceptance-criteria DBG-001
   */
  it('should extract file and line from stack trace', () => {
    const result = parseStackTrace('at foo (src/auth.ts:42:10)');

    expect(result).toEqual([
      {
        function: 'foo',
        file: 'src/auth.ts',
        line: 42,
        column: 10,
      },
    ]);
  });

  /**
   * @behavior Parse multiple stack frames from multiline trace
   * @acceptance-criteria DBG-001
   */
  it('should handle multiline stack traces', () => {
    const stackTrace = `at foo (src/auth.ts:42:10)
at bar (src/user.ts:15:5)
at processRequest (src/api.ts:100:20)`;

    const result = parseStackTrace(stackTrace);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      function: 'foo',
      file: 'src/auth.ts',
      line: 42,
      column: 10,
    });
    expect(result[1]).toEqual({
      function: 'bar',
      file: 'src/user.ts',
      line: 15,
      column: 5,
    });
    expect(result[2]).toEqual({
      function: 'processRequest',
      file: 'src/api.ts',
      line: 100,
      column: 20,
    });
  });
});

describe('Bug Parser - Natural Language Descriptions', () => {
  /**
   * @behavior Identify affected component from description
   * @acceptance-criteria DBG-001
   */
  it('should identify affected component from description', () => {
    const result = parseDescription('login form shows wrong error');

    expect(result.component).toBe('login');
  });

  /**
   * @behavior Extract expected vs actual behavior
   * @acceptance-criteria DBG-001
   */
  it('should extract expected vs actual behavior', () => {
    const result = parseDescription('should show validation error but shows success message');

    expect(result.expected).toBe('validation error');
    expect(result.actual).toBe('success message');
  });

  /**
   * @behavior Merge parsed error with description context
   * @acceptance-criteria DBG-001
   */
  it('should handle combined input (error + description)', () => {
    const error = parseInput("TypeError: Cannot read property 'id'");
    const description = parseDescription('login form crashes on apostrophe');

    const result = mergeInputs(error, description);

    expect(result.type).toBe('error');
    expect(result.errorType).toBe('TypeError');
    expect(result.component).toBe('login');
  });
});
