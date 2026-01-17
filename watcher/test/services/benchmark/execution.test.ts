/**
 * @file Benchmark Execution Tests - Phase 3
 * @description Tests for benchmark execution across providers with structured result storage
 *
 * @behavior BenchmarkExecutor runs tasks across all providers and stores structured results
 * @acceptance-criteria AC-EXEC.1 through AC-EXEC.9
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  BenchmarkExecutor,
  ExecutionResult,
  BenchmarkSuiteResult,
} from '../../../src/services/benchmark/execution.js';
import { BenchmarkRunner, ProviderConfig } from '../../../src/services/benchmark/runner.js';
import type { BenchmarkTask, BenchmarkResult } from '../../../src/services/benchmark/types.js';
import { LLMJudgeEvaluator, CompositeEvaluator, EvaluationResult } from '../../../src/services/benchmark/evaluator.js';

// Mock the BenchmarkRunner
vi.mock('../../../src/services/benchmark/runner.js', () => ({
  BenchmarkRunner: vi.fn(),
}));

// Mock the evaluators
vi.mock('../../../src/services/benchmark/evaluator.js', () => ({
  LLMJudgeEvaluator: vi.fn(),
  CompositeEvaluator: vi.fn(),
  AutomatedEvaluator: vi.fn(),
  EVALUATION_PROMPT: 'mock prompt',
}));

describe('Benchmark Execution - Phase 3', () => {
  let mockRunner: {
    runTask: ReturnType<typeof vi.fn>;
    runBenchmark: ReturnType<typeof vi.fn>;
    getProviders: ReturnType<typeof vi.fn>;
    getTasks: ReturnType<typeof vi.fn>;
  };
  let mockLLMEvaluator: {
    evaluate: ReturnType<typeof vi.fn>;
  };
  let mockCompositeEvaluator: {
    evaluate: ReturnType<typeof vi.fn>;
  };

  const codeReviewTask: BenchmarkTask = {
    id: 'code-review-01',
    name: 'Review function for issues',
    category: 'code-review',
    prompt: 'Review this function and identify issues',
    expectedBehavior: ['undeclared variable', 'var instead of const/let'],
    timeout: 30000,
  };

  const bugFixTask: BenchmarkTask = {
    id: 'bug-fix-01',
    name: 'Fix off-by-one error',
    category: 'bug-fix',
    prompt: 'Fix the bug',
    expectedBehavior: ['slice(arr.length - n)'],
    timeout: 30000,
  };

  const testWritingTask: BenchmarkTask = {
    id: 'test-writing-01',
    name: 'Write tests for add function',
    category: 'test-writing',
    prompt: 'Write unit tests',
    expectedBehavior: ['positive numbers', 'negative numbers'],
    timeout: 30000,
  };

  const refactoringTask: BenchmarkTask = {
    id: 'refactor-01',
    name: 'Extract method from complex function',
    category: 'refactoring',
    prompt: 'Refactor for readability',
    expectedBehavior: ['extract validation', 'single responsibility'],
    timeout: 30000,
  };

  const standardTasks: BenchmarkTask[] = [codeReviewTask, bugFixTask, testWritingTask, refactoringTask];

  const claudeProvider: ProviderConfig = {
    name: 'claude',
    model: 'claude-3-sonnet',
    isBaseline: true,
    baseUrl: 'https://api.anthropic.com',
  };

  const ollamaProvider: ProviderConfig = {
    name: 'ollama',
    model: 'ollama/qwen2.5-coder:7b',
    baseUrl: 'http://localhost:3456',
  };

  const openrouterProvider: ProviderConfig = {
    name: 'openrouter',
    model: 'openrouter/deepseek-coder',
    baseUrl: 'https://openrouter.ai/api',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock runner
    mockRunner = {
      runTask: vi.fn(),
      runBenchmark: vi.fn(),
      getProviders: vi.fn().mockReturnValue([claudeProvider, ollamaProvider, openrouterProvider]),
      getTasks: vi.fn().mockReturnValue(standardTasks),
    };

    vi.mocked(BenchmarkRunner).mockImplementation(() => mockRunner as unknown as BenchmarkRunner);

    // Setup mock LLM evaluator
    mockLLMEvaluator = {
      evaluate: vi.fn(),
    };
    vi.mocked(LLMJudgeEvaluator).mockImplementation(() => mockLLMEvaluator as unknown as LLMJudgeEvaluator);

    // Setup mock composite evaluator
    mockCompositeEvaluator = {
      evaluate: vi.fn(),
    };
    vi.mocked(CompositeEvaluator).mockImplementation(() => mockCompositeEvaluator as unknown as CompositeEvaluator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 3.1: Single task execution', () => {
    /**
     * @behavior BenchmarkExecutor executes code-review task on all providers
     * @acceptance-criteria AC-EXEC.1
     * @business-rule Run the same task across all configured providers for comparison
     */
    it('should execute code-review task on all providers', async () => {
      // GIVEN a BenchmarkExecutor with 3 providers configured
      const providers = [claudeProvider, ollamaProvider, openrouterProvider];
      const executor = new BenchmarkExecutor({ providers, tasks: [codeReviewTask] });

      // Mock successful responses from each provider
      mockRunner.runTask
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'claude',
          model: 'claude-3-sonnet',
          output: 'Found 2 issues: undeclared variable and var usage',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 500,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult)
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'ollama',
          model: 'ollama/qwen2.5-coder:7b',
          output: 'Issues found: var should be const/let',
          inputTokens: 100,
          outputTokens: 45,
          latencyMs: 800,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult)
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'openrouter',
          model: 'openrouter/deepseek-coder',
          output: 'Code review: found undeclared variable',
          inputTokens: 100,
          outputTokens: 40,
          latencyMs: 600,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult);

      // WHEN executing single task across all providers
      const result = await executor.executeSingleTask(codeReviewTask);

      // THEN all 3 providers should have been called
      expect(mockRunner.runTask).toHaveBeenCalledTimes(3);
      expect(result.taskId).toBe('code-review-01');
      expect(result.providerResults).toHaveLength(3);
      expect(result.providerResults.map((r) => r.provider)).toEqual(['claude', 'ollama', 'openrouter']);
    });

    /**
     * @behavior BenchmarkExecutor captures output, tokens, and latency for each provider
     * @acceptance-criteria AC-EXEC.2
     * @business-rule All metrics needed for comparison must be captured
     */
    it('should capture output, tokens, and latency for each', async () => {
      // GIVEN a BenchmarkExecutor
      const executor = new BenchmarkExecutor({ providers: [claudeProvider, ollamaProvider], tasks: [codeReviewTask] });

      // Mock responses with specific metrics
      mockRunner.runTask
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'claude',
          model: 'claude-3-sonnet',
          output: 'Claude output: found issues',
          inputTokens: 150,
          outputTokens: 75,
          latencyMs: 450,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult)
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'ollama',
          model: 'ollama/qwen2.5-coder:7b',
          output: 'Ollama output: found issues',
          inputTokens: 150,
          outputTokens: 60,
          latencyMs: 900,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult);

      // WHEN executing single task
      const result = await executor.executeSingleTask(codeReviewTask);

      // THEN each provider result should have output, tokens, and latency
      const claudeResult = result.providerResults.find((r) => r.provider === 'claude');
      const ollamaResult = result.providerResults.find((r) => r.provider === 'ollama');

      expect(claudeResult).toBeDefined();
      expect(claudeResult?.output).toBe('Claude output: found issues');
      expect(claudeResult?.inputTokens).toBe(150);
      expect(claudeResult?.outputTokens).toBe(75);
      expect(claudeResult?.latencyMs).toBe(450);

      expect(ollamaResult).toBeDefined();
      expect(ollamaResult?.output).toBe('Ollama output: found issues');
      expect(ollamaResult?.inputTokens).toBe(150);
      expect(ollamaResult?.outputTokens).toBe(60);
      expect(ollamaResult?.latencyMs).toBe(900);
    });

    /**
     * @behavior BenchmarkExecutor stores results in structured format
     * @acceptance-criteria AC-EXEC.3
     * @business-rule Results must be structured for easy comparison and persistence
     */
    it('should store results in structured format', async () => {
      // GIVEN a BenchmarkExecutor
      const executor = new BenchmarkExecutor({
        providers: [claudeProvider, ollamaProvider],
        tasks: [codeReviewTask],
      });

      // Mock responses
      mockRunner.runTask
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'claude',
          model: 'claude-3-sonnet',
          output: 'Claude baseline output',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 500,
          timestamp: '2024-01-15T10:00:00.000Z',
        } satisfies BenchmarkResult)
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'ollama',
          model: 'ollama/qwen2.5-coder:7b',
          output: 'Ollama output',
          inputTokens: 100,
          outputTokens: 45,
          latencyMs: 800,
          timestamp: '2024-01-15T10:00:01.000Z',
        } satisfies BenchmarkResult);

      // WHEN executing single task
      const result = await executor.executeSingleTask(codeReviewTask);

      // THEN result should be structured with ExecutionResult type
      expect(result).toMatchObject({
        taskId: 'code-review-01',
        taskName: 'Review function for issues',
        category: 'code-review',
        providerResults: expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude',
            model: 'claude-3-sonnet',
            output: expect.any(String),
            inputTokens: expect.any(Number),
            outputTokens: expect.any(Number),
            latencyMs: expect.any(Number),
            timestamp: expect.any(String),
          }),
          expect.objectContaining({
            provider: 'ollama',
            model: 'ollama/qwen2.5-coder:7b',
          }),
        ]),
        baselineProvider: 'claude',
        executedAt: expect.any(String),
      } satisfies Partial<ExecutionResult>);
    });
  });

  describe('Task 3.2: Full benchmark suite', () => {
    /**
     * @behavior BenchmarkExecutor runs all 4 standard tasks
     * @acceptance-criteria AC-EXEC.4
     * @business-rule All standard benchmark tasks must be executed
     */
    it('should run all 4 standard tasks (code-review, bug-fix, test-writing, refactor)', async () => {
      // GIVEN a BenchmarkExecutor with 4 standard tasks
      const executor = new BenchmarkExecutor({
        providers: [claudeProvider, ollamaProvider],
        tasks: standardTasks,
      });

      // Mock runner.runBenchmark to return results for all tasks
      const mockResults = new Map<string, BenchmarkResult[]>();
      mockResults.set('claude', [
        { taskId: 'code-review-01', provider: 'claude', model: 'claude-3-sonnet', output: 'output1', inputTokens: 100, outputTokens: 50, latencyMs: 500, timestamp: new Date().toISOString() },
        { taskId: 'bug-fix-01', provider: 'claude', model: 'claude-3-sonnet', output: 'output2', inputTokens: 100, outputTokens: 50, latencyMs: 500, timestamp: new Date().toISOString() },
        { taskId: 'test-writing-01', provider: 'claude', model: 'claude-3-sonnet', output: 'output3', inputTokens: 100, outputTokens: 50, latencyMs: 500, timestamp: new Date().toISOString() },
        { taskId: 'refactor-01', provider: 'claude', model: 'claude-3-sonnet', output: 'output4', inputTokens: 100, outputTokens: 50, latencyMs: 500, timestamp: new Date().toISOString() },
      ]);
      mockResults.set('ollama', [
        { taskId: 'code-review-01', provider: 'ollama', model: 'ollama/qwen2.5-coder:7b', output: 'output1', inputTokens: 100, outputTokens: 50, latencyMs: 800, timestamp: new Date().toISOString() },
        { taskId: 'bug-fix-01', provider: 'ollama', model: 'ollama/qwen2.5-coder:7b', output: 'output2', inputTokens: 100, outputTokens: 50, latencyMs: 800, timestamp: new Date().toISOString() },
        { taskId: 'test-writing-01', provider: 'ollama', model: 'ollama/qwen2.5-coder:7b', output: 'output3', inputTokens: 100, outputTokens: 50, latencyMs: 800, timestamp: new Date().toISOString() },
        { taskId: 'refactor-01', provider: 'ollama', model: 'ollama/qwen2.5-coder:7b', output: 'output4', inputTokens: 100, outputTokens: 50, latencyMs: 800, timestamp: new Date().toISOString() },
      ]);

      mockRunner.runBenchmark.mockResolvedValue({
        id: 'benchmark-run-1',
        timestamp: new Date().toISOString(),
        tasks: standardTasks,
        results: mockResults,
      });

      // WHEN running full benchmark suite
      const result = await executor.runFullBenchmark();

      // THEN all 4 task categories should be present in results
      expect(result.taskResults).toHaveLength(4);
      const categories = result.taskResults.map((r) => r.category);
      expect(categories).toContain('code-review');
      expect(categories).toContain('bug-fix');
      expect(categories).toContain('test-writing');
      expect(categories).toContain('refactoring');
    });

    /**
     * @behavior BenchmarkExecutor runs Claude first as baseline
     * @acceptance-criteria AC-EXEC.5
     * @business-rule Claude output serves as the reference for quality comparison
     */
    it('should run Claude first as baseline', async () => {
      // GIVEN a BenchmarkExecutor with Claude and other providers
      const executor = new BenchmarkExecutor({
        providers: [ollamaProvider, claudeProvider, openrouterProvider], // Claude not first in array
        tasks: [codeReviewTask],
      });

      const callOrder: string[] = [];
      mockRunner.runTask.mockImplementation(async (_task: BenchmarkTask, provider: ProviderConfig) => {
        callOrder.push(provider.name);
        return {
          taskId: 'code-review-01',
          provider: provider.name,
          model: provider.model,
          output: 'output',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 500,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult;
      });

      // WHEN executing single task
      await executor.executeSingleTask(codeReviewTask);

      // THEN Claude (baseline) should be called first
      expect(callOrder[0]).toBe('claude');
    });

    /**
     * @behavior BenchmarkExecutor aggregates results by provider
     * @acceptance-criteria AC-EXEC.6
     * @business-rule Results must be easily comparable across providers
     */
    it('should aggregate results by provider', async () => {
      // GIVEN a BenchmarkExecutor with multiple providers and tasks
      const executor = new BenchmarkExecutor({
        providers: [claudeProvider, ollamaProvider],
        tasks: standardTasks,
      });

      // Mock full benchmark results
      const mockResults = new Map<string, BenchmarkResult[]>();
      mockResults.set('claude', standardTasks.map((t) => ({
        taskId: t.id,
        provider: 'claude',
        model: 'claude-3-sonnet',
        output: `claude-${t.id}`,
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 500,
        timestamp: new Date().toISOString(),
      })));
      mockResults.set('ollama', standardTasks.map((t) => ({
        taskId: t.id,
        provider: 'ollama',
        model: 'ollama/qwen2.5-coder:7b',
        output: `ollama-${t.id}`,
        inputTokens: 100,
        outputTokens: 45,
        latencyMs: 800,
        timestamp: new Date().toISOString(),
      })));

      mockRunner.runBenchmark.mockResolvedValue({
        id: 'benchmark-run-1',
        timestamp: new Date().toISOString(),
        tasks: standardTasks,
        results: mockResults,
      });

      // WHEN running full benchmark
      const result = await executor.runFullBenchmark();

      // THEN results should be aggregated by provider
      expect(result.providerSummaries).toBeDefined();
      expect(result.providerSummaries).toHaveLength(2);

      const claudeSummary = result.providerSummaries.find((s) => s.provider === 'claude');
      const ollamaSummary = result.providerSummaries.find((s) => s.provider === 'ollama');

      expect(claudeSummary).toBeDefined();
      expect(claudeSummary?.tasksCompleted).toBe(4);
      expect(claudeSummary?.totalTokens).toBeGreaterThan(0);
      expect(claudeSummary?.avgLatencyMs).toBeGreaterThan(0);

      expect(ollamaSummary).toBeDefined();
      expect(ollamaSummary?.tasksCompleted).toBe(4);
    });
  });

  describe('Task 3.3: Quality evaluation', () => {
    /**
     * @behavior BenchmarkExecutor uses Claude to score Ollama outputs vs baseline
     * @acceptance-criteria AC-EXEC.7
     * @business-rule Ollama outputs must be evaluated against Claude baseline
     */
    it('should use Claude to score Ollama outputs vs baseline', async () => {
      // GIVEN a BenchmarkExecutor with evaluation enabled
      const executor = new BenchmarkExecutor({
        providers: [claudeProvider, ollamaProvider],
        tasks: [codeReviewTask],
        enableEvaluation: true,
      });

      // Mock task execution results
      mockRunner.runTask
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'claude',
          model: 'claude-3-sonnet',
          output: 'Claude baseline: found undeclared variable and var usage',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 500,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult)
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'ollama',
          model: 'ollama/qwen2.5-coder:7b',
          output: 'Ollama: found var usage issue',
          inputTokens: 100,
          outputTokens: 45,
          latencyMs: 800,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult);

      // Mock LLM evaluator to score Ollama vs Claude
      mockLLMEvaluator.evaluate.mockResolvedValue({
        taskId: 'code-review-01',
        provider: 'ollama',
        scores: {
          correctness: 75,
          completeness: 60,
          style: 80,
          efficiency: 70,
          overall: 72,
        },
        evaluatedAt: new Date().toISOString(),
        evaluatorType: 'llm',
      } satisfies EvaluationResult);

      // WHEN executing with evaluation
      const result = await executor.executeSingleTask(codeReviewTask);

      // THEN LLM evaluator should be called to compare Ollama vs Claude baseline
      expect(mockLLMEvaluator.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          task: codeReviewTask,
          referenceOutput: expect.stringContaining('Claude baseline'),
          candidateOutput: expect.stringContaining('Ollama'),
          provider: 'ollama',
        })
      );

      // AND Ollama result should have scores
      const ollamaResult = result.providerResults.find((r) => r.provider === 'ollama');
      expect(ollamaResult?.scores).toBeDefined();
      expect(ollamaResult?.scores?.overall).toBe(72);
    });

    /**
     * @behavior BenchmarkExecutor uses Claude to score OpenRouter outputs vs baseline
     * @acceptance-criteria AC-EXEC.8
     * @business-rule OpenRouter outputs must be evaluated against Claude baseline
     */
    it('should use Claude to score OpenRouter outputs vs baseline', async () => {
      // GIVEN a BenchmarkExecutor with evaluation enabled
      const executor = new BenchmarkExecutor({
        providers: [claudeProvider, openrouterProvider],
        tasks: [codeReviewTask],
        enableEvaluation: true,
      });

      // Mock task execution results
      mockRunner.runTask
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'claude',
          model: 'claude-3-sonnet',
          output: 'Claude baseline: comprehensive review',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 500,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult)
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'openrouter',
          model: 'openrouter/deepseek-coder',
          output: 'OpenRouter: found some issues',
          inputTokens: 100,
          outputTokens: 40,
          latencyMs: 600,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult);

      // Mock LLM evaluator to score OpenRouter vs Claude
      mockLLMEvaluator.evaluate.mockResolvedValue({
        taskId: 'code-review-01',
        provider: 'openrouter',
        scores: {
          correctness: 80,
          completeness: 70,
          style: 85,
          efficiency: 75,
          overall: 78,
        },
        evaluatedAt: new Date().toISOString(),
        evaluatorType: 'llm',
      } satisfies EvaluationResult);

      // WHEN executing with evaluation
      const result = await executor.executeSingleTask(codeReviewTask);

      // THEN LLM evaluator should be called to compare OpenRouter vs Claude baseline
      expect(mockLLMEvaluator.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          task: codeReviewTask,
          referenceOutput: expect.stringContaining('Claude baseline'),
          candidateOutput: expect.stringContaining('OpenRouter'),
          provider: 'openrouter',
        })
      );

      // AND OpenRouter result should have scores
      const openrouterResult = result.providerResults.find((r) => r.provider === 'openrouter');
      expect(openrouterResult?.scores).toBeDefined();
      expect(openrouterResult?.scores?.overall).toBe(78);
    });

    /**
     * @behavior BenchmarkExecutor calculates composite scores (70% LLM + 30% automated)
     * @acceptance-criteria AC-EXEC.9
     * @business-rule Composite scoring provides balanced quality assessment
     */
    it('should calculate composite scores (70% LLM + 30% automated)', async () => {
      // GIVEN a BenchmarkExecutor with composite evaluation
      const executor = new BenchmarkExecutor({
        providers: [claudeProvider, ollamaProvider],
        tasks: [codeReviewTask],
        enableEvaluation: true,
        useCompositeScoring: true,
      });

      // Mock task execution results
      mockRunner.runTask
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'claude',
          model: 'claude-3-sonnet',
          output: 'Claude: undeclared variable found',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 500,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult)
        .mockResolvedValueOnce({
          taskId: 'code-review-01',
          provider: 'ollama',
          model: 'ollama/qwen2.5-coder:7b',
          output: 'Ollama: undeclared variable, var instead of const/let',
          inputTokens: 100,
          outputTokens: 45,
          latencyMs: 800,
          timestamp: new Date().toISOString(),
        } satisfies BenchmarkResult);

      // Mock composite evaluator with 70/30 weights
      mockCompositeEvaluator.evaluate.mockResolvedValue({
        taskId: 'code-review-01',
        provider: 'ollama',
        scores: {
          correctness: 79, // 70 * 0.7 + 100 * 0.3 = 79
          completeness: 79,
          style: 79,
          efficiency: 79,
          overall: 79,
        },
        evaluatedAt: new Date().toISOString(),
        evaluatorType: 'composite',
      } satisfies EvaluationResult);

      // WHEN executing with composite evaluation
      const result = await executor.executeSingleTask(codeReviewTask);

      // THEN composite evaluator should be used
      expect(mockCompositeEvaluator.evaluate).toHaveBeenCalled();

      // AND result should have composite scores
      const ollamaResult = result.providerResults.find((r) => r.provider === 'ollama');
      expect(ollamaResult?.scores).toBeDefined();
      expect(ollamaResult?.scores?.overall).toBe(79);
      expect(ollamaResult?.evaluationType).toBe('composite');
    });
  });
});
