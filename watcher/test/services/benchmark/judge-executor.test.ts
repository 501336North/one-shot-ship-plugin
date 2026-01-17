/**
 * @file Judge Executor Tests
 * @description Tests for the JudgeExecutor that orchestrates quality judging
 *
 * @behavior JudgeExecutor judges all comparison pairs and calculates averages
 * @acceptance-criteria AC-JUDGE-EXEC.1 through AC-JUDGE-EXEC.3
 */

import { describe, it, expect, vi } from 'vitest';
import {
  JudgeExecutor,
  JudgeResults,
  TaskJudgeResult,
} from '../../../src/services/benchmark/judge-executor.js';
import {
  QualityJudge,
  JudgeScore,
  JudgeResult,
} from '../../../src/services/benchmark/quality-judge.js';
import type { ComparisonResult } from '../../../src/services/benchmark/comparison-executor.js';
import type { ComparisonTask } from '../../../src/services/benchmark/comparison-tasks.js';

describe('Judge Executor', () => {
  // Helper to create comparison results
  const createComparisonResult = (
    taskId: string,
    baselineResponse: string,
    challengerResponse: string
  ): ComparisonResult => ({
    taskId,
    baseline: {
      taskId,
      response: baselineResponse,
      estimatedTokens: Math.ceil(baselineResponse.length / 4),
      timestamp: '2026-01-17T12:00:00Z',
    },
    challenger: {
      taskId,
      response: challengerResponse,
      inputTokens: 50,
      outputTokens: 30,
      latencyMs: 100,
    },
    tokenRatio: 0.5,
  });

  // Helper to create tasks
  const createTask = (id: string): ComparisonTask => ({
    id,
    name: `Task ${id}`,
    category: 'code-review',
    codeSnippet: 'const x = 1;',
    prompt: 'Review this code.',
  });

  // Helper to create a mock judge with configurable scores
  const createMockJudge = (
    scoresByTaskId: Map<string, JudgeScore>
  ): QualityJudge => {
    const mockScorer = vi.fn(async (baseline, challenger, task): Promise<JudgeScore> => {
      const scores = scoresByTaskId.get(task.id);
      if (!scores) {
        return {
          correctness: 50,
          completeness: 50,
          explanation: 50,
          codeQuality: 50,
        };
      }
      return scores;
    });
    return new QualityJudge(mockScorer);
  };

  /**
   * @behavior JudgeExecutor judges all comparison pairs
   * @acceptance-criteria AC-JUDGE-EXEC.1
   */
  it('should judge all comparison pairs', async () => {
    // GIVEN 3 comparison results
    const comparisons: ComparisonResult[] = [
      createComparisonResult('task-01', 'Baseline 1', 'Challenger 1'),
      createComparisonResult('task-02', 'Baseline 2', 'Challenger 2'),
      createComparisonResult('task-03', 'Baseline 3', 'Challenger 3'),
    ];

    const tasks: ComparisonTask[] = [
      createTask('task-01'),
      createTask('task-02'),
      createTask('task-03'),
    ];

    // AND a mock judge returning different scores for each
    const scoresByTaskId = new Map<string, JudgeScore>([
      ['task-01', { correctness: 80, completeness: 70, explanation: 75, codeQuality: 65 }],
      ['task-02', { correctness: 90, completeness: 85, explanation: 80, codeQuality: 75 }],
      ['task-03', { correctness: 60, completeness: 55, explanation: 50, codeQuality: 45 }],
    ]);
    const judge = createMockJudge(scoresByTaskId);

    // WHEN executing the judge
    const executor = new JudgeExecutor();
    const results = await executor.judgeAll(comparisons, tasks, judge);

    // THEN all 3 comparisons should have been judged
    expect(results.taskResults.length).toBe(3);

    const task01Result = results.taskResults.find((r) => r.taskId === 'task-01');
    const task02Result = results.taskResults.find((r) => r.taskId === 'task-02');
    const task03Result = results.taskResults.find((r) => r.taskId === 'task-03');

    expect(task01Result).toBeDefined();
    expect(task02Result).toBeDefined();
    expect(task03Result).toBeDefined();
  });

  /**
   * @behavior JudgeExecutor stores individual scores per task
   * @acceptance-criteria AC-JUDGE-EXEC.2
   */
  it('should store individual scores per task', async () => {
    // GIVEN a comparison result
    const comparisons: ComparisonResult[] = [
      createComparisonResult('task-individual', 'Baseline', 'Challenger'),
    ];

    const tasks: ComparisonTask[] = [createTask('task-individual')];

    // AND a judge with specific scores
    const scoresByTaskId = new Map<string, JudgeScore>([
      [
        'task-individual',
        {
          correctness: 85,
          completeness: 75,
          explanation: 90,
          codeQuality: 80,
          reasoning: {
            correctness: 'Good identification.',
            completeness: 'Covered most cases.',
            explanation: 'Clear explanation.',
            codeQuality: 'Well-written code.',
          },
        },
      ],
    ]);
    const judge = createMockJudge(scoresByTaskId);

    // WHEN executing the judge
    const executor = new JudgeExecutor();
    const results = await executor.judgeAll(comparisons, tasks, judge);

    // THEN the task result should have individual scores
    const taskResult = results.taskResults[0];
    expect(taskResult.taskId).toBe('task-individual');
    expect(taskResult.judgeResult.scores.correctness).toBe(85);
    expect(taskResult.judgeResult.scores.completeness).toBe(75);
    expect(taskResult.judgeResult.scores.explanation).toBe(90);
    expect(taskResult.judgeResult.scores.codeQuality).toBe(80);

    // AND reasoning should be present
    expect(taskResult.judgeResult.reasoning.correctness).toBe('Good identification.');
  });

  /**
   * @behavior JudgeExecutor calculates average quality score across all tasks
   * @acceptance-criteria AC-JUDGE-EXEC.3
   */
  it('should calculate average quality score across all tasks', async () => {
    // GIVEN 3 comparisons with known weighted scores
    const comparisons: ComparisonResult[] = [
      createComparisonResult('task-avg-01', 'B1', 'C1'),
      createComparisonResult('task-avg-02', 'B2', 'C2'),
      createComparisonResult('task-avg-03', 'B3', 'C3'),
    ];

    const tasks: ComparisonTask[] = [
      createTask('task-avg-01'),
      createTask('task-avg-02'),
      createTask('task-avg-03'),
    ];

    // Task 1: (100*0.4)+(100*0.3)+(100*0.15)+(100*0.15) = 100
    // Task 2: (80*0.4)+(60*0.3)+(40*0.15)+(40*0.15) = 32+18+6+6 = 62
    // Task 3: (60*0.4)+(60*0.3)+(60*0.15)+(60*0.15) = 24+18+9+9 = 60
    // Average: (100 + 62 + 60) / 3 = 74
    const scoresByTaskId = new Map<string, JudgeScore>([
      ['task-avg-01', { correctness: 100, completeness: 100, explanation: 100, codeQuality: 100 }],
      ['task-avg-02', { correctness: 80, completeness: 60, explanation: 40, codeQuality: 40 }],
      ['task-avg-03', { correctness: 60, completeness: 60, explanation: 60, codeQuality: 60 }],
    ]);
    const judge = createMockJudge(scoresByTaskId);

    // WHEN executing the judge
    const executor = new JudgeExecutor();
    const results = await executor.judgeAll(comparisons, tasks, judge);

    // THEN average score should be calculated correctly
    expect(results.averageScore).toBeCloseTo(74, 0);
  });

  /**
   * @behavior JudgeExecutor handles empty comparison list
   */
  it('should handle empty comparison list', async () => {
    // GIVEN no comparisons
    const comparisons: ComparisonResult[] = [];
    const tasks: ComparisonTask[] = [];

    const scoresByTaskId = new Map<string, JudgeScore>();
    const judge = createMockJudge(scoresByTaskId);

    // WHEN executing the judge
    const executor = new JudgeExecutor();
    const results = await executor.judgeAll(comparisons, tasks, judge);

    // THEN results should be empty with 0 average
    expect(results.taskResults.length).toBe(0);
    expect(results.averageScore).toBe(0);
  });

  /**
   * @behavior JudgeExecutor handles missing task for comparison
   */
  it('should skip comparisons without matching tasks', async () => {
    // GIVEN a comparison without a matching task
    const comparisons: ComparisonResult[] = [
      createComparisonResult('task-with-task', 'B1', 'C1'),
      createComparisonResult('task-without-task', 'B2', 'C2'),
    ];

    const tasks: ComparisonTask[] = [createTask('task-with-task')];

    const scoresByTaskId = new Map<string, JudgeScore>([
      ['task-with-task', { correctness: 80, completeness: 80, explanation: 80, codeQuality: 80 }],
    ]);
    const judge = createMockJudge(scoresByTaskId);

    // WHEN executing the judge
    const executor = new JudgeExecutor();
    const results = await executor.judgeAll(comparisons, tasks, judge);

    // THEN only the comparison with a matching task should be judged
    expect(results.taskResults.length).toBe(1);
    expect(results.taskResults[0].taskId).toBe('task-with-task');
  });
});
