/**
 * @file Composite Quality Score Tests
 * @behavior CompositeEvaluator combines LLM and automated scores with configurable weights
 * @acceptance-criteria AC-COMP.1 through AC-COMP.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { BenchmarkTask } from '../../../src/services/benchmark/types.js';
import {
  CompositeEvaluator,
  LLMJudgeEvaluator,
  AutomatedEvaluator,
  type EvaluationRequest,
} from '../../../src/services/benchmark/evaluator.js';

// Mock fetch globally for LLM judge calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Composite Quality Score', () => {
  let sampleTask: BenchmarkTask;
  let sampleRequest: EvaluationRequest;

  beforeEach(() => {
    vi.clearAllMocks();

    sampleTask = {
      id: 'composite-test-01',
      name: 'Code Review Task',
      category: 'code-review',
      prompt: 'Review this function for issues',
      expectedBehavior: ['type checking', 'input validation', 'error handling'],
    };

    sampleRequest = {
      task: sampleTask,
      referenceOutput: 'The function needs type annotations, input validation, and error handling.',
      candidateOutput: 'This function lacks type checking and input validation.',
      provider: 'test-model',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @behavior Composite score is 70% LLM + 30% automated
   * @acceptance-criteria AC-COMP.1
   */
  it('should calculate 70% LLM + 30% automated score', async () => {
    // GIVEN an LLM judge that returns 100 for all dimensions
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 100, reasoning: 'Perfect correctness' },
              completeness: { score: 100, reasoning: 'Perfect completeness' },
              style: { score: 100, reasoning: 'Perfect style' },
              efficiency: { score: 100, reasoning: 'Perfect efficiency' },
              overall: 100,
            }),
          },
        ],
      }),
    });

    // AND a task where automated evaluator gives 50% (2/4 patterns match - but we have 3 patterns)
    // Candidate output contains "type checking" and "input validation" (2/3 = 67%)
    const taskFor67Percent: BenchmarkTask = {
      id: 'composite-67',
      name: 'Test Task',
      category: 'code-review',
      prompt: 'Review code',
      expectedBehavior: ['type checking', 'input validation', 'error handling'],
    };

    const requestFor67Percent: EvaluationRequest = {
      task: taskFor67Percent,
      referenceOutput: 'Reference output',
      candidateOutput: 'This code needs type checking and input validation',
      provider: 'test-model',
    };

    const compositeEvaluator = new CompositeEvaluator({
      llmWeight: 0.7,
      automatedWeight: 0.3,
      llmEvaluator: new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      }),
    });

    // WHEN evaluating with composite evaluator
    const result = await compositeEvaluator.evaluate(requestFor67Percent);

    // THEN the score should be: 100 * 0.7 + 67 * 0.3 = 70 + 20.1 = 90 (rounded)
    // Note: 2/3 patterns = 66.67% rounded to 67
    expect(result.scores.overall).toBe(90);
    expect(result.evaluatorType).toBe('composite');
  });

  /**
   * @behavior Composite evaluator verifies default weights are 70/30
   * @acceptance-criteria AC-COMP.1
   */
  it('should use default weights of 70% LLM and 30% automated', async () => {
    // GIVEN an LLM that returns 0 (fails)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    // AND a task where all patterns match (100% automated)
    const perfectMatchTask: BenchmarkTask = {
      id: 'perfect-match',
      name: 'Perfect Match',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: ['alpha', 'beta'],
    };

    const perfectMatchRequest: EvaluationRequest = {
      task: perfectMatchTask,
      referenceOutput: 'Reference',
      candidateOutput: 'Contains alpha and beta keywords',
      provider: 'test-model',
    };

    // AND a composite evaluator with DEFAULT weights (should be 0.7/0.3)
    const defaultComposite = new CompositeEvaluator({
      llmEvaluator: new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      }),
    });

    // WHEN evaluating
    const result = await defaultComposite.evaluate(perfectMatchRequest);

    // THEN score should be: 0 * 0.7 + 100 * 0.3 = 30
    expect(result.scores.overall).toBe(30);
  });

  /**
   * @behavior Automated metrics are normalized to 0-100 scale
   * @acceptance-criteria AC-COMP.2
   */
  it('should normalize automated metrics to 0-100 scale', async () => {
    // GIVEN a task with 5 expected behaviors
    const task: BenchmarkTask = {
      id: 'normalize-task',
      name: 'Normalize Test',
      category: 'code-review',
      prompt: 'Review code',
      expectedBehavior: ['pattern1', 'pattern2', 'pattern3', 'pattern4', 'pattern5'],
    };

    // AND candidate output matching exactly 3 of 5 patterns (60%)
    const request: EvaluationRequest = {
      task,
      referenceOutput: 'Reference output',
      candidateOutput: 'Contains pattern1, pattern2, and pattern3 but not others',
      provider: 'test-model',
    };

    // WHEN evaluating with AutomatedEvaluator alone
    const automatedEvaluator = new AutomatedEvaluator();
    const result = await automatedEvaluator.evaluate(request);

    // THEN score should be normalized to 60 (3/5 = 0.6 * 100)
    expect(result.scores.overall).toBe(60);
    expect(result.scores.overall).toBeGreaterThanOrEqual(0);
    expect(result.scores.overall).toBeLessThanOrEqual(100);
  });

  /**
   * @behavior Automated metrics handle various pattern match percentages
   * @acceptance-criteria AC-COMP.2
   */
  it('should correctly calculate various pattern match percentages', async () => {
    const automatedEvaluator = new AutomatedEvaluator();

    // Test 0% match
    const zeroMatchTask: BenchmarkTask = {
      id: 'zero-match',
      name: 'Zero Match',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: ['xyz', 'abc'],
    };
    const zeroResult = await automatedEvaluator.evaluate({
      task: zeroMatchTask,
      referenceOutput: 'Reference',
      candidateOutput: 'No matching patterns here',
      provider: 'test',
    });
    expect(zeroResult.scores.overall).toBe(0);

    // Test 100% match
    const fullMatchTask: BenchmarkTask = {
      id: 'full-match',
      name: 'Full Match',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: ['apple', 'banana'],
    };
    const fullResult = await automatedEvaluator.evaluate({
      task: fullMatchTask,
      referenceOutput: 'Reference',
      candidateOutput: 'Contains apple and banana',
      provider: 'test',
    });
    expect(fullResult.scores.overall).toBe(100);

    // Test 25% match (1 of 4)
    const quarterMatchTask: BenchmarkTask = {
      id: 'quarter-match',
      name: 'Quarter Match',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: ['one', 'two', 'three', 'four'],
    };
    const quarterResult = await automatedEvaluator.evaluate({
      task: quarterMatchTask,
      referenceOutput: 'Reference',
      candidateOutput: 'Only has one keyword',
      provider: 'test',
    });
    expect(quarterResult.scores.overall).toBe(25);
  });

  /**
   * @behavior Composite evaluator handles missing automated metrics gracefully
   * @acceptance-criteria AC-COMP.3
   */
  it('should handle missing automated metrics gracefully', async () => {
    // GIVEN an LLM that returns good scores
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 80, reasoning: 'Good' },
              completeness: { score: 80, reasoning: 'Good' },
              style: { score: 80, reasoning: 'Good' },
              efficiency: { score: 80, reasoning: 'Good' },
              overall: 80,
            }),
          },
        ],
      }),
    });

    // AND a task with NO expected behaviors (empty array - automated can't evaluate)
    const noPatternTask: BenchmarkTask = {
      id: 'no-pattern-task',
      name: 'No Pattern Task',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: [], // Empty - no patterns to match
    };

    const request: EvaluationRequest = {
      task: noPatternTask,
      referenceOutput: 'Reference',
      candidateOutput: 'Some candidate output',
      provider: 'test-model',
    };

    const compositeEvaluator = new CompositeEvaluator({
      llmEvaluator: new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      }),
    });

    // WHEN evaluating
    const result = await compositeEvaluator.evaluate(request);

    // THEN it should not fail, automated should return 100 (no patterns = full score)
    // Score: 80 * 0.7 + 100 * 0.3 = 56 + 30 = 86
    expect(result.scores.overall).toBe(86);
    expect(result.evaluatorType).toBe('composite');
  });

  /**
   * @behavior Composite evaluator handles LLM failure gracefully
   * @acceptance-criteria AC-COMP.3
   */
  it('should fall back to automated only when LLM fails', async () => {
    // GIVEN a completely failing LLM
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // AND a task with patterns that will match
    const task: BenchmarkTask = {
      id: 'fallback-task',
      name: 'Fallback Task',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: ['keyword1', 'keyword2'],
    };

    const request: EvaluationRequest = {
      task,
      referenceOutput: 'Reference',
      candidateOutput: 'This has keyword1 and keyword2',
      provider: 'test-model',
    };

    const compositeEvaluator = new CompositeEvaluator({
      llmEvaluator: new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      }),
    });

    // WHEN evaluating
    const result = await compositeEvaluator.evaluate(request);

    // THEN it should use only automated score: 0 * 0.7 + 100 * 0.3 = 30
    expect(result.scores.overall).toBe(30);
    expect(result.evaluatorType).toBe('composite');
  });

  /**
   * @behavior Composite evaluator works without LLM evaluator configured
   * @acceptance-criteria AC-COMP.3
   */
  it('should work with only automated metrics when no LLM evaluator configured', async () => {
    // GIVEN a composite evaluator without LLM evaluator
    const automatedOnlyEvaluator = new CompositeEvaluator({
      // No llmEvaluator provided
    });

    // AND a task with matchable patterns
    const task: BenchmarkTask = {
      id: 'auto-only-task',
      name: 'Auto Only Task',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: ['match', 'this'],
    };

    const request: EvaluationRequest = {
      task,
      referenceOutput: 'Reference',
      candidateOutput: 'match and this are present',
      provider: 'test-model',
    };

    // WHEN evaluating
    const result = await automatedOnlyEvaluator.evaluate(request);

    // THEN it should use only automated: 0 * 0.7 + 100 * 0.3 = 30
    expect(result.scores.overall).toBe(30);
    expect(result.evaluatorType).toBe('composite');
  });

  /**
   * @behavior Composite score combines all dimension scores correctly
   * @acceptance-criteria AC-COMP.1
   */
  it('should combine dimension scores with correct weights', async () => {
    // GIVEN an LLM that returns varied dimension scores
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 90, reasoning: 'Very correct' },
              completeness: { score: 80, reasoning: 'Mostly complete' },
              style: { score: 70, reasoning: 'Good style' },
              efficiency: { score: 60, reasoning: 'Could be better' },
              overall: 75,
            }),
          },
        ],
      }),
    });

    // AND a task where automated gives 50% (use distinctive patterns to avoid false matches)
    const task: BenchmarkTask = {
      id: 'dimension-task',
      name: 'Dimension Task',
      category: 'code-review',
      prompt: 'Review',
      expectedBehavior: ['keyword_alpha', 'keyword_beta', 'keyword_gamma', 'keyword_delta'],
    };

    const request: EvaluationRequest = {
      task,
      referenceOutput: 'Reference',
      candidateOutput: 'Contains keyword_alpha and keyword_beta only',
      provider: 'test-model',
    };

    const compositeEvaluator = new CompositeEvaluator({
      llmEvaluator: new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      }),
    });

    // WHEN evaluating
    const result = await compositeEvaluator.evaluate(request);

    // THEN each dimension should be weighted correctly
    // Automated gives 50 for all dimensions (2/4 patterns matched)
    // correctness: 90 * 0.7 + 50 * 0.3 = 63 + 15 = 78
    expect(result.scores.correctness).toBe(78);
    // completeness: 80 * 0.7 + 50 * 0.3 = 56 + 15 = 71
    expect(result.scores.completeness).toBe(71);
    // style: 70 * 0.7 + 50 * 0.3 = 49 + 15 = 64
    expect(result.scores.style).toBe(64);
    // efficiency: 60 * 0.7 + 50 * 0.3 = 42 + 15 = 57
    expect(result.scores.efficiency).toBe(57);
    // overall: 75 * 0.7 + 50 * 0.3 = 52.5 + 15 = 67.5 = 68 (rounded)
    expect(result.scores.overall).toBe(68);
  });

  /**
   * @behavior Composite evaluator preserves LLM reasoning
   * @acceptance-criteria AC-COMP.1
   */
  it('should preserve LLM reasoning in composite result', async () => {
    // GIVEN an LLM with detailed reasoning
    const expectedReasoning = {
      correctness: 'Correctly identified the issue',
      completeness: 'Covered all key points',
      style: 'Well formatted response',
      efficiency: 'Concise and to the point',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 85, reasoning: expectedReasoning.correctness },
              completeness: { score: 80, reasoning: expectedReasoning.completeness },
              style: { score: 90, reasoning: expectedReasoning.style },
              efficiency: { score: 75, reasoning: expectedReasoning.efficiency },
              overall: 82,
            }),
          },
        ],
      }),
    });

    const compositeEvaluator = new CompositeEvaluator({
      llmEvaluator: new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      }),
    });

    // WHEN evaluating
    const result = await compositeEvaluator.evaluate(sampleRequest);

    // THEN reasoning should be preserved from LLM
    expect(result.scores.reasoning).toBeDefined();
    expect(result.scores.reasoning?.correctness).toBe(expectedReasoning.correctness);
    expect(result.scores.reasoning?.completeness).toBe(expectedReasoning.completeness);
    expect(result.scores.reasoning?.style).toBe(expectedReasoning.style);
    expect(result.scores.reasoning?.efficiency).toBe(expectedReasoning.efficiency);
  });
});
