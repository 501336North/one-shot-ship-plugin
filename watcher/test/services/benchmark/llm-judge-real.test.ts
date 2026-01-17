/**
 * @file LLM Judge Scoring Tests
 * @behavior LLM-as-judge evaluator scores candidate outputs against baselines
 * @acceptance-criteria AC-JUDGE.1 through AC-JUDGE.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { BenchmarkTask } from '../../../src/services/benchmark/types.js';
import {
  LLMJudgeEvaluator,
  type EvaluationRequest,
} from '../../../src/services/benchmark/evaluator.js';

// Mock fetch globally for LLM judge calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('LLM Judge Scoring', () => {
  let sampleTask: BenchmarkTask;
  let sampleRequest: EvaluationRequest;

  beforeEach(() => {
    vi.clearAllMocks();

    sampleTask = {
      id: 'judge-test-01',
      name: 'Code Review Task',
      category: 'code-review',
      prompt: 'Review this function:\n```js\nfunction add(a, b) { return a + b; }\n```',
      expectedBehavior: ['type checking', 'input validation'],
    };

    sampleRequest = {
      task: sampleTask,
      referenceOutput: 'The function is missing type annotations and input validation.',
      candidateOutput: 'This function adds two numbers but lacks type safety.',
      provider: 'test-model',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @behavior LLM Judge scores candidate output against baseline reference
   * @acceptance-criteria AC-JUDGE.1
   */
  it('should score candidate output against baseline', async () => {
    // GIVEN an LLM judge with a mock API endpoint
    const evaluator = new LLMJudgeEvaluator({
      judgeEndpoint: 'http://localhost:3456/v1/messages',
      apiKey: 'test-key',
    });

    // AND a successful LLM response with scores
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 75, reasoning: 'Similar to baseline but less complete' },
              completeness: { score: 60, reasoning: 'Missing input validation mention' },
              style: { score: 80, reasoning: 'Clear and readable' },
              efficiency: { score: 70, reasoning: 'Adequate response length' },
              overall: 71,
            }),
          },
        ],
      }),
    });

    // WHEN scoring the candidate against the baseline
    const result = await evaluator.evaluate(sampleRequest);

    // THEN the API should be called with both baseline and candidate in the prompt
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    const prompt = requestBody.messages[0].content;

    expect(prompt).toContain(sampleRequest.referenceOutput);
    expect(prompt).toContain(sampleRequest.candidateOutput);

    // AND the result should contain comparative scores
    expect(result.taskId).toBe(sampleTask.id);
    expect(result.provider).toBe('test-model');
    expect(result.scores.overall).toBe(71);
  });

  /**
   * @behavior LLM Judge returns quality percentage between 0 and 100
   * @acceptance-criteria AC-JUDGE.2
   */
  it('should return quality percentage (0-100)', async () => {
    // GIVEN an LLM judge evaluator
    const evaluator = new LLMJudgeEvaluator({
      judgeEndpoint: 'http://localhost:3456/v1/messages',
    });

    // AND an LLM response with scores at various levels
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 85, reasoning: 'Mostly correct' },
              completeness: { score: 72, reasoning: 'Some gaps' },
              style: { score: 90, reasoning: 'Well formatted' },
              efficiency: { score: 68, reasoning: 'Could be more concise' },
              overall: 79,
            }),
          },
        ],
      }),
    });

    // WHEN evaluating
    const result = await evaluator.evaluate(sampleRequest);

    // THEN all scores should be between 0-100
    expect(result.scores.correctness).toBeGreaterThanOrEqual(0);
    expect(result.scores.correctness).toBeLessThanOrEqual(100);
    expect(result.scores.completeness).toBeGreaterThanOrEqual(0);
    expect(result.scores.completeness).toBeLessThanOrEqual(100);
    expect(result.scores.style).toBeGreaterThanOrEqual(0);
    expect(result.scores.style).toBeLessThanOrEqual(100);
    expect(result.scores.efficiency).toBeGreaterThanOrEqual(0);
    expect(result.scores.efficiency).toBeLessThanOrEqual(100);
    expect(result.scores.overall).toBeGreaterThanOrEqual(0);
    expect(result.scores.overall).toBeLessThanOrEqual(100);

    // AND specific values should match
    expect(result.scores.correctness).toBe(85);
    expect(result.scores.completeness).toBe(72);
    expect(result.scores.style).toBe(90);
    expect(result.scores.efficiency).toBe(68);
    expect(result.scores.overall).toBe(79);
  });

  /**
   * @behavior LLM Judge provides reasoning for each score dimension
   * @acceptance-criteria AC-JUDGE.3
   */
  it('should provide reasoning for score', async () => {
    // GIVEN an LLM judge evaluator
    const evaluator = new LLMJudgeEvaluator({
      judgeEndpoint: 'http://localhost:3456/v1/messages',
    });

    // AND an LLM response with detailed reasoning
    const expectedReasoning = {
      correctness: 'The candidate correctly identifies the lack of type safety',
      completeness: 'Missing mention of input validation that the reference includes',
      style: 'Clear and professional language used throughout',
      efficiency: 'Response is appropriately concise without losing meaning',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 80, reasoning: expectedReasoning.correctness },
              completeness: { score: 65, reasoning: expectedReasoning.completeness },
              style: { score: 85, reasoning: expectedReasoning.style },
              efficiency: { score: 75, reasoning: expectedReasoning.efficiency },
              overall: 76,
            }),
          },
        ],
      }),
    });

    // WHEN evaluating
    const result = await evaluator.evaluate(sampleRequest);

    // THEN reasoning should be provided for each dimension
    expect(result.scores.reasoning).toBeDefined();
    expect(result.scores.reasoning?.correctness).toBe(expectedReasoning.correctness);
    expect(result.scores.reasoning?.completeness).toBe(expectedReasoning.completeness);
    expect(result.scores.reasoning?.style).toBe(expectedReasoning.style);
    expect(result.scores.reasoning?.efficiency).toBe(expectedReasoning.efficiency);
  });

  /**
   * @behavior LLM Judge handles edge case of identical candidate and baseline
   * @acceptance-criteria AC-JUDGE.1
   */
  it('should handle identical candidate and baseline outputs', async () => {
    // GIVEN an LLM judge evaluator
    const evaluator = new LLMJudgeEvaluator({
      judgeEndpoint: 'http://localhost:3456/v1/messages',
    });

    // AND a request where candidate matches baseline
    const identicalRequest: EvaluationRequest = {
      task: sampleTask,
      referenceOutput: 'The function is missing type annotations.',
      candidateOutput: 'The function is missing type annotations.',
      provider: 'perfect-model',
    };

    // AND an LLM response indicating perfect match
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 100, reasoning: 'Identical to baseline' },
              completeness: { score: 100, reasoning: 'Complete match' },
              style: { score: 100, reasoning: 'Same formatting' },
              efficiency: { score: 100, reasoning: 'Same efficiency' },
              overall: 100,
            }),
          },
        ],
      }),
    });

    // WHEN evaluating
    const result = await evaluator.evaluate(identicalRequest);

    // THEN scores should be at maximum
    expect(result.scores.overall).toBe(100);
    expect(result.scores.correctness).toBe(100);
  });

  /**
   * @behavior LLM Judge handles empty candidate output
   * @acceptance-criteria AC-JUDGE.2
   */
  it('should handle empty candidate output with zero scores', async () => {
    // GIVEN an LLM judge evaluator
    const evaluator = new LLMJudgeEvaluator({
      judgeEndpoint: 'http://localhost:3456/v1/messages',
    });

    // AND a request with empty candidate output
    const emptyRequest: EvaluationRequest = {
      task: sampleTask,
      referenceOutput: 'The function is missing type annotations.',
      candidateOutput: '',
      provider: 'failed-model',
    };

    // AND an LLM response with zero scores
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              correctness: { score: 0, reasoning: 'No output provided' },
              completeness: { score: 0, reasoning: 'Empty response' },
              style: { score: 0, reasoning: 'No content to evaluate' },
              efficiency: { score: 0, reasoning: 'N/A' },
              overall: 0,
            }),
          },
        ],
      }),
    });

    // WHEN evaluating
    const result = await evaluator.evaluate(emptyRequest);

    // THEN scores should be zero
    expect(result.scores.overall).toBe(0);
    expect(result.scores.correctness).toBe(0);
    expect(result.scores.completeness).toBe(0);
  });

  /**
   * @behavior LLM Judge handles API errors gracefully
   * @acceptance-criteria AC-JUDGE.2
   */
  it('should return zero scores when API fails', async () => {
    // GIVEN an LLM judge evaluator
    const evaluator = new LLMJudgeEvaluator({
      judgeEndpoint: 'http://localhost:3456/v1/messages',
    });

    // AND the API returns an error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    // WHEN evaluating
    const result = await evaluator.evaluate(sampleRequest);

    // THEN it should return zero scores without throwing
    expect(result.scores.overall).toBe(0);
    expect(result.scores.correctness).toBe(0);
    expect(result.evaluatorType).toBe('llm');
  });

  /**
   * @behavior LLM Judge handles malformed JSON response
   * @acceptance-criteria AC-JUDGE.3
   */
  it('should handle malformed JSON response gracefully', async () => {
    // GIVEN an LLM judge evaluator
    const evaluator = new LLMJudgeEvaluator({
      judgeEndpoint: 'http://localhost:3456/v1/messages',
    });

    // AND the API returns invalid JSON
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: 'This is not valid JSON at all!' }],
      }),
    });

    // WHEN evaluating
    const result = await evaluator.evaluate(sampleRequest);

    // THEN it should return zero scores with failure reasoning
    expect(result.scores.overall).toBe(0);
    expect(result.evaluatorType).toBe('llm');
  });
});
