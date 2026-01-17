#!/usr/bin/env node
/**
 * @file Benchmark CLI Command
 * @description CLI for running model quality benchmarks
 *
 * @behavior Benchmark CLI provides benchmark execution with provider and task filtering
 * @acceptance-criteria AC-BENCHMARK-CLI.1 through AC-BENCHMARK-CLI.3
 *
 * Usage:
 *   /oss:models benchmark                          - Run benchmark with default providers
 *   /oss:models benchmark --providers ollama,openrouter  - Run with specific providers
 *   /oss:models benchmark --tasks code-review      - Run specific task category
 *   /oss:models benchmark --output ./results.md    - Save report to file
 *   /oss:models benchmark --format json            - Output as JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BenchmarkRunner, ProviderConfig, BenchmarkRun } from '../services/benchmark/runner.js';
import { AutomatedEvaluator, EvaluationResult } from '../services/benchmark/evaluator.js';
import { BenchmarkReporter } from '../services/benchmark/reporter.js';
import { STANDARD_TASKS } from '../services/benchmark/standard-tasks.js';
import type { BenchmarkTask, TaskCategory } from '../services/benchmark/types.js';

/**
 * CLI arguments for benchmark command
 */
export interface BenchmarkCliArgs {
  /** Comma-separated provider names (e.g., "ollama,openrouter") */
  providers?: string;
  /** Task filter (e.g., "all", "code-review", "bug-fix") */
  tasks?: string;
  /** Output file path for report */
  output?: string;
  /** Output format */
  format?: 'markdown' | 'json';
  /** Show help text */
  showHelp: boolean;
}

/**
 * Default provider configurations for benchmarking
 */
const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: 'claude',
    model: 'claude-3-opus',
    isBaseline: true,
    // Uses native Claude Code - no baseUrl needed
  },
  {
    name: 'ollama',
    model: 'ollama/qwen2.5-coder:7b',
    baseUrl: 'http://localhost:11434',
  },
];

/**
 * Provider configurations by name
 */
const PROVIDER_CONFIGS: Record<string, Omit<ProviderConfig, 'name'>> = {
  claude: {
    model: 'claude-3-opus',
    isBaseline: true,
  },
  ollama: {
    model: 'ollama/qwen2.5-coder:7b',
    baseUrl: 'http://localhost:11434',
  },
  openrouter: {
    model: 'openrouter/deepseek/deepseek-coder',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
};

/**
 * Parse CLI arguments into structured format
 */
export function parseBenchmarkArgs(args: string[]): BenchmarkCliArgs {
  const result: BenchmarkCliArgs = {
    showHelp: false,
    format: 'markdown',
  };

  // Skip 'benchmark' if it's the first argument (when called as subcommand)
  const startIndex = args[0] === 'benchmark' ? 1 : 0;

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--providers':
        result.providers = args[++i];
        break;
      case '--tasks':
        result.tasks = args[++i];
        break;
      case '--output':
        result.output = args[++i];
        break;
      case '--format':
        result.format = args[++i] as 'markdown' | 'json';
        break;
      case '--help':
      case '-h':
        result.showHelp = true;
        break;
    }
  }

  return result;
}

/**
 * Get help text for the benchmark command
 */
function getHelpText(): string {
  return `Usage: /oss:models benchmark [options]

Run model quality benchmarks to compare providers.

Options:
  --providers <list>    Comma-separated provider names (e.g., "ollama,openrouter")
  --tasks <category>    Task category to run: all, code-review, bug-fix, test-writing, refactoring
  --output <path>       Save report to specified file path
  --format <type>       Output format: markdown (default) or json
  --help, -h            Show this help message

Examples:
  /oss:models benchmark
  /oss:models benchmark --providers ollama,openrouter
  /oss:models benchmark --tasks code-review
  /oss:models benchmark --output ./benchmark-results.md
  /oss:models benchmark --format json

Default Providers:
  - claude (baseline)
  - ollama (qwen2.5-coder:7b)

Reports are automatically saved to ~/.oss/benchmarks/`;
}

