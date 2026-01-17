/**
 * @file Quality Judge Tests
 * @description Tests for the QualityJudge scoring system
 *
 * @behavior QualityJudge scores model responses on 4 dimensions with weighted scoring
 * @acceptance-criteria AC-JUDGE.1 through AC-JUDGE.4
 */

import { describe, it, expect } from 'vitest';
import {
  QualityJudge,
  JudgeScore,
  JudgeResult,
} from '../../../src/services/benchmark/quality-judge.js';
import type { BaselineResponse } from '../../../src/services/benchmark/baseline-generator.js';
import type { ChallengerResponse } from '../../../src/services/benchmark/challenger-runner.js';
import type { ComparisonTask } from '../../../src/services/benchmark/comparison-tasks.js';

describe('Quality Judge', () => {
  // Create test fixtures
  const createTask = (id: string): ComparisonTask => ({
    id,
    name: `Task ${id}`,
    category: 'code-review',
    codeSnippet: 'const x = 1;',
    prompt: 'Review this code.',
  });

  const createBaseline = (taskId: string, response: string): BaselineResponse => ({
    taskId,
    response,
    estimatedTokens: Math.ceil(response.length / 4),
    timestamp: '2026-01-17T12:00:00Z',
  });

  const createChallenger = (taskId: string, response: string): ChallengerResponse => ({
    taskId,
    response,
    inputTokens: 50,
    outputTokens: 30,
    latencyMs: 100,
  });

  /**
   * @behavior QualityJudge scores on 4 dimensions (correctness, completeness, explanation, codeQuality)
   * @acceptance-criteria AC-JUDGE.1
   */
  it('should score on 4 dimensions (correctness, completeness, explanation, codeQuality)', async () => {
    // GIVEN a mock judge scorer that returns predetermined scores
    const mockScorer = async (): Promise<JudgeScore> => ({
      correctness: 85,
      completeness: 75,
      explanation: 90,
      codeQuality: 80,
    });

    const judge = new QualityJudge(mockScorer);
    const task = createTask('test-task-01');
    const baseline = createBaseline('test-task-01', 'This code has an off-by-one error.');
    const challenger = createChallenger('test-task-01', 'The loop condition is wrong.');

    // WHEN scoring the comparison
    const result = await judge.score(baseline, challenger, task);

    // THEN all 4 dimensions should be present in the result
    expect(result.scores.correctness).toBe(85);
    expect(result.scores.completeness).toBe(75);
    expect(result.scores.explanation).toBe(90);
    expect(result.scores.codeQuality).toBe(80);
  });

  /**
   * @behavior QualityJudge applies weights (40/30/15/15)
   * @acceptance-criteria AC-JUDGE.2
   */
  it('should weight scores (40/30/15/15)', async () => {
    // GIVEN specific scores that will produce a known weighted result
    const mockScorer = async (): Promise<JudgeScore> => ({
      correctness: 100,  // 100 * 0.40 = 40
      completeness: 100, // 100 * 0.30 = 30
      explanation: 100,  // 100 * 0.15 = 15
      codeQuality: 100,  // 100 * 0.15 = 15
    });

    const judge = new QualityJudge(mockScorer);
    const task = createTask('test-task-02');
    const baseline = createBaseline('test-task-02', 'Baseline response');
    const challenger = createChallenger('test-task-02', 'Challenger response');

    // WHEN scoring
    const result = await judge.score(baseline, challenger, task);

    // THEN weighted score should be 100 (40 + 30 + 15 + 15)
    expect(result.weightedScore).toBe(100);
  });

  /**
   * @behavior QualityJudge returns weighted score between 0-100
   * @acceptance-criteria AC-JUDGE.3
   */
  it('should return weighted score 0-100', async () => {
    // GIVEN mixed scores
    const mockScorer = async (): Promise<JudgeScore> => ({
      correctness: 80,   // 80 * 0.40 = 32
      completeness: 60,  // 60 * 0.30 = 18
      explanation: 70,   // 70 * 0.15 = 10.5
      codeQuality: 50,   // 50 * 0.15 = 7.5
    });                   // Total: 32 + 18 + 10.5 + 7.5 = 68

    const judge = new QualityJudge(mockScorer);
    const task = createTask('test-task-03');
    const baseline = createBaseline('test-task-03', 'Baseline response');
    const challenger = createChallenger('test-task-03', 'Challenger response');

    // WHEN scoring
    const result = await judge.score(baseline, challenger, task);

    // THEN weighted score should be 68
    expect(result.weightedScore).toBe(68);
    // AND it should be within 0-100 range
    expect(result.weightedScore).toBeGreaterThanOrEqual(0);
    expect(result.weightedScore).toBeLessThanOrEqual(100);
  });

  /**
   * @behavior QualityJudge includes reasoning for each dimension
   * @acceptance-criteria AC-JUDGE.4
   */
  it('should include reasoning for each dimension', async () => {
    // GIVEN a scorer that returns reasoning
    const mockScorer = async (): Promise<JudgeScore> => ({
      correctness: 85,
      completeness: 75,
      explanation: 90,
      codeQuality: 80,
      reasoning: {
        correctness: 'Correctly identified the main issue.',
        completeness: 'Missing some edge cases.',
        explanation: 'Clear and well-structured explanation.',
        codeQuality: 'Good code suggestions with minor style issues.',
      },
    });

    const judge = new QualityJudge(mockScorer);
    const task = createTask('test-task-04');
    const baseline = createBaseline('test-task-04', 'Baseline response');
    const challenger = createChallenger('test-task-04', 'Challenger response');

    // WHEN scoring
    const result = await judge.score(baseline, challenger, task);

    // THEN reasoning should be present for all dimensions
    expect(result.reasoning).toBeDefined();
    expect(result.reasoning.correctness).toBe('Correctly identified the main issue.');
    expect(result.reasoning.completeness).toBe('Missing some edge cases.');
    expect(result.reasoning.explanation).toBe('Clear and well-structured explanation.');
    expect(result.reasoning.codeQuality).toBe('Good code suggestions with minor style issues.');
  });

  /**
   * @behavior QualityJudge handles minimum scores
   */
  it('should handle minimum scores (all zeros)', async () => {
    // GIVEN all zero scores
    const mockScorer = async (): Promise<JudgeScore> => ({
      correctness: 0,
      completeness: 0,
      explanation: 0,
      codeQuality: 0,
    });

    const judge = new QualityJudge(mockScorer);
    const task = createTask('test-task-05');
    const baseline = createBaseline('test-task-05', 'Baseline response');
    const challenger = createChallenger('test-task-05', 'Challenger response');

    // WHEN scoring
    const result = await judge.score(baseline, challenger, task);

    // THEN weighted score should be 0
    expect(result.weightedScore).toBe(0);
  });
});
