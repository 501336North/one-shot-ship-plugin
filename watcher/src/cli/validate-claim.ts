#!/usr/bin/env node
/**
 * @file Validate Claim CLI Command
 * @description CLI for running full benchmark validation and producing PASS/FAIL verdict
 *
 * @behavior Validate Claim CLI runs benchmarks on all configured providers and validates the claim
 * @acceptance-criteria AC-VALIDATE-CLAIM.1 through AC-VALIDATE-CLAIM.3
 *
 * Usage:
 *   npx tsx src/cli/validate-claim.ts                    - Run validation with default providers
 *   npx tsx src/cli/validate-claim.ts --task code-review - Run specific task category
 *   npx tsx src/cli/validate-claim.ts --format json      - Output as JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BenchmarkRunner, ProviderConfig } from '../services/benchmark/runner.js';
import { ProviderFactory } from '../services/benchmark/provider-factory.js';
import { AutomatedEvaluator, EvaluationResult } from '../services/benchmark/evaluator.js';
import { BenchmarkAnalyzer } from '../services/benchmark/analysis.js';
import { STANDARD_TASKS } from '../services/benchmark/standard-tasks.js';
import type { BenchmarkTask, TaskCategory } from '../services/benchmark/types.js';

/**
 * CLI arguments for validate-claim command
 */
export interface ValidateClaimArgs {
  /** Comma-separated provider names (e.g., "ollama,openrouter") */
  providers?: string;
  /** Task filter (e.g., "code-review", "bug-fix") */
  task?: string;
  /** Output format */
  format?: 'markdown' | 'json';
  /** Show help text */
  showHelp: boolean;
}

/**
 * Validation result structure for JSON output
 */
export interface ValidationResult {
  /** ISO timestamp of when validation was run */
  validatedAt: string;
  /** The claim being validated */
  claim: string;
  /** Overall verdict: CLAIM_VALIDATED or CLAIM_NOT_VALIDATED */
  verdict: 'CLAIM_VALIDATED' | 'CLAIM_NOT_VALIDATED';
  /** Providers that passed the claim */
  passingProviders: string[];
  /** Per-provider validation results */
  providers: {
    provider: string;
    qualityPercent: number;
    tokenPercent: number;
    verdict: 'PASS' | 'FAIL';
  }[];
}

/**
 * Default provider configurations for validation
 */
const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: 'claude',
    model: 'claude-3-opus',
    isBaseline: true,
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
export function parseValidateClaimArgs(args: string[]): ValidateClaimArgs {
  const result: ValidateClaimArgs = {
    showHelp: false,
    format: 'markdown',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--providers':
        result.providers = args[++i];
        break;
      case '--task':
        result.task = args[++i];
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
 * Get help text for the validate-claim command
 */
function getHelpText(): string {
  return `Usage: npx tsx src/cli/validate-claim.ts [options]

Validate the claim: 95% quality for 25% tokens.

Options:
  --providers <list>    Comma-separated provider names (e.g., "ollama,openrouter")
  --task <category>     Task category to run: code-review, bug-fix, test-writing, refactoring
  --format <type>       Output format: markdown (default) or json
  --help, -h            Show this help message

Examples:
  npx tsx src/cli/validate-claim.ts
  npx tsx src/cli/validate-claim.ts --task code-review
  npx tsx src/cli/validate-claim.ts --format json

Claim Thresholds:
  - Quality: >= 95% of Claude baseline
  - Tokens: <= 25% of Claude baseline`;
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
function filterTasks(taskArg?: string): BenchmarkTask[] {
  if (!taskArg) {
    return STANDARD_TASKS;
  }

  const category = taskArg as TaskCategory;
  return STANDARD_TASKS.filter((task) => task.category === category);
}

/**
 * Format validation result as markdown
 */
function formatAsMarkdown(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push('# Claim Validation Report');
  lines.push('');
  lines.push(`**Validated At:** ${result.validatedAt}`);
  lines.push(`**Claim:** ${result.claim}`);
  lines.push('');

  // Overall verdict
  const verdictEmoji = result.verdict === 'CLAIM_VALIDATED' ? 'PASS' : 'FAIL';
  lines.push(`## Overall Verdict: ${result.verdict} (${verdictEmoji})`);
  lines.push('');

  if (result.passingProviders.length > 0) {
    lines.push(`**Passing Providers:** ${result.passingProviders.join(', ')}`);
    lines.push('');
  }

  // Provider breakdown table
  lines.push('## Provider Breakdown');
  lines.push('');
  lines.push('| Provider | Quality % | Token % | Verdict |');
  lines.push('|----------|-----------|---------|---------|');

  for (const provider of result.providers) {
    const qualityStatus = provider.qualityPercent >= 95 ? 'Y' : 'N';
    const tokenStatus = provider.tokenPercent <= 25 ? 'Y' : 'N';
    lines.push(
      `| ${provider.provider} | ${provider.qualityPercent}% (${qualityStatus}) | ${provider.tokenPercent}% (${tokenStatus}) | ${provider.verdict} |`
    );
  }
  lines.push('');

  // Thresholds reminder
  lines.push('## Claim Thresholds');
  lines.push('');
  lines.push('- Quality >= 95% of Claude baseline');
  lines.push('- Tokens <= 25% of Claude baseline');
  lines.push('');

  return lines.join('\n');
}

/**
 * Execute the validate-claim CLI command
 */
export async function executeValidateClaim(args: ValidateClaimArgs): Promise<string> {
  // Show help if requested
  if (args.showHelp) {
    return getHelpText();
  }

  try {
    // Build provider and task configurations
    const providers = buildProviderConfigs(args.providers);
    const tasks = filterTasks(args.task);

    // Create benchmark runner with provider factory for proper API routing
    const providerFactory = new ProviderFactory();
    const runner = new BenchmarkRunner({
      providers,
      tasks,
      providerFactory,
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

    // Use BenchmarkAnalyzer to validate claim
    const analyzer = new BenchmarkAnalyzer();
    const claimVerdict = analyzer.validateClaim(benchmarkRun, evaluations);

    // Build validation result
    const validationResult: ValidationResult = {
      validatedAt: new Date().toISOString(),
      claim: claimVerdict.claim,
      verdict: claimVerdict.overallVerdict,
      passingProviders: claimVerdict.passingProviders,
      providers: claimVerdict.providers.map((p) => ({
        provider: p.provider,
        qualityPercent: p.qualityPercent,
        tokenPercent: p.tokenPercent,
        verdict: p.verdict,
      })),
    };

    // Format output
    if (args.format === 'json') {
      return JSON.stringify(validationResult, null, 2);
    } else {
      return formatAsMarkdown(validationResult);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error: Validation failed - ${message}`;
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsedArgs = parseValidateClaimArgs(args);
  const output = await executeValidateClaim(parsedArgs);
  console.log(output);
}

// Main execution - only run when called directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('validate-claim.js');

if (isMainModule) {
  main().catch(console.error);
}
