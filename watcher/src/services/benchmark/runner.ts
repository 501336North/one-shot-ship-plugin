/**
 * @file Benchmark Runner
 * @description Executes benchmark tasks through different providers and collects metrics
 *
 * @behavior BenchmarkRunner orchestrates benchmark execution across providers
 * @acceptance-criteria AC-RUNNER.1 through AC-RUNNER.4
 */

import * as fs from 'fs';
import * as path from 'path';
import { CostTracker } from '../cost-tracker.js';
import type { BenchmarkTask, BenchmarkResult } from './types.js';

/**
 * Configuration for a model provider
 */
export interface ProviderConfig {
  /** Provider name (e.g., 'claude', 'ollama', 'openrouter') */
  name: string;
  /** Model identifier (e.g., 'ollama/qwen2.5-coder:7b') */
  model: string;
  /** Base URL for the provider API */
  baseUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Whether this provider is the baseline (true for claude) */
  isBaseline?: boolean;
}

/**
 * Configuration for the BenchmarkRunner
 */
export interface BenchmarkRunnerConfig {
  /** List of providers to benchmark */
  providers: ProviderConfig[];
  /** Benchmark tasks to run */
  tasks: BenchmarkTask[];
  /** Optional CostTracker for tracking costs */
  costTracker?: CostTracker;
  /** Timeout per request in milliseconds (default: 60000) */
  timeout?: number;
  /** Directory to store benchmark results (default: ~/.oss/benchmarks) */
  outputDir?: string;
}

/**
 * Options for running benchmarks
 */
export interface BenchmarkRunOptions {
  /** Run tasks sequentially to avoid rate limits */
  sequential?: boolean;
}

/**
 * A complete benchmark run with all results
 */
export interface BenchmarkRun {
  /** Unique identifier for this benchmark run */
  id: string;
  /** ISO timestamp of when the benchmark started */
  timestamp: string;
  /** Tasks that were benchmarked */
  tasks: BenchmarkTask[];
  /** Results grouped by provider name */
  results: Map<string, BenchmarkResult[]>;
  /** Summary statistics */
  summary?: BenchmarkSummary;
}

/**
 * Summary of benchmark results
 */
export interface BenchmarkSummary {
  /** Total number of tasks run */
  totalTasks: number;
  /** Summary per provider */
  providers: ProviderSummary[];
}

/**
 * Summary for a single provider
 */
export interface ProviderSummary {
  /** Provider name */
  name: string;
  /** Model identifier */
  model: string;
  /** Total tokens used */
  totalTokens: number;
  /** Total cost in USD */
  totalCost: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Number of tasks completed successfully */
  tasksCompleted: number;
  /** Number of tasks that failed */
  tasksFailed: number;
}

const DEFAULT_TIMEOUT = 60000;
const DEFAULT_OUTPUT_DIR = '~/.oss/benchmarks';

/**
 * Benchmark Runner - executes tasks through providers and collects metrics
 */
export class BenchmarkRunner {
  private providers: ProviderConfig[];
  private tasks: BenchmarkTask[];
  private costTracker?: CostTracker;
  private timeout: number;
  private outputDir: string;

  constructor(config: BenchmarkRunnerConfig) {
    this.providers = config.providers;
    this.tasks = config.tasks;
    this.costTracker = config.costTracker;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.outputDir = config.outputDir ?? DEFAULT_OUTPUT_DIR;
  }

  /**
   * Get the list of providers
   */
  getProviders(): ProviderConfig[] {
    return this.providers;
  }

  /**
   * Get the list of tasks
   */
  getTasks(): BenchmarkTask[] {
    return this.tasks;
  }

  /**
   * Get the CostTracker instance
   */
  getCostTracker(): CostTracker | undefined {
    return this.costTracker;
  }

  /**
   * Get the timeout setting
   */
  getTimeout(): number {
    return this.timeout;
  }

  /**
   * Run a single task against a provider
   */
  async runTask(task: BenchmarkTask, provider: ProviderConfig): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const baseUrl = provider.baseUrl ?? 'https://api.anthropic.com';

    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: task.prompt,
            },
          ],
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          taskId: task.id,
          provider: provider.name,
          model: provider.model,
          output: `Error: ${response.status} ${response.statusText}`,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
          timestamp: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const output = data.content?.[0]?.text ?? '';
      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;

      // Record usage if cost tracker is available
      if (this.costTracker) {
        this.costTracker.recordUsage({
          command: `benchmark:${task.id}`,
          model: provider.model,
          inputTokens,
          outputTokens,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        taskId: task.id,
        provider: provider.name,
        model: provider.model,
        output,
        inputTokens,
        outputTokens,
        latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        taskId: task.id,
        provider: provider.name,
        model: provider.model,
        output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Run the full benchmark across all providers and tasks
   */
  async runBenchmark(options: BenchmarkRunOptions = {}): Promise<BenchmarkRun> {
    const id = `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const timestamp = new Date().toISOString();
    const results = new Map<string, BenchmarkResult[]>();

    // Sort providers so baseline runs first
    const sortedProviders = [...this.providers].sort((a, b) => {
      if (a.isBaseline && !b.isBaseline) return -1;
      if (!a.isBaseline && b.isBaseline) return 1;
      return 0;
    });

    // Run tasks for each provider
    for (const provider of sortedProviders) {
      const providerResults: BenchmarkResult[] = [];

      if (options.sequential) {
        // Sequential execution
        for (const task of this.tasks) {
          const result = await this.runTask(task, provider);
          providerResults.push(result);
        }
      } else {
        // Parallel execution within provider (but providers still sequential)
        const taskPromises = this.tasks.map((task) => this.runTask(task, provider));
        const taskResults = await Promise.all(taskPromises);
        providerResults.push(...taskResults);
      }

      results.set(provider.name, providerResults);
    }

    return {
      id,
      timestamp,
      tasks: this.tasks,
      results,
    };
  }

  /**
   * Save benchmark results to disk
   */
  async saveResults(benchmarkRun: BenchmarkRun): Promise<void> {
    // Expand home directory
    const outputDir = this.outputDir.replace(/^~/, process.env.HOME ?? '');

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate filename based on timestamp
    const date = benchmarkRun.timestamp.split('T')[0];
    const filename = `${date}-${benchmarkRun.id}.json`;
    const filepath = path.join(outputDir, filename);

    // Convert Map to object for JSON serialization
    const resultsObject: Record<string, BenchmarkResult[]> = {};
    for (const [provider, results] of benchmarkRun.results) {
      resultsObject[provider] = results;
    }

    const data = {
      id: benchmarkRun.id,
      timestamp: benchmarkRun.timestamp,
      tasks: benchmarkRun.tasks,
      results: resultsObject,
      summary: benchmarkRun.summary,
    };

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  }
}
