/**
 * @file Benchmark Task Registry Tests
 * @behavior BenchmarkTaskRegistry manages benchmark task storage and retrieval
 * @acceptance-criteria AC-REGISTRY.1 through AC-REGISTRY.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BenchmarkTaskRegistry } from '../../../src/services/benchmark/task-registry.js';
import { BenchmarkTask } from '../../../src/services/benchmark/types.js';

describe('BenchmarkTaskRegistry', () => {
  let registry: BenchmarkTaskRegistry;

  beforeEach(() => {
    registry = new BenchmarkTaskRegistry();
  });

  describe('register', () => {
    it('should register a benchmark task', () => {
      // GIVEN a benchmark task
      const task: BenchmarkTask = {
        id: 'test-task-01',
        name: 'Test Task',
        category: 'code-review',
        prompt: 'Review this code',
        expectedBehavior: ['identify issues'],
      };

      // WHEN registering the task
      registry.register(task);

      // THEN the task should be retrievable
      const retrieved = registry.getById('test-task-01');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Task');
    });
  });

  describe('getById', () => {
    it('should get task by id', () => {
      // GIVEN a registered task
      const task: BenchmarkTask = {
        id: 'find-me',
        name: 'Findable Task',
        category: 'bug-fix',
        prompt: 'Fix this bug',
        expectedBehavior: ['bug fixed'],
      };
      registry.register(task);

      // WHEN getting by id
      const result = registry.getById('find-me');

      // THEN the correct task should be returned
      expect(result).toBeDefined();
      expect(result?.id).toBe('find-me');
      expect(result?.name).toBe('Findable Task');
      expect(result?.category).toBe('bug-fix');
    });

    it('should return undefined for unknown id', () => {
      // WHEN getting a non-existent task
      const result = registry.getById('non-existent');

      // THEN undefined should be returned
      expect(result).toBeUndefined();
    });
  });

  describe('listByCategory', () => {
    it('should list all tasks by category', () => {
      // GIVEN multiple tasks in different categories
      registry.register({
        id: 'review-1',
        name: 'Review 1',
        category: 'code-review',
        prompt: 'Review code 1',
        expectedBehavior: ['issue 1'],
      });
      registry.register({
        id: 'review-2',
        name: 'Review 2',
        category: 'code-review',
        prompt: 'Review code 2',
        expectedBehavior: ['issue 2'],
      });
      registry.register({
        id: 'bug-1',
        name: 'Bug Fix 1',
        category: 'bug-fix',
        prompt: 'Fix bug 1',
        expectedBehavior: ['fix 1'],
      });

      // WHEN listing by category
      const codeReviewTasks = registry.listByCategory('code-review');
      const bugFixTasks = registry.listByCategory('bug-fix');

      // THEN only tasks in that category should be returned
      expect(codeReviewTasks.length).toBe(2);
      expect(codeReviewTasks.every((t) => t.category === 'code-review')).toBe(true);
      expect(bugFixTasks.length).toBe(1);
      expect(bugFixTasks[0].id).toBe('bug-1');
    });

    it('should return empty array for category with no tasks', () => {
      // WHEN listing a category with no tasks
      const result = registry.listByCategory('refactoring');

      // THEN empty array should be returned
      expect(result).toEqual([]);
    });
  });

  describe('validateTask', () => {
    it('should validate task has expected output pattern', () => {
      // GIVEN a task with expected behaviors
      const task: BenchmarkTask = {
        id: 'validate-me',
        name: 'Validation Task',
        category: 'code-review',
        prompt: 'Review this code',
        expectedBehavior: ['issue identified', 'suggestion provided'],
      };
      registry.register(task);

      // WHEN validating output against expected patterns
      const output = 'I found an issue identified in the code. Here is a suggestion provided for fixing it.';
      const validationResult = registry.validateOutput('validate-me', output);

      // THEN validation should pass with matching patterns
      expect(validationResult.isValid).toBe(true);
      expect(validationResult.matchedPatterns).toContain('issue identified');
      expect(validationResult.matchedPatterns).toContain('suggestion provided');
      expect(validationResult.missingPatterns).toEqual([]);
    });

    it('should report missing patterns in validation', () => {
      // GIVEN a task with expected behaviors
      const task: BenchmarkTask = {
        id: 'partial-match',
        name: 'Partial Match Task',
        category: 'bug-fix',
        prompt: 'Fix the bug',
        expectedBehavior: ['bug identified', 'fix applied', 'test added'],
      };
      registry.register(task);

      // WHEN output only matches some patterns
      const output = 'I found the bug identified and a fix applied.';
      const validationResult = registry.validateOutput('partial-match', output);

      // THEN validation should indicate partial match
      expect(validationResult.isValid).toBe(false);
      expect(validationResult.matchedPatterns).toContain('bug identified');
      expect(validationResult.matchedPatterns).toContain('fix applied');
      expect(validationResult.missingPatterns).toContain('test added');
    });

    it('should throw error for unknown task id in validation', () => {
      // WHEN validating output for unknown task
      // THEN error should be thrown
      expect(() => registry.validateOutput('unknown-task', 'some output')).toThrow(
        'Task not found: unknown-task'
      );
    });
  });

  describe('listAll', () => {
    it('should list all registered tasks', () => {
      // GIVEN multiple registered tasks
      registry.register({
        id: 'task-1',
        name: 'Task 1',
        category: 'code-review',
        prompt: 'Prompt 1',
        expectedBehavior: ['behavior 1'],
      });
      registry.register({
        id: 'task-2',
        name: 'Task 2',
        category: 'bug-fix',
        prompt: 'Prompt 2',
        expectedBehavior: ['behavior 2'],
      });

      // WHEN listing all tasks
      const allTasks = registry.listAll();

      // THEN all tasks should be returned
      expect(allTasks.length).toBe(2);
      expect(allTasks.map((t) => t.id)).toContain('task-1');
      expect(allTasks.map((t) => t.id)).toContain('task-2');
    });
  });
});
