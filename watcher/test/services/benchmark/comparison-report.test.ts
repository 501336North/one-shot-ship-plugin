/**
 * @file Comparison Report Generator Tests
 * @description Tests for generating markdown reports from model comparison results
 *
 * @behavior ComparisonReportGenerator generates markdown reports with verdict and task breakdown
 * @acceptance-criteria AC-COMPARISON-REPORT.1 through AC-COMPARISON-REPORT.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ComparisonReportGenerator,
} from '../../../src/services/benchmark/comparison-report.js';
import type { ClaimValidationResult } from '../../../src/services/benchmark/comparison-claim-validator.js';
import type { JudgeResults, TaskJudgeResult } from '../../../src/services/benchmark/judge-executor.js';
import type { ComparisonResult } from '../../../src/services/benchmark/comparison-executor.js';
import type { ComparisonTask } from '../../../src/services/benchmark/comparison-tasks.js';

describe('Comparison Report Generator', () => {
  // Helper to create a verdict result
  const createVerdict = (
    verdict: 'CLAIM_VALIDATED' | 'CLAIM_NOT_VALIDATED',
    avgQuality: number,
    avgTokenRatio: number
  ): ClaimValidationResult => ({
    verdict,
    avgQuality,
    avgTokenRatio,
  });

  // Helper to create judge results
  const createJudgeResults = (taskScores: Array<{ taskId: string; weightedScore: number }>): JudgeResults => {
    const taskResults: TaskJudgeResult[] = taskScores.map(({ taskId, weightedScore }) => ({
      taskId,
      judgeResult: {
        scores: {
          correctness: weightedScore,
          completeness: weightedScore,
          explanation: weightedScore,
          codeQuality: weightedScore,
        },
        weightedScore,
        reasoning: {
          correctness: 'Test reasoning',
          completeness: 'Test reasoning',
          explanation: 'Test reasoning',
          codeQuality: 'Test reasoning',
        },
      },
    }));

    const averageScore = taskScores.reduce((a, b) => a + b.weightedScore, 0) / taskScores.length;

    return {
      taskResults,
      averageScore,
    };
  };

  // Helper to create comparison results
  const createComparisonResults = (
    taskData: Array<{ taskId: string; tokenRatio: number; inputTokens: number; outputTokens: number }>
  ): ComparisonResult[] => {
    return taskData.map(({ taskId, tokenRatio, inputTokens, outputTokens }) => ({
      taskId,
      baseline: {
        taskId,
        response: 'Baseline response',
        estimatedTokens: Math.round((inputTokens + outputTokens) / tokenRatio),
        timestamp: '2026-01-17T12:00:00Z',
      },
      challenger: {
        taskId,
        response: 'Challenger response',
        inputTokens,
        outputTokens,
        latencyMs: 100,
      },
      tokenRatio,
    }));
  };

  // Helper to create tasks
  const createTasks = (taskData: Array<{ id: string; name: string; category: string }>): ComparisonTask[] => {
    return taskData.map(({ id, name, category }) => ({
      id,
      name,
      category: category as 'code-review' | 'bug-fix' | 'test-writing' | 'refactoring',
      codeSnippet: 'const x = 1;',
      prompt: 'Review this code.',
    }));
  };

  /**
   * @behavior ComparisonReportGenerator generates markdown report with verdict
   * @acceptance-criteria AC-COMPARISON-REPORT.1
   */
  it('should generate markdown report with verdict', () => {
    // GIVEN a CLAIM_VALIDATED verdict
    const verdict = createVerdict('CLAIM_VALIDATED', 96.5, 0.22);
    const judgeResults = createJudgeResults([
      { taskId: 'task-1', weightedScore: 96.5 },
    ]);
    const comparisons = createComparisonResults([
      { taskId: 'task-1', tokenRatio: 0.22, inputTokens: 20, outputTokens: 24 },
    ]);
    const tasks = createTasks([
      { id: 'task-1', name: 'Test Task 1', category: 'code-review' },
    ]);

    // WHEN generating the report
    const generator = new ComparisonReportGenerator();
    const report = generator.generate(verdict, judgeResults, comparisons, tasks);

    // THEN the report should include the verdict
    expect(report).toContain('# Model Comparison Report');
    expect(report).toContain('CLAIM_VALIDATED');
    expect(report).toContain('96.5');
    expect(report).toContain('22'); // 22% token usage
  });

  /**
   * @behavior ComparisonReportGenerator includes per-task breakdown with scores
   * @acceptance-criteria AC-COMPARISON-REPORT.2
   */
  it('should include per-task breakdown with scores', () => {
    // GIVEN multiple tasks with different scores
    const verdict = createVerdict('CLAIM_NOT_VALIDATED', 92, 0.30);
    const judgeResults = createJudgeResults([
      { taskId: 'cr-01', weightedScore: 95 },
      { taskId: 'bf-01', weightedScore: 89 },
    ]);
    const comparisons = createComparisonResults([
      { taskId: 'cr-01', tokenRatio: 0.25, inputTokens: 25, outputTokens: 25 },
      { taskId: 'bf-01', tokenRatio: 0.35, inputTokens: 35, outputTokens: 35 },
    ]);
    const tasks = createTasks([
      { id: 'cr-01', name: 'Off-by-one loop error', category: 'code-review' },
      { id: 'bf-01', name: 'Missing null check', category: 'bug-fix' },
    ]);

    // WHEN generating the report
    const generator = new ComparisonReportGenerator();
    const report = generator.generate(verdict, judgeResults, comparisons, tasks);

    // THEN the report should include per-task breakdown
    expect(report).toContain('cr-01');
    expect(report).toContain('Off-by-one loop error');
    expect(report).toContain('95'); // score for cr-01
    expect(report).toContain('bf-01');
    expect(report).toContain('Missing null check');
    expect(report).toContain('89'); // score for bf-01
  });

  /**
   * @behavior ComparisonReportGenerator shows token counts and ratios
   * @acceptance-criteria AC-COMPARISON-REPORT.3
   */
  it('should show token counts and ratios', () => {
    // GIVEN a comparison with specific token counts
    const verdict = createVerdict('CLAIM_VALIDATED', 97, 0.20);
    const judgeResults = createJudgeResults([
      { taskId: 'task-tokens', weightedScore: 97 },
    ]);
    const comparisons = createComparisonResults([
      { taskId: 'task-tokens', tokenRatio: 0.20, inputTokens: 100, outputTokens: 100 },
    ]);
    const tasks = createTasks([
      { id: 'task-tokens', name: 'Token Test Task', category: 'refactoring' },
    ]);

    // WHEN generating the report
    const generator = new ComparisonReportGenerator();
    const report = generator.generate(verdict, judgeResults, comparisons, tasks);

    // THEN the report should show token counts
    expect(report).toContain('100'); // input tokens
    expect(report).toContain('200'); // total tokens (input + output)
    expect(report).toContain('20'); // 20% ratio
  });

  /**
   * @behavior ComparisonReportGenerator saves report to file path
   * @acceptance-criteria AC-COMPARISON-REPORT.4
   */
  it('should save report to file path', () => {
    // GIVEN a valid report
    const verdict = createVerdict('CLAIM_VALIDATED', 95, 0.25);
    const judgeResults = createJudgeResults([
      { taskId: 'task-save', weightedScore: 95 },
    ]);
    const comparisons = createComparisonResults([
      { taskId: 'task-save', tokenRatio: 0.25, inputTokens: 50, outputTokens: 50 },
    ]);
    const tasks = createTasks([
      { id: 'task-save', name: 'Save Test Task', category: 'test-writing' },
    ]);

    // Create a temp directory for testing
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comparison-report-test-'));
    const testFilePath = path.join(tempDir, 'test-report.md');

    try {
      // WHEN generating and saving the report
      const generator = new ComparisonReportGenerator();
      const report = generator.generate(verdict, judgeResults, comparisons, tasks);
      generator.save(report, testFilePath);

      // THEN the file should exist with the report content
      expect(fs.existsSync(testFilePath)).toBe(true);
      const savedContent = fs.readFileSync(testFilePath, 'utf-8');
      expect(savedContent).toContain('# Model Comparison Report');
      expect(savedContent).toContain('CLAIM_VALIDATED');
    } finally {
      // Cleanup
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      fs.rmdirSync(tempDir);
    }
  });
});
