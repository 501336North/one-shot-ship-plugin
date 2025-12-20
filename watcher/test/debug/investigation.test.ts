/**
 * @behavior Delegate codebase investigation to debugger agent
 * @acceptance-criteria AC-DBG-002
 * @boundary Agent Delegation
 */

import { describe, it, expect } from 'vitest';
import {
  createInvestigationTask,
  parseInvestigationResult,
} from '../../src/debug/investigation.js';
import type { ParsedBug } from '../../src/debug/bug-parser.js';

describe('Investigation - Agent Delegation', () => {
  const mockBug: ParsedBug = {
    type: 'error',
    errorType: 'TypeError',
    message: "Cannot read property 'id'",
    component: 'login',
  };

  /**
   * @behavior Create investigation task for debugger agent
   * @acceptance-criteria DBG-002
   */
  it('should create investigation task for debugger agent', () => {
    const result = createInvestigationTask(mockBug);

    expect(result.subagent_type).toBe('debugger');
    expect(result.prompt).toContain('TypeError');
    expect(result.prompt).toContain('login');
  });

  /**
   * @behavior Include relevant context in task prompt
   * @acceptance-criteria DBG-002
   */
  it('should include relevant context in task prompt', () => {
    const bugWithStack: ParsedBug = {
      ...mockBug,
      message: "Cannot read property 'id'",
    };

    const result = createInvestigationTask(bugWithStack);

    expect(result.prompt).toContain('TypeError');
    expect(result.prompt).toContain("Cannot read property 'id'");
    expect(result.prompt).toContain('login');
  });

  /**
   * @behavior Parse investigation results into root causes
   * @acceptance-criteria DBG-002
   */
  it('should parse investigation results into root causes', () => {
    const agentOutput = `
Root Cause 1: Missing null check in auth/login.ts:42
Evidence: Variable 'user' can be null but not checked

Root Cause 2: Invalid data passed from form
Evidence: Form validation skipped for apostrophes
`;

    const result = parseInvestigationResult(agentOutput);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      cause: 'Missing null check in auth/login.ts:42',
      evidence: "Variable 'user' can be null but not checked",
    });
    expect(result[1]).toEqual({
      cause: 'Invalid data passed from form',
      evidence: 'Form validation skipped for apostrophes',
    });
  });
});
