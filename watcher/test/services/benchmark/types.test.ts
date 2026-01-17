/**
 * @file Benchmark Task Types Tests
 * @behavior BenchmarkTask types define the structure for model quality benchmarks
 * @acceptance-criteria AC-BENCHMARK.1 through AC-BENCHMARK.4
 */

import { describe, it, expect } from 'vitest';
import {
  TaskCategory,
  QualityDimension,
  BenchmarkTask,
  BenchmarkResult,
  QualityScores,
} from '../../../src/services/benchmark/types.js';

describe('BenchmarkTask types', () => {
  describe('BenchmarkTask interface', () => {
    it('should define BenchmarkTask interface with id, name, prompt, expectedBehavior', () => {
      // GIVEN a benchmark task definition
      const task: BenchmarkTask = {
        id: 'test-task-01',
        name: 'Test Task',
        category: 'code-review',
        prompt: 'Review this code',
        expectedBehavior: ['identify issues', 'suggest fixes'],
      };

      // THEN all required properties should be defined
      expect(task.id).toBe('test-task-01');
      expect(task.name).toBe('Test Task');
      expect(task.category).toBe('code-review');
      expect(task.prompt).toBe('Review this code');
      expect(task.expectedBehavior).toEqual(['identify issues', 'suggest fixes']);
    });

    it('should allow optional timeout property', () => {
      // GIVEN a benchmark task with timeout
      const taskWithTimeout: BenchmarkTask = {
        id: 'timeout-task',
        name: 'Timeout Task',
        category: 'bug-fix',
        prompt: 'Fix this bug',
        expectedBehavior: ['fix applied'],
        timeout: 30000,
      };

      // THEN timeout should be accessible
      expect(taskWithTimeout.timeout).toBe(30000);

      // AND tasks without timeout should work
      const taskWithoutTimeout: BenchmarkTask = {
        id: 'no-timeout',
        name: 'No Timeout',
        category: 'test-writing',
        prompt: 'Write tests',
        expectedBehavior: ['tests written'],
      };
      expect(taskWithoutTimeout.timeout).toBeUndefined();
    });
  });

  describe('BenchmarkResult interface', () => {
    it('should define BenchmarkResult interface with tokens, latency, output, score', () => {
      // GIVEN a benchmark result
      const result: BenchmarkResult = {
        taskId: 'test-task-01',
        provider: 'openai',
        model: 'gpt-4o',
        output: 'The code has issues...',
        inputTokens: 150,
        outputTokens: 200,
        latencyMs: 1500,
        timestamp: '2025-01-17T10:00:00Z',
      };

      // THEN all properties should be accessible
      expect(result.taskId).toBe('test-task-01');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.output).toBe('The code has issues...');
      expect(result.inputTokens).toBe(150);
      expect(result.outputTokens).toBe(200);
      expect(result.latencyMs).toBe(1500);
      expect(result.timestamp).toBe('2025-01-17T10:00:00Z');
    });

    it('should allow optional scores in BenchmarkResult', () => {
      // GIVEN a result with quality scores
      const resultWithScores: BenchmarkResult = {
        taskId: 'scored-task',
        provider: 'anthropic',
        model: 'claude-3-opus',
        output: 'Output text',
        inputTokens: 100,
        outputTokens: 150,
        latencyMs: 2000,
        timestamp: '2025-01-17T10:00:00Z',
        scores: {
          correctness: 90,
          completeness: 85,
          style: 80,
          efficiency: 75,
          overall: 82.5,
        },
      };

      // THEN scores should be accessible
      expect(resultWithScores.scores?.correctness).toBe(90);
      expect(resultWithScores.scores?.overall).toBe(82.5);
    });
  });

  describe('QualityDimension type', () => {
    it('should define QualityDimension with correctness, completeness, style, efficiency', () => {
      // GIVEN valid quality dimensions
      const dimensions: QualityDimension[] = [
        'correctness',
        'completeness',
        'style',
        'efficiency',
      ];

      // THEN each dimension should be a valid value
      expect(dimensions).toContain('correctness');
      expect(dimensions).toContain('completeness');
      expect(dimensions).toContain('style');
      expect(dimensions).toContain('efficiency');
      expect(dimensions.length).toBe(4);
    });
  });

  describe('TaskCategory type', () => {
    it('should define TaskCategory with code-review, bug-fix, test-writing, refactoring', () => {
      // GIVEN valid task categories
      const categories: TaskCategory[] = [
        'code-review',
        'bug-fix',
        'test-writing',
        'refactoring',
      ];

      // THEN each category should be a valid value
      expect(categories).toContain('code-review');
      expect(categories).toContain('bug-fix');
      expect(categories).toContain('test-writing');
      expect(categories).toContain('refactoring');
      expect(categories.length).toBe(4);
    });
  });

  describe('QualityScores interface', () => {
    it('should define QualityScores with dimension scores and overall', () => {
      // GIVEN a quality scores object
      const scores: QualityScores = {
        correctness: 95,
        completeness: 88,
        style: 92,
        efficiency: 85,
        overall: 90,
      };

      // THEN all scores should be accessible
      expect(scores.correctness).toBe(95);
      expect(scores.completeness).toBe(88);
      expect(scores.style).toBe(92);
      expect(scores.efficiency).toBe(85);
      expect(scores.overall).toBe(90);
    });

    it('should allow optional reasoning in QualityScores', () => {
      // GIVEN scores with reasoning
      const scoresWithReasoning: QualityScores = {
        correctness: 90,
        completeness: 85,
        style: 80,
        efficiency: 75,
        overall: 82.5,
        reasoning: {
          correctness: 'All issues identified correctly',
          completeness: 'Missing one edge case',
          style: 'Good formatting, minor improvements possible',
          efficiency: 'Some redundant checks',
        },
      };

      // THEN reasoning should be accessible
      expect(scoresWithReasoning.reasoning?.correctness).toBe('All issues identified correctly');
      expect(scoresWithReasoning.reasoning?.efficiency).toBe('Some redundant checks');
    });
  });
});
