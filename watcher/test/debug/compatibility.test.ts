/**
 * Build Compatibility Tests
 *
 * @behavior Ensures output compatible with /oss:build
 * @acceptance-criteria AC-DBG-011
 * @business-rule Build command must execute debug output
 * @boundary Integration
 */

import { describe, it, expect } from 'vitest';
import {
  formatForBuild,
  getCommandChainSuggestion,
} from '../../src/debug/compatibility.js';
import type { FixTask } from '../../src/debug/progress-update.js';

describe('formatForBuild', () => {
  const mockTasks: FixTask[] = [
    { id: 1, description: 'Write failing test', phase: 'green' },
    { id: 2, description: 'Implement minimal fix', phase: 'green' },
    { id: 3, description: 'Clean up code', phase: 'refactor' },
    { id: 4, description: 'Add regression tests', phase: 'regression' },
  ];

  /**
   * @behavior Outputs tasks in build-compatible format
   * @acceptance-criteria AC-DBG-011
   */
  it('should output tasks in build-compatible format', () => {
    const result = formatForBuild(mockTasks);

    expect(result).toHaveProperty('phases');
    expect(Array.isArray(result.phases)).toBe(true);
    expect(result.phases.length).toBeGreaterThan(0);
  });

  /**
   * @behavior Includes phase markers for build navigation
   * @acceptance-criteria AC-DBG-011
   */
  it('should include phase markers for build navigation', () => {
    const result = formatForBuild(mockTasks);

    const phaseNames = result.phases.map((p) => p.name);

    expect(phaseNames).toContain('green');
    expect(phaseNames).toContain('refactor');
    expect(phaseNames).toContain('regression');
  });

  /**
   * @behavior Groups tasks by phase
   * @acceptance-criteria AC-DBG-011
   */
  it('should group tasks by phase', () => {
    const result = formatForBuild(mockTasks);

    const greenPhase = result.phases.find((p) => p.name === 'green');
    const refactorPhase = result.phases.find((p) => p.name === 'refactor');

    expect(greenPhase?.tasks.length).toBe(2);
    expect(refactorPhase?.tasks.length).toBe(1);
  });
});

describe('getCommandChainSuggestion', () => {
  /**
   * @behavior Generates valid command chain suggestion
   * @acceptance-criteria AC-DBG-011
   */
  it('should generate valid command chain suggestion', () => {
    const result = getCommandChainSuggestion();

    expect(result).toContain('/oss:build');
    expect(result).toContain('when ready');
  });
});
