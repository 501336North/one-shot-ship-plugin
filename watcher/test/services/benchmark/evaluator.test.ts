/**
 * @file Quality Evaluator Tests
 * @behavior QualityEvaluator scores model outputs using LLM-as-judge and automated metrics
 * @acceptance-criteria AC-EVAL.1 through AC-EVAL.4
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { BenchmarkTask } from '../../../src/services/benchmark/types.js';
import {
  EVALUATION_PROMPT,
  type EvaluationRequest,
  type EvaluationResult,
  type Evaluator,
  LLMJudgeEvaluator,
  AutomatedEvaluator,
  CompositeEvaluator,
} from '../../../src/services/benchmark/evaluator.js';

// Mock fetch globally for LLM judge calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('QualityEvaluator', () => {
  let sampleTask: BenchmarkTask;
  let sampleRequest: EvaluationRequest;

  beforeEach(() => {
    vi.clearAllMocks();

    sampleTask = {
      id: 'test-task-01',
      name: 'Code Review Task',
      category: 'code-review',
      prompt: 'Review this function for issues:\n```\nfunction add(a, b) { return a + b; }\n```',
      expectedBehavior: ['type checking', 'input validation', 'error handling'],
    };

    sampleRequest = {
      task: sampleTask,
      referenceOutput: 'The function is missing type annotations. Consider adding TypeScript types.',
      candidateOutput: 'This function adds two numbers. It lacks type safety.',
      provider: 'ollama',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Task 3.1: Quality Evaluation Protocol
  // ============================================================================
  describe('Quality Evaluation Protocol', () => {
    /**
     * @behavior Evaluation prompt template is defined with expected structure
     * @acceptance-criteria AC-EVAL.1
     */
    it('should define evaluation prompt template', () => {
      // GIVEN the evaluation prompt template constant
      // WHEN checking its contents
      // THEN it should contain required sections
      expect(EVALUATION_PROMPT).toBeDefined();
      expect(EVALUATION_PROMPT).toContain('TASK:');
      expect(EVALUATION_PROMPT).toContain('PROMPT:');
      expect(EVALUATION_PROMPT).toContain('REFERENCE OUTPUT');
      expect(EVALUATION_PROMPT).toContain('CANDIDATE OUTPUT');
      expect(EVALUATION_PROMPT).toContain('EXPECTED BEHAVIORS');
      expect(EVALUATION_PROMPT).toContain('Correctness');
      expect(EVALUATION_PROMPT).toContain('Completeness');
      expect(EVALUATION_PROMPT).toContain('Style');
      expect(EVALUATION_PROMPT).toContain('Efficiency');
    });

    /**
     * @behavior Evaluator scores on 4 dimensions (correctness, completeness, style, efficiency)
     * @acceptance-criteria AC-EVAL.1
     */
    it('should score on 4 dimensions (correctness, completeness, style, efficiency)', async () => {
      // GIVEN a successful LLM judge response with all dimensions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                correctness: { score: 85, reasoning: 'Correct analysis' },
                completeness: { score: 70, reasoning: 'Missing some aspects' },
                style: { score: 90, reasoning: 'Well formatted' },
                efficiency: { score: 75, reasoning: 'Could be more concise' },
                overall: 80,
              }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      const evaluator = new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(sampleRequest);

      // THEN all 4 dimensions should be present in scores
      expect(result.scores.correctness).toBeDefined();
      expect(result.scores.completeness).toBeDefined();
      expect(result.scores.style).toBeDefined();
      expect(result.scores.efficiency).toBeDefined();
    });

    /**
     * @behavior Evaluator returns overall score 0-100
     * @acceptance-criteria AC-EVAL.1
     */
    it('should return overall score 0-100', async () => {
      // GIVEN a successful LLM judge response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                correctness: { score: 85, reasoning: 'Good' },
                completeness: { score: 70, reasoning: 'Good' },
                style: { score: 90, reasoning: 'Good' },
                efficiency: { score: 75, reasoning: 'Good' },
                overall: 80,
              }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      const evaluator = new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(sampleRequest);

      // THEN overall score should be between 0-100
      expect(result.scores.overall).toBeGreaterThanOrEqual(0);
      expect(result.scores.overall).toBeLessThanOrEqual(100);
      expect(result.scores.overall).toBe(80);
    });

    /**
     * @behavior Evaluator includes reasoning for each dimension
     * @acceptance-criteria AC-EVAL.1
     */
    it('should include reasoning for each dimension', async () => {
      // GIVEN a successful LLM judge response with reasoning
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                correctness: { score: 85, reasoning: 'Correctly identified type issues' },
                completeness: { score: 70, reasoning: 'Missing validation suggestions' },
                style: { score: 90, reasoning: 'Clear and readable output' },
                efficiency: { score: 75, reasoning: 'Could be more concise' },
                overall: 80,
              }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      const evaluator = new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(sampleRequest);

      // THEN reasoning should be present for each dimension
      expect(result.scores.reasoning).toBeDefined();
      expect(result.scores.reasoning?.correctness).toBe('Correctly identified type issues');
      expect(result.scores.reasoning?.completeness).toBe('Missing validation suggestions');
      expect(result.scores.reasoning?.style).toBe('Clear and readable output');
      expect(result.scores.reasoning?.efficiency).toBe('Could be more concise');
    });
  });

  // ============================================================================
  // Task 3.2: LLM-as-Judge Evaluator
  // ============================================================================
  describe('LLMJudgeEvaluator', () => {
    /**
     * @behavior LLMJudgeEvaluator compares candidate output to reference (Claude baseline)
     * @acceptance-criteria AC-EVAL.2
     */
    it('should compare candidate output to reference (Claude baseline)', async () => {
      // GIVEN a mock LLM judge endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                correctness: { score: 75, reasoning: 'Similar to reference' },
                completeness: { score: 80, reasoning: 'Covers most points' },
                style: { score: 85, reasoning: 'Good formatting' },
                efficiency: { score: 70, reasoning: 'Slightly verbose' },
                overall: 77,
              }),
            },
          ],
          usage: { input_tokens: 600, output_tokens: 150 },
        }),
      });

      const evaluator = new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      });

      // WHEN evaluating a candidate against reference
      const result = await evaluator.evaluate(sampleRequest);

      // THEN the fetch should be called with both outputs in the prompt
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3456/v1/messages',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(sampleRequest.referenceOutput),
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3456/v1/messages',
        expect.objectContaining({
          body: expect.stringContaining(sampleRequest.candidateOutput),
        })
      );

      // AND result should reflect the comparison
      expect(result.taskId).toBe(sampleTask.id);
      expect(result.provider).toBe('ollama');
    });

    /**
     * @behavior LLMJudgeEvaluator calls judge API with formatted prompt
     * @acceptance-criteria AC-EVAL.2
     */
    it('should call judge API with formatted prompt', async () => {
      // GIVEN a mock LLM judge endpoint
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
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      const evaluator = new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
        apiKey: 'test-api-key',
      });

      // WHEN evaluating
      await evaluator.evaluate(sampleRequest);

      // THEN the API should be called with correct format
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3456/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        })
      );

      // AND the body should contain task info
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toContain(sampleTask.name);
      expect(body.messages[0].content).toContain(sampleTask.prompt);
    });

    /**
     * @behavior LLMJudgeEvaluator parses structured JSON response
     * @acceptance-criteria AC-EVAL.2
     */
    it('should parse structured JSON response', async () => {
      // GIVEN a valid JSON response from judge
      const expectedScores = {
        correctness: { score: 92, reasoning: 'Excellent analysis' },
        completeness: { score: 88, reasoning: 'Very thorough' },
        style: { score: 95, reasoning: 'Perfect formatting' },
        efficiency: { score: 85, reasoning: 'Well optimized' },
        overall: 90,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: JSON.stringify(expectedScores) }],
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      const evaluator = new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(sampleRequest);

      // THEN scores should be correctly parsed
      expect(result.scores.correctness).toBe(92);
      expect(result.scores.completeness).toBe(88);
      expect(result.scores.style).toBe(95);
      expect(result.scores.efficiency).toBe(85);
      expect(result.scores.overall).toBe(90);
    });

    /**
     * @behavior LLMJudgeEvaluator handles evaluation failures gracefully
     * @acceptance-criteria AC-EVAL.2
     */
    it('should handle evaluation failures gracefully', async () => {
      // GIVEN a failing judge API
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const evaluator = new LLMJudgeEvaluator({
        judgeEndpoint: 'http://localhost:3456/v1/messages',
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(sampleRequest);

      // THEN result should indicate failure with zero scores
      expect(result.scores.overall).toBe(0);
      expect(result.scores.correctness).toBe(0);
      expect(result.scores.completeness).toBe(0);
      expect(result.scores.style).toBe(0);
      expect(result.scores.efficiency).toBe(0);
      expect(result.evaluatorType).toBe('llm');
    });
  });

  // ============================================================================
  // Task 3.3: Automated Evaluator
  // ============================================================================
  describe('AutomatedEvaluator', () => {
    /**
     * @behavior AutomatedEvaluator checks if output contains expected patterns
     * @acceptance-criteria AC-EVAL.3
     */
    it('should check if output contains expected patterns', async () => {
      // GIVEN a task with expected behaviors
      const task: BenchmarkTask = {
        id: 'pattern-task',
        name: 'Pattern Match Task',
        category: 'code-review',
        prompt: 'Review this code',
        expectedBehavior: ['type checking', 'error handling', 'validation'],
      };

      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference output',
        candidateOutput: 'This code needs type checking and error handling improvements',
        provider: 'test-provider',
      };

      const evaluator = new AutomatedEvaluator();

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN it should detect patterns present in output
      // 2 out of 3 patterns matched = 67% (rounded to 67)
      expect(result.scores.overall).toBeGreaterThan(0);
      expect(result.scores.overall).toBeLessThanOrEqual(100);
    });

    /**
     * @behavior AutomatedEvaluator calculates pattern match percentage
     * @acceptance-criteria AC-EVAL.3
     */
    it('should calculate pattern match percentage', async () => {
      // GIVEN a task with 4 expected behaviors
      const task: BenchmarkTask = {
        id: 'percentage-task',
        name: 'Percentage Task',
        category: 'code-review',
        prompt: 'Review this code',
        expectedBehavior: ['alpha', 'beta', 'gamma', 'delta'],
      };

      // AND candidate output contains exactly 2 patterns
      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference',
        candidateOutput: 'This has ALPHA and BETA but not the others',
        provider: 'test-provider',
      };

      const evaluator = new AutomatedEvaluator();

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN score should be 50% (2/4 = 50)
      expect(result.scores.overall).toBe(50);
    });

    /**
     * @behavior AutomatedEvaluator handles empty or null outputs
     * @acceptance-criteria AC-EVAL.3
     */
    it('should handle empty or null outputs', async () => {
      // GIVEN a request with empty output
      const request: EvaluationRequest = {
        task: sampleTask,
        referenceOutput: 'Reference output',
        candidateOutput: '',
        provider: 'test-provider',
      };

      const evaluator = new AutomatedEvaluator();

      // WHEN evaluating empty output
      const result = await evaluator.evaluate(request);

      // THEN score should be 0
      expect(result.scores.overall).toBe(0);
      expect(result.scores.correctness).toBe(0);
    });

    /**
     * @behavior AutomatedEvaluator returns score 0-100 based on matches
     * @acceptance-criteria AC-EVAL.3
     */
    it('should return score 0-100 based on matches', async () => {
      // GIVEN a task with expected behaviors
      const task: BenchmarkTask = {
        id: 'full-match-task',
        name: 'Full Match Task',
        category: 'code-review',
        prompt: 'Review code',
        expectedBehavior: ['issue1', 'issue2', 'issue3'],
      };

      // AND output that matches all patterns
      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference',
        candidateOutput: 'Found issue1, issue2, and issue3 in the code',
        provider: 'test-provider',
      };

      const evaluator = new AutomatedEvaluator();

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN score should be 100 (all patterns matched)
      expect(result.scores.overall).toBe(100);
      expect(result.evaluatorType).toBe('automated');
    });
  });

  // ============================================================================
  // Task 3.4: Composite Evaluator
  // ============================================================================
  describe('CompositeEvaluator', () => {
    /**
     * @behavior CompositeEvaluator combines LLM judge score (70% weight)
     * @acceptance-criteria AC-EVAL.4
     */
    it('should combine LLM judge score (70% weight)', async () => {
      // GIVEN a successful LLM judge response with score 100
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                correctness: { score: 100, reasoning: 'Perfect' },
                completeness: { score: 100, reasoning: 'Complete' },
                style: { score: 100, reasoning: 'Great style' },
                efficiency: { score: 100, reasoning: 'Efficient' },
                overall: 100,
              }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      // AND a task where automated evaluator would give 0
      const task: BenchmarkTask = {
        id: 'weight-task',
        name: 'Weight Task',
        category: 'code-review',
        prompt: 'Review',
        expectedBehavior: ['xyz123'], // Unlikely to match
      };

      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference',
        candidateOutput: 'Some output without expected patterns',
        provider: 'test-provider',
      };

      const evaluator = new CompositeEvaluator({
        llmEvaluator: new LLMJudgeEvaluator({
          judgeEndpoint: 'http://localhost:3456/v1/messages',
        }),
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN score should be 70 (100 * 0.7 + 0 * 0.3)
      expect(result.scores.overall).toBe(70);
    });

    /**
     * @behavior CompositeEvaluator combines automated metrics (30% weight)
     * @acceptance-criteria AC-EVAL.4
     */
    it('should combine automated metrics (30% weight)', async () => {
      // GIVEN a failing LLM judge (returns 0)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Error',
      });

      // AND a task where automated evaluator gives 100
      const task: BenchmarkTask = {
        id: 'auto-weight-task',
        name: 'Auto Weight Task',
        category: 'code-review',
        prompt: 'Review',
        expectedBehavior: ['match1', 'match2'],
      };

      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference',
        candidateOutput: 'Output with match1 and match2 patterns',
        provider: 'test-provider',
      };

      const evaluator = new CompositeEvaluator({
        llmEvaluator: new LLMJudgeEvaluator({
          judgeEndpoint: 'http://localhost:3456/v1/messages',
        }),
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN score should be 30 (0 * 0.7 + 100 * 0.3)
      expect(result.scores.overall).toBe(30);
    });

    /**
     * @behavior CompositeEvaluator normalizes to 0-100 scale
     * @acceptance-criteria AC-EVAL.4
     */
    it('should normalize to 0-100 scale', async () => {
      // GIVEN both evaluators returning moderate scores
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
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      // AND task matching 50% of patterns
      const task: BenchmarkTask = {
        id: 'normalize-task',
        name: 'Normalize Task',
        category: 'code-review',
        prompt: 'Review',
        expectedBehavior: ['found', 'missing'],
      };

      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference',
        candidateOutput: 'Output with found pattern',
        provider: 'test-provider',
      };

      const evaluator = new CompositeEvaluator({
        llmEvaluator: new LLMJudgeEvaluator({
          judgeEndpoint: 'http://localhost:3456/v1/messages',
        }),
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN score should be normalized: 80 * 0.7 + 50 * 0.3 = 56 + 15 = 71
      expect(result.scores.overall).toBe(71);
      expect(result.scores.overall).toBeGreaterThanOrEqual(0);
      expect(result.scores.overall).toBeLessThanOrEqual(100);
      expect(result.evaluatorType).toBe('composite');
    });

    /**
     * @behavior CompositeEvaluator works with only automated metrics if LLM fails
     * @acceptance-criteria AC-EVAL.4
     */
    it('should work with only automated metrics if LLM fails', async () => {
      // GIVEN a completely failing LLM judge
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // AND a task with matchable patterns
      const task: BenchmarkTask = {
        id: 'fallback-task',
        name: 'Fallback Task',
        category: 'code-review',
        prompt: 'Review',
        expectedBehavior: ['pattern1', 'pattern2', 'pattern3', 'pattern4'],
      };

      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference',
        candidateOutput: 'This contains pattern1, pattern2, pattern3, and pattern4',
        provider: 'test-provider',
      };

      const evaluator = new CompositeEvaluator({
        llmEvaluator: new LLMJudgeEvaluator({
          judgeEndpoint: 'http://localhost:3456/v1/messages',
        }),
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN it should fall back to automated only: 100 * 0.3 = 30
      // (LLM gives 0, automated gives 100)
      expect(result.scores.overall).toBe(30);
      expect(result.evaluatorType).toBe('composite');
    });

    /**
     * @behavior CompositeEvaluator supports custom weights
     * @acceptance-criteria AC-EVAL.4
     */
    it('should support custom weights', async () => {
      // GIVEN an LLM judge returning 100
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                correctness: { score: 100, reasoning: 'Perfect' },
                completeness: { score: 100, reasoning: 'Complete' },
                style: { score: 100, reasoning: 'Great' },
                efficiency: { score: 100, reasoning: 'Efficient' },
                overall: 100,
              }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 100 },
        }),
      });

      // AND a task where automated gives 0
      const task: BenchmarkTask = {
        id: 'custom-weight-task',
        name: 'Custom Weight Task',
        category: 'code-review',
        prompt: 'Review',
        expectedBehavior: ['nonexistent'],
      };

      const request: EvaluationRequest = {
        task,
        referenceOutput: 'Reference',
        candidateOutput: 'No matches here',
        provider: 'test-provider',
      };

      // AND a composite evaluator with custom weights (50/50)
      const evaluator = new CompositeEvaluator({
        llmWeight: 0.5,
        automatedWeight: 0.5,
        llmEvaluator: new LLMJudgeEvaluator({
          judgeEndpoint: 'http://localhost:3456/v1/messages',
        }),
      });

      // WHEN evaluating
      const result = await evaluator.evaluate(request);

      // THEN score should reflect custom weights: 100 * 0.5 + 0 * 0.5 = 50
      expect(result.scores.overall).toBe(50);
    });
  });
});
