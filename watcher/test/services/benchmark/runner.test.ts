/**
 * @file Benchmark Runner Tests
 * @behavior BenchmarkRunner executes tasks through different providers and collects metrics
 * @acceptance-criteria AC-RUNNER.1 through AC-RUNNER.4
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BenchmarkRunner } from '../../../src/services/benchmark/runner.js';
import { CostTracker } from '../../../src/services/cost-tracker.js';
import type { BenchmarkTask } from '../../../src/services/benchmark/types.js';
import type { ProviderConfig, BenchmarkRunnerConfig } from '../../../src/services/benchmark/runner.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock fs module for file system operations
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

describe('BenchmarkRunner', () => {
  let mockCostTracker: CostTracker;
  let testTasks: BenchmarkTask[];
  let testProviders: ProviderConfig[];

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock CostTracker
    mockCostTracker = {
      recordUsage: vi.fn(),
      getStats: vi.fn().mockReturnValue({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCostUsd: 0,
        requests: 0,
      }),
      flush: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    } as unknown as CostTracker;

    // Sample tasks for testing
    testTasks = [
      {
        id: 'test-task-01',
        name: 'Test Task 1',
        category: 'code-review',
        prompt: 'Review this code for issues',
        expectedBehavior: ['identify issues'],
      },
    ];

    // Sample providers for testing
    testProviders = [
      {
        name: 'claude',
        model: 'claude-3-sonnet',
        isBaseline: true,
      },
      {
        name: 'ollama',
        model: 'ollama/qwen2.5-coder:7b',
        baseUrl: 'http://localhost:3456',
      },
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    /**
     * @behavior BenchmarkRunner accepts list of providers to benchmark
     * @acceptance-criteria AC-RUNNER.1
     */
    it('should accept list of providers to benchmark', () => {
      // GIVEN a list of providers
      const providers: ProviderConfig[] = [
        { name: 'claude', model: 'claude-3-sonnet', isBaseline: true },
        { name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' },
      ];

      // WHEN creating a BenchmarkRunner
      const runner = new BenchmarkRunner({
        providers,
        tasks: testTasks,
      });

      // THEN the runner should store the providers
      expect(runner.getProviders()).toHaveLength(2);
      expect(runner.getProviders()[0].name).toBe('claude');
      expect(runner.getProviders()[1].name).toBe('ollama');
    });

    /**
     * @behavior BenchmarkRunner accepts benchmark tasks to run
     * @acceptance-criteria AC-RUNNER.1
     */
    it('should accept benchmark tasks to run', () => {
      // GIVEN benchmark tasks
      const tasks: BenchmarkTask[] = [
        {
          id: 'task-1',
          name: 'Task 1',
          category: 'code-review',
          prompt: 'Review this',
          expectedBehavior: ['issue found'],
        },
        {
          id: 'task-2',
          name: 'Task 2',
          category: 'bug-fix',
          prompt: 'Fix this',
          expectedBehavior: ['bug fixed'],
        },
      ];

      // WHEN creating a BenchmarkRunner
      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks,
      });

      // THEN the runner should store the tasks
      expect(runner.getTasks()).toHaveLength(2);
      expect(runner.getTasks()[0].id).toBe('task-1');
      expect(runner.getTasks()[1].id).toBe('task-2');
    });

    /**
     * @behavior BenchmarkRunner accepts CostTracker instance for cost tracking
     * @acceptance-criteria AC-RUNNER.1
     */
    it('should accept CostTracker instance for cost tracking', () => {
      // GIVEN a CostTracker instance
      const costTracker = mockCostTracker;

      // WHEN creating a BenchmarkRunner with the cost tracker
      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks: testTasks,
        costTracker,
      });

      // THEN the runner should store the cost tracker
      expect(runner.getCostTracker()).toBe(costTracker);
    });

    /**
     * @behavior BenchmarkRunner accepts optional timeout per request
     * @acceptance-criteria AC-RUNNER.1
     */
    it('should accept optional timeout per request', () => {
      // GIVEN a custom timeout
      const timeout = 30000;

      // WHEN creating a BenchmarkRunner with custom timeout
      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks: testTasks,
        timeout,
      });

      // THEN the runner should use the custom timeout
      expect(runner.getTimeout()).toBe(30000);
    });

    it('should use default timeout of 60000ms when not specified', () => {
      // WHEN creating a BenchmarkRunner without timeout
      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks: testTasks,
      });

      // THEN the default timeout should be 60000ms
      expect(runner.getTimeout()).toBe(60000);
    });
  });

  describe('runTask()', () => {
    /**
     * @behavior BenchmarkRunner sends task prompt to provider via HTTP
     * @acceptance-criteria AC-RUNNER.2
     */
    it('should send task prompt to provider via HTTP', async () => {
      // GIVEN a runner and a successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Review complete: found 2 issues' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks: testTasks,
      });

      const provider: ProviderConfig = {
        name: 'ollama',
        model: 'ollama/qwen2.5-coder:7b',
        baseUrl: 'http://localhost:3456',
      };

      const task: BenchmarkTask = {
        id: 'test-task',
        name: 'Test',
        category: 'code-review',
        prompt: 'Review this code',
        expectedBehavior: ['issues'],
      };

      // WHEN running a task
      await runner.runTask(task, provider);

      // THEN fetch should be called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3456/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('Review this code'),
        })
      );
    });

    /**
     * @behavior BenchmarkRunner captures input/output tokens from response
     * @acceptance-criteria AC-RUNNER.2
     */
    it('should capture input/output tokens from response', async () => {
      // GIVEN a runner and API response with token counts
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Review complete' }],
          usage: { input_tokens: 150, output_tokens: 75 },
        }),
      });

      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks: testTasks,
      });

      const provider: ProviderConfig = {
        name: 'ollama',
        model: 'ollama/qwen2.5-coder:7b',
        baseUrl: 'http://localhost:3456',
      };

      // WHEN running a task
      const result = await runner.runTask(testTasks[0], provider);

      // THEN the result should contain token counts
      expect(result.inputTokens).toBe(150);
      expect(result.outputTokens).toBe(75);
    });

    /**
     * @behavior BenchmarkRunner captures latency (total time)
     * @acceptance-criteria AC-RUNNER.2
     */
    it('should capture latency (total time)', async () => {
      // GIVEN a runner and a delayed API response
      mockFetch.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          json: async () => ({
            content: [{ text: 'Done' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        };
      });

      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks: testTasks,
      });

      const provider: ProviderConfig = {
        name: 'ollama',
        model: 'ollama/qwen2.5-coder:7b',
        baseUrl: 'http://localhost:3456',
      };

      // WHEN running a task
      const result = await runner.runTask(testTasks[0], provider);

      // THEN the result should contain latency >= 50ms
      expect(result.latencyMs).toBeGreaterThanOrEqual(50);
    });

    /**
     * @behavior BenchmarkRunner handles provider errors gracefully
     * @acceptance-criteria AC-RUNNER.2
     */
    it('should handle provider errors gracefully', async () => {
      // GIVEN a runner and a failing API response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const runner = new BenchmarkRunner({
        providers: testProviders,
        tasks: testTasks,
      });

      const provider: ProviderConfig = {
        name: 'ollama',
        model: 'ollama/qwen2.5-coder:7b',
        baseUrl: 'http://localhost:3456',
      };

      // WHEN running a task that fails
      const result = await runner.runTask(testTasks[0], provider);

      // THEN the result should contain error information
      expect(result.output).toContain('Error');
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });
  });

  describe('runBenchmark()', () => {
    /**
     * @behavior BenchmarkRunner runs all tasks through all providers
     * @acceptance-criteria AC-RUNNER.3
     */
    it('should run all tasks through all providers', async () => {
      // GIVEN a runner with multiple tasks and providers
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Done' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const tasks: BenchmarkTask[] = [
        {
          id: 'task-1',
          name: 'Task 1',
          category: 'code-review',
          prompt: 'Review',
          expectedBehavior: ['done'],
        },
        {
          id: 'task-2',
          name: 'Task 2',
          category: 'bug-fix',
          prompt: 'Fix',
          expectedBehavior: ['fixed'],
        },
      ];

      const providers: ProviderConfig[] = [
        { name: 'claude', model: 'claude-3-sonnet', isBaseline: true, baseUrl: 'http://localhost:3456' },
        { name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' },
      ];

      const runner = new BenchmarkRunner({
        providers,
        tasks,
      });

      // WHEN running the full benchmark
      const benchmarkRun = await runner.runBenchmark();

      // THEN all tasks should be run through all providers (2 tasks x 2 providers = 4 calls)
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(benchmarkRun.results.get('claude')).toHaveLength(2);
      expect(benchmarkRun.results.get('ollama')).toHaveLength(2);
    });

    /**
     * @behavior BenchmarkRunner runs baseline provider first (claude)
     * @acceptance-criteria AC-RUNNER.3
     */
    it('should run baseline provider first (claude)', async () => {
      // GIVEN a runner with baseline and non-baseline providers
      const callOrder: string[] = [];
      mockFetch.mockImplementation(async (url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string);
        // Track which model was called
        if (body.model) {
          callOrder.push(body.model);
        }
        return {
          ok: true,
          json: async () => ({
            content: [{ text: 'Done' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        };
      });

      const providers: ProviderConfig[] = [
        { name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' },
        { name: 'claude', model: 'claude-3-sonnet', isBaseline: true, baseUrl: 'http://localhost:3456' },
      ];

      const runner = new BenchmarkRunner({
        providers,
        tasks: testTasks,
      });

      // WHEN running the benchmark
      await runner.runBenchmark();

      // THEN baseline (claude) should be called first
      expect(callOrder[0]).toBe('claude-3-sonnet');
    });

    /**
     * @behavior BenchmarkRunner aggregates results by provider
     * @acceptance-criteria AC-RUNNER.3
     */
    it('should aggregate results by provider', async () => {
      // GIVEN a runner with multiple providers
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Done' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const runner = new BenchmarkRunner({
        providers: [
          { name: 'claude', model: 'claude-3-sonnet', isBaseline: true, baseUrl: 'http://localhost:3456' },
          { name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' },
        ],
        tasks: testTasks,
      });

      // WHEN running the benchmark
      const benchmarkRun = await runner.runBenchmark();

      // THEN results should be grouped by provider
      expect(benchmarkRun.results.has('claude')).toBe(true);
      expect(benchmarkRun.results.has('ollama')).toBe(true);
      expect(benchmarkRun.results.get('claude')?.[0].provider).toBe('claude');
      expect(benchmarkRun.results.get('ollama')?.[0].provider).toBe('ollama');
    });

    /**
     * @behavior BenchmarkRunner supports sequential execution to avoid rate limits
     * @acceptance-criteria AC-RUNNER.3
     */
    it('should support sequential execution to avoid rate limits', async () => {
      // GIVEN a runner configured for sequential execution
      const callTimestamps: number[] = [];
      mockFetch.mockImplementation(async () => {
        callTimestamps.push(Date.now());
        return {
          ok: true,
          json: async () => ({
            content: [{ text: 'Done' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        };
      });

      const tasks: BenchmarkTask[] = [
        { id: 'task-1', name: 'Task 1', category: 'code-review', prompt: 'Review', expectedBehavior: ['done'] },
        { id: 'task-2', name: 'Task 2', category: 'bug-fix', prompt: 'Fix', expectedBehavior: ['fixed'] },
      ];

      const runner = new BenchmarkRunner({
        providers: [{ name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' }],
        tasks,
      });

      // WHEN running the benchmark sequentially
      await runner.runBenchmark({ sequential: true });

      // THEN calls should be made sequentially (each after the previous completes)
      // Verify by checking that we have the expected number of calls
      expect(callTimestamps.length).toBe(2);
    });
  });

  describe('result storage', () => {
    /**
     * @behavior BenchmarkRunner stores raw outputs for quality evaluation
     * @acceptance-criteria AC-RUNNER.4
     */
    it('should store raw outputs for quality evaluation', async () => {
      // GIVEN a runner with successful responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Found 3 issues in the code' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const runner = new BenchmarkRunner({
        providers: [{ name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' }],
        tasks: testTasks,
      });

      // WHEN running the benchmark
      const benchmarkRun = await runner.runBenchmark();

      // THEN raw outputs should be stored in results
      const results = benchmarkRun.results.get('ollama');
      expect(results?.[0].output).toBe('Found 3 issues in the code');
    });

    /**
     * @behavior BenchmarkRunner stores token counts per task per provider
     * @acceptance-criteria AC-RUNNER.4
     */
    it('should store token counts per task per provider', async () => {
      // GIVEN a runner with responses containing token counts
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Done' }],
          usage: { input_tokens: 200, output_tokens: 100 },
        }),
      });

      const runner = new BenchmarkRunner({
        providers: [{ name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' }],
        tasks: testTasks,
      });

      // WHEN running the benchmark
      const benchmarkRun = await runner.runBenchmark();

      // THEN token counts should be stored per result
      const results = benchmarkRun.results.get('ollama');
      expect(results?.[0].inputTokens).toBe(200);
      expect(results?.[0].outputTokens).toBe(100);
    });

    /**
     * @behavior BenchmarkRunner stores latency metrics
     * @acceptance-criteria AC-RUNNER.4
     */
    it('should store latency metrics', async () => {
      // GIVEN a runner with responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Done' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const runner = new BenchmarkRunner({
        providers: [{ name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' }],
        tasks: testTasks,
      });

      // WHEN running the benchmark
      const benchmarkRun = await runner.runBenchmark();

      // THEN latency should be stored
      const results = benchmarkRun.results.get('ollama');
      expect(results?.[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    /**
     * @behavior BenchmarkRunner persists results to .oss/benchmarks/{date}.json
     * @acceptance-criteria AC-RUNNER.4
     */
    it('should persist results to .oss/benchmarks/{date}.json', async () => {
      // GIVEN a runner configured with output directory
      const fs = await import('fs');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Done' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const runner = new BenchmarkRunner({
        providers: [{ name: 'ollama', model: 'ollama/qwen2.5-coder:7b', baseUrl: 'http://localhost:3456' }],
        tasks: testTasks,
        outputDir: '/tmp/.oss/benchmarks',
      });

      // WHEN running the benchmark and saving
      const benchmarkRun = await runner.runBenchmark();
      await runner.saveResults(benchmarkRun);

      // THEN results should be written to file
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toContain('benchmarks');
      expect(writeCall[0]).toContain('.json');
    });
  });
});
