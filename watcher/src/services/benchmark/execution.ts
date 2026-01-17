/**
 * @file Benchmark Execution
 * @description Orchestrates benchmark execution across providers with structured result storage
 *
 * @behavior BenchmarkExecutor runs tasks across all providers and stores structured results
 * @acceptance-criteria AC-EXEC.1 through AC-EXEC.9
 */

import { BenchmarkRunner, ProviderConfig, BenchmarkRun } from './runner.js';
import type { BenchmarkTask, BenchmarkResult, QualityScores } from './types.js';
import { LLMJudgeEvaluator, CompositeEvaluator, EvaluationRequest } from './evaluator.js';

/**
 * Result from executing a single task across all providers
 */
export interface ExecutionResult {
  /** ID of the task that was executed */
  taskId: string;
  /** Name of the task */
  taskName: string;
  /** Category of the task */
  category: string;
  /** Results from each provider */
  providerResults: ProviderExecutionResult[];
  /** Name of the baseline provider */
  baselineProvider: string;
  /** ISO timestamp of execution */
  executedAt: string;
}

/**
 * Result from a single provider execution
 */
export interface ProviderExecutionResult {
  /** Provider name */
  provider: string;
  /** Model identifier */
  model: string;
  /** Raw output from the model */
  output: string;
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
  /** Latency in milliseconds */
  latencyMs: number;
  /** ISO timestamp */
  timestamp: string;
  /** Quality scores (if evaluation enabled) */
  scores?: QualityScores;
  /** Type of evaluation used */
  evaluationType?: 'llm' | 'automated' | 'composite';
}

/**
 * Summary of a provider's performance across all tasks
 */
export interface ProviderSummary {
  /** Provider name */
  provider: string;
  /** Model identifier */
  model: string;
  /** Number of tasks completed */
  tasksCompleted: number;
  /** Number of tasks failed */
  tasksFailed: number;
  /** Total tokens used */
  totalTokens: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Average quality score (if evaluation enabled) */
  avgScore?: number;
}

/**
 * Result from running the full benchmark suite
 */
export interface BenchmarkSuiteResult {
  /** Unique identifier for this benchmark run */
  id: string;
  /** ISO timestamp of when the benchmark started */
  timestamp: string;
  /** Results for each task */
  taskResults: ExecutionResult[];
  /** Summary per provider */
  providerSummaries: ProviderSummary[];
}

/**
 * Configuration for BenchmarkExecutor
 */
export interface BenchmarkExecutorConfig {
  /** List of providers to benchmark */
  providers: ProviderConfig[];
  /** Benchmark tasks to run */
  tasks: BenchmarkTask[];
  /** Enable quality evaluation */
  enableEvaluation?: boolean;
  /** Use composite scoring (70% LLM + 30% automated) */
  useCompositeScoring?: boolean;
  /** LLM judge endpoint URL */
  judgeEndpoint?: string;
  /** API key for judge */
  judgeApiKey?: string;
}

/**
 * Benchmark Executor - orchestrates benchmark execution across providers
 */
export class BenchmarkExecutor {
  private runner: BenchmarkRunner;
  private providers: ProviderConfig[];
  private tasks: BenchmarkTask[];
  private enableEvaluation: boolean;
  private useCompositeScoring: boolean;
  private llmEvaluator?: LLMJudgeEvaluator;
  private compositeEvaluator?: CompositeEvaluator;

  constructor(config: BenchmarkExecutorConfig) {
    this.providers = config.providers;
    this.tasks = config.tasks;
    this.enableEvaluation = config.enableEvaluation ?? false;
    this.useCompositeScoring = config.useCompositeScoring ?? false;

    // Create runner with providers sorted so baseline is first
    this.runner = new BenchmarkRunner({
      providers: this.sortProviders(config.providers),
      tasks: config.tasks,
    });

    // Setup evaluators if evaluation is enabled
    if (this.enableEvaluation) {
      const judgeEndpoint = config.judgeEndpoint ?? 'https://api.anthropic.com/v1/messages';
      this.llmEvaluator = new LLMJudgeEvaluator({
        judgeEndpoint,
        apiKey: config.judgeApiKey,
      });

      if (this.useCompositeScoring) {
        this.compositeEvaluator = new CompositeEvaluator({
          llmWeight: 0.7,
          automatedWeight: 0.3,
          llmEvaluator: this.llmEvaluator,
        });
      }
    }
  }

  /**
   * Sort providers so baseline (Claude) runs first
   */
  private sortProviders(providers: ProviderConfig[]): ProviderConfig[] {
    return [...providers].sort((a, b) => {
      if (a.isBaseline && !b.isBaseline) return -1;
      if (!a.isBaseline && b.isBaseline) return 1;
      return 0;
    });
  }

