/**
 * @file Standard Benchmark Tasks
 * @description Pre-defined benchmark tasks for evaluating model quality
 */

import { BenchmarkTask } from './types.js';
import { BenchmarkTaskRegistry } from './task-registry.js';

/**
 * Code Review Task
 * Tests the model's ability to identify issues in code
 */
export const CODE_REVIEW_TASK: BenchmarkTask = {
  id: 'code-review-01',
  name: 'Review function for issues',
  category: 'code-review',
  prompt: `Review this function and identify issues:
function processData(data) {
  for (var i = 0; i < data.length; i++) {
    console.log(data[i])
    if (data[i] == null) continue
    results.push(data[i] * 2)
  }
  return results
}`,
  expectedBehavior: [
    'undeclared variable',
    'var instead of const/let',
    'console.log',
    '== instead of ===',
  ],
  timeout: 30000,
};

/**
 * Bug Fix Task
 * Tests the model's ability to identify and fix bugs
 */
export const BUG_FIX_TASK: BenchmarkTask = {
  id: 'bug-fix-01',
  name: 'Fix off-by-one error',
  category: 'bug-fix',
  prompt: `Fix the bug:
function getLastNItems(arr, n) {
  return arr.slice(arr.length - n - 1);
}
// Expected: getLastNItems([1,2,3,4,5], 2) => [4, 5]
// Actual: getLastNItems([1,2,3,4,5], 2) => [3, 4, 5]`,
  expectedBehavior: ['slice(arr.length - n)', 'remove the - 1'],
  timeout: 30000,
};

/**
 * Test Writing Task
 * Tests the model's ability to write comprehensive tests
 */
export const TEST_WRITING_TASK: BenchmarkTask = {
  id: 'test-writing-01',
  name: 'Write tests for add function',
  category: 'test-writing',
  prompt: `Write unit tests for:
function add(a: number, b: number): number {
  return a + b;
}`,
  expectedBehavior: ['positive numbers', 'negative numbers', 'zero', 'decimal'],
  timeout: 30000,
};

/**
 * Refactoring Task
 * Tests the model's ability to improve code structure
 */
export const REFACTORING_TASK: BenchmarkTask = {
  id: 'refactor-01',
  name: 'Extract method from complex function',
  category: 'refactoring',
  prompt: `Refactor for readability:
function processUser(user) {
  if (!user.email || !user.email.includes('@')) return false;
  if (user.age < 18) return false;
  const hash = crypto.createHash('sha256').update(user.password).digest('hex');
  db.save({ ...user, password: hash });
  return true;
}`,
  expectedBehavior: ['extract validation', 'extract hashing', 'single responsibility'],
  timeout: 30000,
};

/**
 * All standard tasks as an array
 */
export const STANDARD_TASKS: BenchmarkTask[] = [
  CODE_REVIEW_TASK,
  BUG_FIX_TASK,
  TEST_WRITING_TASK,
  REFACTORING_TASK,
];

/**
 * Create a registry pre-populated with standard tasks
 */
export function createStandardRegistry(): BenchmarkTaskRegistry {
  const registry = new BenchmarkTaskRegistry();
  for (const task of STANDARD_TASKS) {
    registry.register(task);
  }
  return registry;
}
