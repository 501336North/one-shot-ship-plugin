/**
 * Documentation Generator Tests
 *
 * @behavior Generates DEBUG.md from investigation results
 * @acceptance-criteria AC-DBG-007
 * @business-rule Generate comprehensive debug documentation
 * @boundary Documentation
 */

import { describe, it, expect } from 'vitest';
import { generateDebugDoc } from '../../src/debug/documentation.js';
import type { ConfirmedBug } from '../../src/debug/reproduction.js';

describe('generateDebugDoc', () => {
  const mockBug: ConfirmedBug = {
    type: 'error',
    errorType: 'TypeError',
    message: "Cannot read property 'id'",
    component: 'auth',
    file: 'src/auth.ts',
    rootCause: {
      cause: 'Null reference in authentication flow',
      evidence: 'User object is undefined before access',
    },
    severity: 'high',
  };

  /**
   * @behavior Generates valid markdown document
   * @acceptance-criteria AC-DBG-007
   */
  it('should generate DEBUG.md from investigation results', () => {
    const result = generateDebugDoc({
      bug: mockBug,
      testPath: 'test/auth/bug-123.test.ts',
      investigation: 'Investigated auth flow, found null reference',
    });

    expect(result).toContain('# Debug Report');
    expect(result).toContain('## Bug Report');
    expect(result).toContain('TypeError');
    expect(result).toContain("Cannot read property 'id'");
  });

  /**
   * @behavior Includes all required sections
   * @acceptance-criteria AC-DBG-007
   */
  it('should include all required sections', () => {
    const result = generateDebugDoc({
      bug: mockBug,
      testPath: 'test/auth/bug-123.test.ts',
      investigation: 'Full investigation details',
    });

    expect(result).toContain('## Bug Report');
    expect(result).toContain('## Investigation');
    expect(result).toContain('## Root Cause Analysis');
    expect(result).toContain('## Reproduction Test');
    expect(result).toContain('## TDD Fix Plan');
  });

  /**
   * @behavior Includes verification checklist
   * @acceptance-criteria AC-DBG-007
   */
  it('should include verification checklist', () => {
    const result = generateDebugDoc({
      bug: mockBug,
      testPath: 'test/auth/bug-123.test.ts',
      investigation: 'Investigation notes',
    });

    expect(result).toContain('## Verification Checklist');
    expect(result).toContain('- [ ] Test fails');
    expect(result).toContain('- [ ] Root cause verified');
    expect(result).toContain('- [ ] Fix approach documented');
  });
});
