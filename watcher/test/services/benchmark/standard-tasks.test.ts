/**
 * @file Standard Benchmark Tasks Tests
 * @behavior Standard tasks provide reusable benchmark cases for model evaluation
 * @acceptance-criteria AC-STANDARD.1 through AC-STANDARD.4
 */

import { describe, it, expect } from 'vitest';
import {
  STANDARD_TASKS,
  CODE_REVIEW_TASK,
  BUG_FIX_TASK,
  TEST_WRITING_TASK,
  REFACTORING_TASK,
  createStandardRegistry,
} from '../../../src/services/benchmark/standard-tasks.js';
import { BenchmarkTask } from '../../../src/services/benchmark/types.js';

describe('Standard benchmark tasks', () => {
  describe('CODE_REVIEW_TASK', () => {
    it('should include code-review task with sample code and expected issues', () => {
      // GIVEN the code review task
      const task: BenchmarkTask = CODE_REVIEW_TASK;

      // THEN it should have correct structure
      expect(task.id).toBe('code-review-01');
      expect(task.name).toBe('Review function for issues');
      expect(task.category).toBe('code-review');

      // AND the prompt should contain sample code to review
      expect(task.prompt).toContain('function processData');
      expect(task.prompt).toContain('var i = 0');
      expect(task.prompt).toContain('console.log');

      // AND expected behaviors should identify common issues
      expect(task.expectedBehavior.length).toBeGreaterThanOrEqual(3);
      expect(task.expectedBehavior.some((b) => b.toLowerCase().includes('undeclared') || b.toLowerCase().includes('results'))).toBe(true);
      expect(task.expectedBehavior.some((b) => b.toLowerCase().includes('var'))).toBe(true);
      expect(task.expectedBehavior.some((b) => b.toLowerCase().includes('console'))).toBe(true);
    });
  });

  describe('BUG_FIX_TASK', () => {
    it('should include bug-fix task with buggy code and expected fix', () => {
      // GIVEN the bug fix task
      const task: BenchmarkTask = BUG_FIX_TASK;

      // THEN it should have correct structure
      expect(task.id).toBe('bug-fix-01');
      expect(task.name).toBe('Fix off-by-one error');
      expect(task.category).toBe('bug-fix');

      // AND the prompt should contain buggy code
      expect(task.prompt).toContain('getLastNItems');
      expect(task.prompt).toContain('slice');
      expect(task.prompt).toContain('- n - 1');

      // AND expected/actual behavior should be documented
      expect(task.prompt).toContain('Expected');
      expect(task.prompt).toContain('Actual');

      // AND expected behaviors should identify the fix
      expect(task.expectedBehavior.length).toBeGreaterThanOrEqual(1);
      expect(task.expectedBehavior.some((b) =>
        b.toLowerCase().includes('remove') ||
        b.toLowerCase().includes('- n)') ||
        b.toLowerCase().includes('length - n')
      )).toBe(true);
    });
  });

  describe('TEST_WRITING_TASK', () => {
    it('should include test-writing task with function and expected test', () => {
      // GIVEN the test writing task
      const task: BenchmarkTask = TEST_WRITING_TASK;

      // THEN it should have correct structure
      expect(task.id).toBe('test-writing-01');
      expect(task.name).toBe('Write tests for add function');
      expect(task.category).toBe('test-writing');

      // AND the prompt should contain a function to test
      expect(task.prompt).toContain('function add');
      expect(task.prompt).toContain('number');
      expect(task.prompt).toContain('return a + b');

      // AND expected behaviors should identify test cases
      expect(task.expectedBehavior.length).toBeGreaterThanOrEqual(3);
      expect(task.expectedBehavior.some((b) => b.toLowerCase().includes('positive'))).toBe(true);
      expect(task.expectedBehavior.some((b) => b.toLowerCase().includes('negative'))).toBe(true);
      expect(task.expectedBehavior.some((b) => b.toLowerCase().includes('zero'))).toBe(true);
    });
  });

  describe('REFACTORING_TASK', () => {
    it('should include refactoring task with messy code and expected clean version', () => {
      // GIVEN the refactoring task
      const task: BenchmarkTask = REFACTORING_TASK;

      // THEN it should have correct structure
      expect(task.id).toBe('refactor-01');
      expect(task.name).toBe('Extract method from complex function');
      expect(task.category).toBe('refactoring');

      // AND the prompt should contain messy code
      expect(task.prompt).toContain('processUser');
      expect(task.prompt).toContain('email');
      expect(task.prompt).toContain('crypto');
      expect(task.prompt).toContain('db.save');

      // AND expected behaviors should identify refactoring actions
      expect(task.expectedBehavior.length).toBeGreaterThanOrEqual(2);
      expect(task.expectedBehavior.some((b) =>
        b.toLowerCase().includes('extract') ||
        b.toLowerCase().includes('validation')
      )).toBe(true);
      expect(task.expectedBehavior.some((b) =>
        b.toLowerCase().includes('responsibility') ||
        b.toLowerCase().includes('hash')
      )).toBe(true);
    });
  });

  describe('STANDARD_TASKS array', () => {
    it('should contain all four standard tasks', () => {
      // THEN standard tasks should include all task types
      expect(STANDARD_TASKS.length).toBe(4);
      expect(STANDARD_TASKS.find((t) => t.category === 'code-review')).toBeDefined();
      expect(STANDARD_TASKS.find((t) => t.category === 'bug-fix')).toBeDefined();
      expect(STANDARD_TASKS.find((t) => t.category === 'test-writing')).toBeDefined();
      expect(STANDARD_TASKS.find((t) => t.category === 'refactoring')).toBeDefined();
    });
  });

  describe('createStandardRegistry', () => {
    it('should create a registry pre-populated with standard tasks', () => {
      // WHEN creating a standard registry
      const registry = createStandardRegistry();

      // THEN all standard tasks should be registered
      expect(registry.getById('code-review-01')).toBeDefined();
      expect(registry.getById('bug-fix-01')).toBeDefined();
      expect(registry.getById('test-writing-01')).toBeDefined();
      expect(registry.getById('refactor-01')).toBeDefined();

      // AND listing all should return 4 tasks
      expect(registry.listAll().length).toBe(4);
    });
  });
});
