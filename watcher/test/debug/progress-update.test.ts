/**
 * Progress Update Tests
 *
 * @behavior Updates PROGRESS.md with fix tasks
 * @acceptance-criteria AC-DBG-008
 * @business-rule Maintain progress tracking compatibility
 * @boundary Documentation
 */

import { describe, it, expect } from 'vitest';
import {
  appendFixTasks,
  createProgressContent,
} from '../../src/debug/progress-update.js';
import type { FixTask } from '../../src/debug/progress-update.js';

describe('appendFixTasks', () => {
  const mockTasks: FixTask[] = [
    { id: 1, description: 'Write test that reproduces bug', phase: 'green' },
    { id: 2, description: 'Implement minimal fix', phase: 'green' },
    { id: 3, description: 'Clean up code', phase: 'refactor' },
  ];

  /**
   * @behavior Appends fix tasks to existing PROGRESS.md
   * @acceptance-criteria AC-DBG-008
   */
  it('should append fix tasks to existing PROGRESS.md', () => {
    const existingContent = `# Progress: Auth Feature

## Current Phase: build

## Tasks
- [x] Task 1: Setup auth module (completed 2025-12-10)
- [ ] Task 2: Add login tests

## Last Updated: 2025-12-10 12:00
`;

    const result = appendFixTasks(existingContent, mockTasks);

    expect(result).toContain('Task 1: Setup auth module');
    expect(result).toContain('Task 2: Add login tests');
    expect(result).toContain('Task 3: Write test that reproduces bug');
    expect(result).toContain('Task 4: Implement minimal fix');
    expect(result).toContain('Task 5: Clean up code');
  });

  /**
   * @behavior Creates PROGRESS.md content if none exists
   * @acceptance-criteria AC-DBG-008
   */
  it('should create PROGRESS.md content if none exists', () => {
    const result = createProgressContent(mockTasks, 'Bug Fix: Auth Error');

    expect(result).toContain('# Progress: Bug Fix: Auth Error');
    expect(result).toContain('## Current Phase: debug');
    expect(result).toContain('## Tasks');
    expect(result).toContain('- [ ] Task 1: Write test that reproduces bug');
  });

  /**
   * @behavior Uses same format as /oss:plan tasks
   * @acceptance-criteria AC-DBG-008
   */
  it('should use same format as /oss:plan tasks', () => {
    const result = createProgressContent(mockTasks, 'Bug Fix');

    // Verify format: - [ ] Task N: Description
    expect(result).toMatch(/- \[ \] Task \d+: .+/);
    expect(result).toContain('## Last Updated:');
  });
});