/**
 * Build provider configurations from comma-separated list
 */
function buildProviderConfigs(providersArg?: string): ProviderConfig[] {
  if (!providersArg) {
    return DEFAULT_PROVIDERS;
  }

  const providerNames = providersArg.split(',').map((p) => p.trim());
  const configs: ProviderConfig[] = [];

  // Always include claude as baseline if not explicitly specified
  if (!providerNames.includes('claude')) {
    configs.push({
      name: 'claude',
      ...PROVIDER_CONFIGS.claude,
    });
  }

  for (const name of providerNames) {
    const config = PROVIDER_CONFIGS[name];
    if (config) {
      configs.push({
        name,
        ...config,
      });
    } else {
      // Unknown provider - create basic config
      configs.push({
        name,
        model: name,
      });
    }
  }

  return configs;
}

/**
 * Filter tasks by category
 */
function filterTasks(tasksArg?: string): BenchmarkTask[] {
  if (!tasksArg || tasksArg === 'all') {
    return STANDARD_TASKS;
  }

  const category = tasksArg as TaskCategory;
  return STANDARD_TASKS.filter((task) => task.category === category);
}

/**
 * Get benchmarks output directory
 */
function getBenchmarksDir(): string {
  return path.join(os.homedir(), '.oss', 'benchmarks');
}

/**
 * Ensure benchmarks directory exists
 */
function ensureBenchmarksDir(): void {
  const dir = getBenchmarksDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save report to benchmarks directory
 */
function saveReport(report: string, format: 'markdown' | 'json'): string {
  ensureBenchmarksDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = format === 'json' ? 'json' : 'md';
  const filename = `benchmark-${timestamp}.${ext}`;
  const filepath = path.join(getBenchmarksDir(), filename);

  fs.writeFileSync(filepath, report, 'utf-8');

  return filepath;
}

/**
 * Execute the benchmark CLI command
 */
export async function executeBenchmarkCli(args: BenchmarkCliArgs): Promise<string> {
  // Show help if requested
  if (args.showHelp) {
    return getHelpText();
  }

  try {
    // Build provider and task configurations
    const providers = buildProviderConfigs(args.providers);
    const tasks = filterTasks(args.tasks);

    // Create benchmark runner
    const runner = new BenchmarkRunner({
      providers,
      tasks,
    });

    // Run benchmarks
    const benchmarkRun = await runner.runBenchmark({ sequential: true });

    // Evaluate results
    const evaluator = new AutomatedEvaluator();
    const evaluations: EvaluationResult[] = [];

    // Get baseline results for comparison
    const baselineResults = benchmarkRun.results.get('claude') || [];
    const baselineOutputs = new Map<string, string>();
    for (const result of baselineResults) {
      baselineOutputs.set(result.taskId, result.output);
    }

    // Evaluate each provider's results
    for (const [providerName, results] of benchmarkRun.results.entries()) {
      for (const result of results) {
        const task = tasks.find((t) => t.id === result.taskId);
        if (!task) continue;

        const referenceOutput = baselineOutputs.get(result.taskId) || '';

        const evaluation = await evaluator.evaluate({
          task,
          referenceOutput,
          candidateOutput: result.output,
          provider: providerName,
        });

        evaluations.push(evaluation);
      }
    }

    // Generate report
    const reporter = new BenchmarkReporter();
    const report = reporter.generateReport(benchmarkRun, evaluations);

    // Format output
    let output: string;
    if (args.format === 'json') {
      output = reporter.formatAsJson(report);
    } else {
      output = reporter.formatAsMarkdown(report);
    }

    // Save to output file if specified
    if (args.output) {
      fs.writeFileSync(args.output, output, 'utf-8');
    }

    // Always save to benchmarks directory
    saveReport(output, args.format || 'markdown');

    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error: Benchmark failed - ${message}`;
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsedArgs = parseBenchmarkArgs(args);
  const output = await executeBenchmarkCli(parsedArgs);
  console.log(output);
}

// Main execution - only run when called directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('benchmark.js');

if (isMainModule) {
  main().catch(console.error);
}
