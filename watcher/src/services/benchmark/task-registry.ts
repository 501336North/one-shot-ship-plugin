/**
 * @file Benchmark Task Registry
 * @description Registry for managing benchmark task definitions
 */

import { BenchmarkTask, TaskCategory } from './types.js';

/**
 * Result of validating output against expected patterns
 */
export interface ValidationResult {
  /** Whether all expected patterns were found */
  isValid: boolean;
  /** Patterns that were found in the output */
  matchedPatterns: string[];
  /** Patterns that were NOT found in the output */
  missingPatterns: string[];
}

/**
 * Registry for storing and retrieving benchmark tasks
 */
export class BenchmarkTaskRegistry {
  private tasks: Map<string, BenchmarkTask> = new Map();

  /**
   * Register a benchmark task
   */
  register(task: BenchmarkTask): void {
    this.tasks.set(task.id, task);
  }

  /**
   * Get a task by its ID
   */
  getById(id: string): BenchmarkTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * List all tasks in a specific category
   */
  listByCategory(category: TaskCategory): BenchmarkTask[] {
    return Array.from(this.tasks.values()).filter((task) => task.category === category);
  }

  /**
   * List all registered tasks
   */
  listAll(): BenchmarkTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Validate output against a task's expected behavior patterns
   * @throws Error if task not found
   */
  validateOutput(taskId: string, output: string): ValidationResult {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const matchedPatterns: string[] = [];
    const missingPatterns: string[] = [];

    for (const pattern of task.expectedBehavior) {
      if (output.toLowerCase().includes(pattern.toLowerCase())) {
        matchedPatterns.push(pattern);
      } else {
        missingPatterns.push(pattern);
      }
    }

    return {
      isValid: missingPatterns.length === 0,
      matchedPatterns,
      missingPatterns,
    };
  }
}
