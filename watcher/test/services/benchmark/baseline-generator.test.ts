/**
 * @file Baseline Generator Tests
 * @behavior BaselineGenerator stores Claude's responses as baseline for comparison
 * @acceptance-criteria AC-BASELINE.1 through AC-BASELINE.3
 */

import { describe, it, expect } from 'vitest';
import {
  BaselineGenerator,
  BaselineResponse,
} from '../../../src/services/benchmark/baseline-generator.js';
import type { ComparisonTask } from '../../../src/services/benchmark/comparison-tasks.js';

describe('Baseline Generator', () => {
  /**
   * @behavior BaselineGenerator generates baseline response for a task
   * @acceptance-criteria AC-BASELINE.1
   */
  it('should generate baseline response for a task', () => {
    // GIVEN a baseline generator and a task
    const generator = new BaselineGenerator();
    const task: ComparisonTask = {
      id: 'test-task-01',
      name: 'Test Task',
      category: 'code-review',
      codeSnippet: 'function test() {}',
      prompt: 'Review this code',
    };
    const response = 'This code looks good but could use error handling.';

    // WHEN generating a baseline
    const baseline = generator.generate(task, response);

    // THEN the baseline should contain the task ID and response
    expect(baseline.taskId).toBe('test-task-01');
    expect(baseline.response).toBe(response);
  });

  /**
   * @behavior BaselineGenerator estimates token count from response length (chars/4)
   * @acceptance-criteria AC-BASELINE.2
   */
  it('should estimate token count from response length (chars/4)', () => {
    // GIVEN a baseline generator and a response of known length
    const generator = new BaselineGenerator();
    const task: ComparisonTask = {
      id: 'test-task-02',
      name: 'Token Count Test',
      category: 'bug-fix',
      codeSnippet: 'let x = null; x.foo();',
      prompt: 'Fix the bug',
    };
    // 100 characters = 25 estimated tokens
    const response = 'a'.repeat(100);

    // WHEN generating a baseline
    const baseline = generator.generate(task, response);

    // THEN the estimated tokens should be chars / 4 (rounded up)
    expect(baseline.estimatedTokens).toBe(25);

    // AND a response of 101 chars should round up to 26 tokens
    const baseline2 = generator.generate(task, 'a'.repeat(101));
    expect(baseline2.estimatedTokens).toBe(26);
  });

  /**
   * @behavior BaselineGenerator stores baseline with taskId, response, and tokens
   * @acceptance-criteria AC-BASELINE.3
   */
  it('should store baseline with taskId, response, and tokens', () => {
    // GIVEN a baseline generator and multiple tasks
    const generator = new BaselineGenerator();
    const task1: ComparisonTask = {
      id: 'task-store-01',
      name: 'Store Test 1',
      category: 'test-writing',
      codeSnippet: 'function add(a, b) { return a + b; }',
      prompt: 'Write unit tests',
    };
    const task2: ComparisonTask = {
      id: 'task-store-02',
      name: 'Store Test 2',
      category: 'refactoring',
      codeSnippet: 'if (x) { if (y) { return z; } }',
      prompt: 'Simplify this code',
    };
    const response1 = 'Unit tests for add function...';
    const response2 = 'Simplified: return x && y ? z : undefined;';

    // WHEN generating baselines for both tasks
    const baseline1 = generator.generate(task1, response1);
    const baseline2 = generator.generate(task2, response2);

    // THEN each baseline should have all required fields
    expect(baseline1).toMatchObject({
      taskId: 'task-store-01',
      response: response1,
      estimatedTokens: Math.ceil(response1.length / 4),
    });
    expect(baseline1.timestamp).toBeDefined();
    expect(typeof baseline1.timestamp).toBe('string');

    expect(baseline2).toMatchObject({
      taskId: 'task-store-02',
      response: response2,
      estimatedTokens: Math.ceil(response2.length / 4),
    });
    expect(baseline2.timestamp).toBeDefined();
    expect(typeof baseline2.timestamp).toBe('string');
  });
});