  /**
   * Get the baseline provider
   */
  private getBaselineProvider(): ProviderConfig | undefined {
    return this.providers.find((p) => p.isBaseline);
  }

  /**
   * Execute a single task across all providers
   */
  async executeSingleTask(task: BenchmarkTask): Promise<ExecutionResult> {
    const sortedProviders = this.sortProviders(this.providers);
    const providerResults: ProviderExecutionResult[] = [];
    let baselineOutput: string | undefined;
    const baselineProvider = this.getBaselineProvider();

    // Run task on each provider
    for (const provider of sortedProviders) {
      const result = await this.runner.runTask(task, provider);

      // Store baseline output for comparison
      if (provider.isBaseline) {
        baselineOutput = result.output;
      }

      // Create provider result
      const providerResult: ProviderExecutionResult = {
        provider: result.provider,
        model: result.model,
        output: result.output,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        timestamp: result.timestamp,
      };

      // Evaluate non-baseline providers if evaluation is enabled
      if (this.enableEvaluation && !provider.isBaseline && baselineOutput) {
        const evaluationRequest: EvaluationRequest = {
          task,
          referenceOutput: baselineOutput,
          candidateOutput: result.output,
          provider: provider.name,
        };

        if (this.useCompositeScoring && this.compositeEvaluator) {
          const evalResult = await this.compositeEvaluator.evaluate(evaluationRequest);
          providerResult.scores = evalResult.scores;
          providerResult.evaluationType = 'composite';
        } else if (this.llmEvaluator) {
          const evalResult = await this.llmEvaluator.evaluate(evaluationRequest);
          providerResult.scores = evalResult.scores;
          providerResult.evaluationType = 'llm';
        }
      }

      providerResults.push(providerResult);
    }

    return {
      taskId: task.id,
      taskName: task.name,
      category: task.category,
      providerResults,
      baselineProvider: baselineProvider?.name ?? 'unknown',
      executedAt: new Date().toISOString(),
    };
  }

  /**
   * Run the full benchmark suite across all tasks and providers
   */
  async runFullBenchmark(): Promise<BenchmarkSuiteResult> {
    const benchmarkRun = await this.runner.runBenchmark();

    // Transform results into ExecutionResult format
    const taskResults: ExecutionResult[] = [];

    for (const task of this.tasks) {
      const providerResults: ProviderExecutionResult[] = [];
      const baselineProvider = this.getBaselineProvider();
      let baselineOutput: string | undefined;

      // Collect results for each provider for this task
      for (const [providerName, results] of benchmarkRun.results) {
        const taskResult = results.find((r) => r.taskId === task.id);
        if (taskResult) {
          const provider = this.providers.find((p) => p.name === providerName);

          // Store baseline output
          if (provider?.isBaseline) {
            baselineOutput = taskResult.output;
          }

          const providerResult: ProviderExecutionResult = {
            provider: taskResult.provider,
            model: taskResult.model,
            output: taskResult.output,
            inputTokens: taskResult.inputTokens,
            outputTokens: taskResult.outputTokens,
            latencyMs: taskResult.latencyMs,
            timestamp: taskResult.timestamp,
          };

          providerResults.push(providerResult);
        }
      }

      taskResults.push({
        taskId: task.id,
        taskName: task.name,
        category: task.category,
        providerResults,
        baselineProvider: baselineProvider?.name ?? 'unknown',
        executedAt: new Date().toISOString(),
      });
    }

    // Calculate provider summaries
    const providerSummaries = this.calculateProviderSummaries(benchmarkRun);

    return {
      id: benchmarkRun.id,
      timestamp: benchmarkRun.timestamp,
      taskResults,
      providerSummaries,
    };
  }

  /**
   * Calculate summary statistics for each provider
   */
  private calculateProviderSummaries(benchmarkRun: BenchmarkRun): ProviderSummary[] {
    const summaries: ProviderSummary[] = [];

    for (const [providerName, results] of benchmarkRun.results) {
      const provider = this.providers.find((p) => p.name === providerName);

      const tasksCompleted = results.filter((r) => !r.output.startsWith('Error:')).length;
      const tasksFailed = results.length - tasksCompleted;

      const totalTokens = results.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
      const avgLatencyMs =
        results.length > 0 ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length : 0;

      summaries.push({
        provider: providerName,
        model: provider?.model ?? 'unknown',
        tasksCompleted,
        tasksFailed,
        totalTokens,
        avgLatencyMs,
      });
    }

    return summaries;
  }
}
