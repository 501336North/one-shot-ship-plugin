/**
 * @file Comparison Executor Tests
 * @behavior ComparisonExecutor pairs baseline and challenger responses and calculates token ratios
 * @acceptance-criteria AC-COMPARISON-EXEC.1 through AC-COMPARISON-EXEC.3
 */

import { describe, it, expect } from 'vitest';
import {
  ComparisonExecutor,
  ComparisonResult,
} from '../../../src/services/benchmark/comparison-executor.js';
import type { BaselineResponse } from '../../../src/services/benchmark/baseline-generator.js';
import type { ChallengerResponse } from '../../../src/services/benchmark/challenger-runner.js';

describe('Comparison Executor', () => {
  /**
   * @behavior ComparisonExecutor pairs baseline and challenger responses by task ID
   * @acceptance-criteria AC-COMPARISON-EXEC.1
   */
  it('should pair baseline and challenger responses by task ID', () => {
    // GIVEN baselines and challenges with matching task IDs
    const baselines: BaselineResponse[] = [
      {
        taskId: 'task-01',
        response: 'Baseline response for task 1',
        estimatedTokens: 8,
        timestamp: '2026-01-17T12:00:00Z',
      },
      {
        taskId: 'task-02',
        response: 'Baseline response for task 2',
        estimatedTokens: 8,
        timestamp: '2026-01-17T12:00:00Z',
      },
    ];

    const challenges: ChallengerResponse[] = [
      {
        taskId: 'task-02', // Note: different order
        response: 'Challenger response for task 2',
        inputTokens: 50,
        outputTokens: 30,
        latencyMs: 100,
      },
      {
        taskId: 'task-01',
        response: 'Challenger response for task 1',
        inputTokens: 45,
        outputTokens: 25,
        latencyMs: 90,
      },
    ];

    // WHEN executing comparison
    const executor = new ComparisonExecutor();
    const results = executor.execute(baselines, challenges);

    // THEN results should be paired by task ID
    expect(results.length).toBe(2);

    const task01Result = results.find((r) => r.taskId === 'task-01');
    const task02Result = results.find((r) => r.taskId === 'task-02');

    expect(task01Result).toBeDefined();
    expect(task01Result!.baseline.response).toBe('Baseline response for task 1');
    expect(task01Result!.challenger.response).toBe('Challenger response for task 1');

    expect(task02Result).toBeDefined();
    expect(task02Result!.baseline.response).toBe('Baseline response for task 2');
    expect(task02Result!.challenger.response).toBe('Challenger response for task 2');
  });

  /**
   * @behavior ComparisonExecutor calculates token ratio for each pair
   * @acceptance-criteria AC-COMPARISON-EXEC.2
   */
  it('should calculate token ratio for each pair', () => {
    // GIVEN baselines and challenges with known token counts
    const baselines: BaselineResponse[] = [
      {
        taskId: 'task-ratio-01',
        response: 'a'.repeat(400), // 100 estimated tokens
        estimatedTokens: 100,
        timestamp: '2026-01-17T12:00:00Z',
      },
    ];

    const challenges: ChallengerResponse[] = [
      {
        taskId: 'task-ratio-01',
        response: 'Challenger response',
        inputTokens: 50,
        outputTokens: 25, // Total: 75 actual tokens
        latencyMs: 100,
      },
    ];

    // WHEN executing comparison
    const executor = new ComparisonExecutor();
    const results = executor.execute(baselines, challenges);

    // THEN token ratio should be challenger total / baseline estimated
    // Ratio = (50 + 25) / 100 = 0.75 (75%)
    expect(results[0].tokenRatio).toBeCloseTo(0.75, 2);
  });

  /**
   * @behavior ComparisonExecutor returns comparison results for all tasks
   * @acceptance-criteria AC-COMPARISON-EXEC.3
   */
  it('should return comparison results for all tasks', () => {
    // GIVEN 3 baselines and 3 challenges
    const baselines: BaselineResponse[] = [
      {
        taskId: 'task-a',
        response: 'Baseline A',
        estimatedTokens: 50,
        timestamp: '2026-01-17T12:00:00Z',
      },
      {
        taskId: 'task-b',
        response: 'Baseline B',
        estimatedTokens: 60,
        timestamp: '2026-01-17T12:00:00Z',
      },
      {
        taskId: 'task-c',
        response: 'Baseline C',
        estimatedTokens: 70,
        timestamp: '2026-01-17T12:00:00Z',
      },
    ];

    const challenges: ChallengerResponse[] = [
      {
        taskId: 'task-a',
        response: 'Challenge A',
        inputTokens: 20,
        outputTokens: 10,
        latencyMs: 50,
      },
      {
        taskId: 'task-b',
        response: 'Challenge B',
        inputTokens: 25,
        outputTokens: 15,
        latencyMs: 60,
      },
      {
        taskId: 'task-c',
        response: 'Challenge C',
        inputTokens: 30,
        outputTokens: 20,
        latencyMs: 70,
      },
    ];

    // WHEN executing comparison
    const executor = new ComparisonExecutor();
    const results = executor.execute(baselines, challenges);

    // THEN all 3 tasks should have results
    expect(results.length).toBe(3);

    // AND each result should have all required fields
    for (const result of results) {
      expect(result.taskId).toBeDefined();
      expect(result.baseline).toBeDefined();
      expect(result.challenger).toBeDefined();
      expect(result.tokenRatio).toBeDefined();
      expect(typeof result.tokenRatio).toBe('number');
    }

    // AND results should be indexed by task ID
    const taskIds = results.map((r) => r.taskId);
    expect(taskIds).toContain('task-a');
    expect(taskIds).toContain('task-b');
    expect(taskIds).toContain('task-c');
  });

  /**
   * @behavior ComparisonExecutor handles missing challenger responses
   */
  it('should handle missing challenger responses', () => {
    // GIVEN a baseline with no matching challenger
    const baselines: BaselineResponse[] = [
      {
        taskId: 'task-orphan',
        response: 'Orphan baseline',
        estimatedTokens: 50,
        timestamp: '2026-01-17T12:00:00Z',
      },
    ];

    const challenges: ChallengerResponse[] = [];

    // WHEN executing comparison
    const executor = new ComparisonExecutor();
    const results = executor.execute(baselines, challenges);

    // THEN no results should be returned for orphan baselines
    expect(results.length).toBe(0);
  });
});
