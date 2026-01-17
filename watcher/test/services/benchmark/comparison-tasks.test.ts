/**
 * @file Comparison Task Registry Tests
 * @behavior Comparison tasks provide structured code snippets and prompts for model evaluation
 * @acceptance-criteria AC-COMPARISON.1 through AC-COMPARISON.6
 */

import { describe, it, expect } from 'vitest';
import {
  COMPARISON_TASKS,
  ComparisonTask,
  ComparisonTaskCategory,
  validateComparisonTask,
} from '../../../src/services/benchmark/comparison-tasks.js';

describe('Comparison Task Registry', () => {
  /**
   * @behavior The registry defines 12 tasks across 4 categories for comprehensive model comparison
   * @acceptance-criteria AC-COMPARISON.1
   */
  it('should define 12 tasks across 4 categories', () => {
    // GIVEN the comparison tasks registry
    const tasks = COMPARISON_TASKS;

    // THEN it should contain exactly 12 tasks
    expect(tasks.length).toBe(12);

    // AND tasks should span all 4 categories
    const categories = new Set(tasks.map((t) => t.category));
    expect(categories.size).toBe(4);
    expect(categories.has('code-review')).toBe(true);
    expect(categories.has('bug-fix')).toBe(true);
    expect(categories.has('test-writing')).toBe(true);
    expect(categories.has('refactoring')).toBe(true);
  });

  /**
   * @behavior Each task includes code snippet and prompt for model evaluation
   * @acceptance-criteria AC-COMPARISON.2
   */
  it('should include code snippet and prompt for each task', () => {
    // GIVEN all comparison tasks
    const tasks = COMPARISON_TASKS;

    // THEN each task should have required fields
    for (const task of tasks) {
      expect(task.id).toBeDefined();
      expect(typeof task.id).toBe('string');
      expect(task.id.length).toBeGreaterThan(0);

      expect(task.name).toBeDefined();
      expect(typeof task.name).toBe('string');
      expect(task.name.length).toBeGreaterThan(0);

      expect(task.category).toBeDefined();
      expect(['code-review', 'bug-fix', 'test-writing', 'refactoring']).toContain(task.category);

      expect(task.codeSnippet).toBeDefined();
      expect(typeof task.codeSnippet).toBe('string');
      expect(task.codeSnippet.length).toBeGreaterThan(0);

      expect(task.prompt).toBeDefined();
      expect(typeof task.prompt).toBe('string');
      expect(task.prompt.length).toBeGreaterThan(0);
    }
  });

  /**
   * @behavior Tasks are categorized into code-review, bug-fix, test-writing, refactoring
   * @acceptance-criteria AC-COMPARISON.3
   */
  it('should categorize tasks as code-review, bug-fix, test-writing, refactoring', () => {
    // GIVEN all comparison tasks
    const tasks = COMPARISON_TASKS;

    // WHEN grouping by category
    const byCategory = tasks.reduce(
      (acc, task) => {
        if (!acc[task.category]) {
          acc[task.category] = [];
        }
        acc[task.category].push(task);
        return acc;
      },
      {} as Record<ComparisonTaskCategory, ComparisonTask[]>
    );

    // THEN each category should exist
    expect(byCategory['code-review']).toBeDefined();
    expect(byCategory['bug-fix']).toBeDefined();
    expect(byCategory['test-writing']).toBeDefined();
    expect(byCategory['refactoring']).toBeDefined();
  });
});

describe('Task Validation', () => {
  /**
   * @behavior Validation ensures tasks have all required fields
   * @acceptance-criteria AC-COMPARISON.4
   */
  it('should validate task has required fields', () => {
    // GIVEN a valid task
    const validTask: ComparisonTask = {
      id: 'test-task-01',
      name: 'Test Task',
      category: 'code-review',
      codeSnippet: 'function test() {}',
      prompt: 'Review this code',
    };

    // THEN validation should pass
    expect(validateComparisonTask(validTask)).toBe(true);

    // GIVEN an invalid task missing id
    const missingId = { ...validTask, id: '' };
    expect(validateComparisonTask(missingId as ComparisonTask)).toBe(false);

    // GIVEN an invalid task missing name
    const missingName = { ...validTask, name: '' };
    expect(validateComparisonTask(missingName as ComparisonTask)).toBe(false);

    // GIVEN an invalid task missing codeSnippet
    const missingSnippet = { ...validTask, codeSnippet: '' };
    expect(validateComparisonTask(missingSnippet as ComparisonTask)).toBe(false);

    // GIVEN an invalid task missing prompt
    const missingPrompt = { ...validTask, prompt: '' };
    expect(validateComparisonTask(missingPrompt as ComparisonTask)).toBe(false);
  });

  /**
   * @behavior Each category has exactly 3 tasks
   * @acceptance-criteria AC-COMPARISON.5
   */
  it('should have 3 tasks per category', () => {
    // GIVEN all comparison tasks
    const tasks = COMPARISON_TASKS;

    // WHEN counting tasks per category
    const codeReviewCount = tasks.filter((t) => t.category === 'code-review').length;
    const bugFixCount = tasks.filter((t) => t.category === 'bug-fix').length;
    const testWritingCount = tasks.filter((t) => t.category === 'test-writing').length;
    const refactoringCount = tasks.filter((t) => t.category === 'refactoring').length;

    // THEN each category should have exactly 3 tasks
    expect(codeReviewCount).toBe(3);
    expect(bugFixCount).toBe(3);
    expect(testWritingCount).toBe(3);
    expect(refactoringCount).toBe(3);
  });

  /**
   * @behavior Task IDs must be unique
   * @acceptance-criteria AC-COMPARISON.6
   */
  it('should have unique task IDs', () => {
    // GIVEN all comparison tasks
    const tasks = COMPARISON_TASKS;

    // WHEN collecting all IDs
    const ids = tasks.map((t) => t.id);
    const uniqueIds = new Set(ids);

    // THEN all IDs should be unique
    expect(uniqueIds.size).toBe(ids.length);
  });
});
