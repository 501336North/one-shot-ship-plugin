/**
 * @file Benchmark Reporter
 * @description Generates comparison reports and validates the quality claim
 *
 * @behavior BenchmarkReporter generates reports comparing provider quality vs baseline
 * @acceptance-criteria AC-REPORTER.1 through AC-REPORTER.3
 */

import type { BenchmarkTask, BenchmarkResult } from './types.js';
import type { BenchmarkRun } from './runner.js';
import type { EvaluationResult } from './evaluator.js';

/**
 * Cost per million tokens for different models (approximate)
 */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Claude models
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  // OpenRouter/DeepSeek
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-coder': { input: 0.14, output: 0.28 },
  // Ollama (local, free)
  'qwen2.5-coder:7b': { input: 0, output: 0 },
  'qwen2.5-coder:14b': { input: 0, output: 0 },
  'llama3.2:latest': { input: 0, output: 0 },
};

/**
 * Summary of the benchmark report
 */
export interface ReportSummary {
  /** Total number of tasks run */
  totalTasks: number;
  /** Total number of providers evaluated */
  totalProviders: number;
  /** Name of the baseline provider */
  baselineProvider: string;
  /** Best alternative provider (highest quality-per-token) */
  bestAlternative: string;
}

/**
 * Provider-level report data
 */
export interface ProviderReport {
  /** Provider name */
  name: string;
  /** Model identifier */
  model: string;
  /** Total tokens used across all tasks */
  totalTokens: number;
  /** Total cost in USD */
  totalCost: number;
  /** Average quality score (0-100) */
  avgQualityScore: number;
  /** Token percentage vs baseline (e.g., 21 means 21% of baseline) */
  tokenPercentVsBaseline: number;
  /** Quality percentage vs baseline (e.g., 96 means 96% of baseline) */
  qualityPercentVsBaseline: number;
  /** Quality per token ratio (quality% / token%) */
  qualityPerTokenRatio: number;
  /** Cost savings percentage vs baseline */
  costSavingsPercent: number;
}

/**
 * Result for a single provider on a single task
 */
export interface TaskProviderResult {
  /** Provider name */
  provider: string;
  /** Total tokens (input + output) */
  tokens: number;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Latency in milliseconds */
  latencyMs: number;
}

/**
 * Task-level report data
 */
export interface TaskReport {
  /** Task identifier */
  taskId: string;
  /** Task name */
  taskName: string;
  /** Task category */
  category: string;
  /** Results from each provider */
  results: TaskProviderResult[];
}

/**
 * Claim validation result for a single provider
 */
export interface ProviderClaimResult {
  /** Provider name */
  provider: string;
  /** Quality percentage vs baseline */
  qualityPercent: number;
  /** Token percentage vs baseline */
  tokenPercent: number;
  /** Whether quality >= 95% of baseline */
  meetsQualityThreshold: boolean;
  /** Whether tokens <= 20% of baseline */
  meetsTokenThreshold: boolean;
  /** Overall claim validity */
  overallValid: boolean;
}

/**
 * Claim validation section of the report
 */
export interface ClaimValidation {
  /** The claim being validated */
  claim: string;
  /** Whether any provider validates the claim */
  valid: boolean;
  /** Per-provider validation results */
  providers: ProviderClaimResult[];
}

/**
 * Complete benchmark report
 */
export interface BenchmarkReport {
  /** Unique report identifier */
  id: string;
  /** ISO timestamp of when report was generated */
  generatedAt: string;
  /** Summary statistics */
  summary: ReportSummary;
  /** Per-provider reports */
  providers: ProviderReport[];
  /** Per-task reports */
  tasks: TaskReport[];
  /** Claim validation results */
  claimValidation: ClaimValidation;
  /** Recommendations based on results */
  recommendations: string[];
}

/**
 * Benchmark Reporter - generates comparison reports
 */
export class BenchmarkReporter {
  /**
   * Generate a benchmark report from a run and evaluations
   */
  generateReport(run: BenchmarkRun, evaluations: EvaluationResult[]): BenchmarkReport {
    const id = `report-${run.id}`;
    const generatedAt = new Date().toISOString();

    // Build evaluation lookup map: taskId-provider -> evaluation
    const evalMap = new Map<string, EvaluationResult>();
    for (const evaluation of evaluations) {
      const key = `${evaluation.taskId}-${evaluation.provider}`;
      evalMap.set(key, evaluation);
    }

    // Determine baseline provider
    const baselineProvider = this.findBaselineProvider(run);

    // Calculate per-provider metrics
    const providers = this.calculateProviderReports(run, evalMap, baselineProvider);

    // Calculate per-task breakdown
    const tasks = this.calculateTaskReports(run, evalMap);

    // Validate the claim
    const claimValidation = this.validateClaim(providers, baselineProvider);

    // Generate recommendations
    const recommendations = this.generateRecommendations(providers, claimValidation, baselineProvider);

    // Find best alternative
    const bestAlternative = this.findBestAlternative(providers, baselineProvider);

    return {
      id,
      generatedAt,
      summary: {
        totalTasks: run.tasks.length,
        totalProviders: providers.length,
        baselineProvider,
        bestAlternative,
      },
      providers,
      tasks,
      claimValidation,
      recommendations,
    };
  }

  /**
   * Format report as markdown
   */
  formatAsMarkdown(report: BenchmarkReport): string {
    const lines: string[] = [];

    // Header
    lines.push('# Model Quality Benchmark Report');
    lines.push('');
    lines.push(`**Generated:** ${report.generatedAt}`);
    lines.push(`**Tasks:** ${report.summary.totalTasks} | **Providers:** ${report.summary.totalProviders}`);
    lines.push('');

    // Provider Summary
    lines.push('## Provider Summary');
    lines.push('');
    lines.push('| Provider | Model | Tokens | Cost | Quality | vs Baseline | Verdict |');
    lines.push('|----------|-------|--------|------|---------|-------------|---------|');

    for (const provider of report.providers) {
      const verdict = this.getProviderVerdict(provider, report.claimValidation);
      lines.push(
        `| ${provider.name} | ${provider.model} | ${provider.totalTokens.toLocaleString()} | $${provider.totalCost.toFixed(4)} | ${provider.qualityPercentVsBaseline}% | ${provider.tokenPercentVsBaseline}% tokens | ${verdict} |`
      );
    }
    lines.push('');

    // Claim Validation
    lines.push('## Claim Validation');
    lines.push('');
    lines.push(`**Claim:** ${report.claimValidation.claim}`);
    lines.push('');
    lines.push('| Provider | Quality | Tokens | Status |');
    lines.push('|----------|---------|--------|--------|');

    for (const result of report.claimValidation.providers) {
      const qualityIcon = result.meetsQualityThreshold ? 'Y' : 'N';
      const tokenIcon = result.meetsTokenThreshold ? 'Y' : 'N';
      const status = result.overallValid ? '**VALID**' : '**INVALID**';
      const reason = !result.overallValid
        ? result.meetsQualityThreshold
          ? ' (tokens above 20%)'
          : ' (quality below 95%)'
        : '';
      lines.push(
        `| ${result.provider} | ${result.qualityPercent}% ${qualityIcon} | ${result.tokenPercent}% ${tokenIcon} | ${status}${reason} |`
      );
    }
    lines.push('');

    // Recommendations
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`1. ${rec}`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format report as JSON
   */
  formatAsJson(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Find the baseline provider (Claude)
   */
  private findBaselineProvider(run: BenchmarkRun): string {
    // Look for 'claude' provider
    for (const provider of run.results.keys()) {
      if (provider.toLowerCase() === 'claude') {
        return provider;
      }
    }
    return 'none';
  }

  /**
   * Calculate provider-level reports with comparative metrics
   */
  private calculateProviderReports(
    run: BenchmarkRun,
    evalMap: Map<string, EvaluationResult>,
    baselineProvider: string
  ): ProviderReport[] {
    const reports: ProviderReport[] = [];

    // First, calculate baseline totals
    let baselineTotalTokens = 0;
    let baselineTotalCost = 0;
    let baselineAvgQuality = 100; // Baseline is always 100%

    if (baselineProvider !== 'none') {
      const baselineResults = run.results.get(baselineProvider) ?? [];
      for (const result of baselineResults) {
        const tokens = result.inputTokens + result.outputTokens;
        baselineTotalTokens += tokens;
        baselineTotalCost += this.calculateCost(result.model, result.inputTokens, result.outputTokens);
      }
    }

    // Now calculate each provider's metrics
    for (const [providerName, results] of run.results.entries()) {
      if (results.length === 0) continue;

      let totalTokens = 0;
      let totalCost = 0;
      let qualitySum = 0;
      let qualityCount = 0;

      const model = results[0].model;

      for (const result of results) {
        const tokens = result.inputTokens + result.outputTokens;
        totalTokens += tokens;
        totalCost += this.calculateCost(result.model, result.inputTokens, result.outputTokens);

        // Get quality score from evaluation
        const evalKey = `${result.taskId}-${providerName}`;
        const evaluation = evalMap.get(evalKey);
        if (evaluation) {
          qualitySum += evaluation.scores.overall;
          qualityCount++;
        }
      }

      const avgQualityScore = qualityCount > 0 ? qualitySum / qualityCount : 0;

      // Calculate comparative metrics
      let tokenPercentVsBaseline: number;
      let qualityPercentVsBaseline: number;
      let costSavingsPercent: number;

      if (providerName === baselineProvider || baselineProvider === 'none') {
        tokenPercentVsBaseline = 100;
        qualityPercentVsBaseline = 100;
        costSavingsPercent = 0;
      } else {
        tokenPercentVsBaseline =
          baselineTotalTokens > 0 ? Math.round((totalTokens / baselineTotalTokens) * 100 * 10) / 10 : 0;
        qualityPercentVsBaseline = avgQualityScore; // Since baseline is 100%, quality% = actual score
        costSavingsPercent =
          baselineTotalCost > 0 ? Math.round((1 - totalCost / baselineTotalCost) * 100 * 10) / 10 : 100;
      }

      const qualityPerTokenRatio =
        tokenPercentVsBaseline > 0
          ? Math.round((qualityPercentVsBaseline / tokenPercentVsBaseline) * 100) / 100
          : 0;

      reports.push({
        name: providerName,
        model,
        totalTokens,
        totalCost,
        avgQualityScore,
        tokenPercentVsBaseline,
        qualityPercentVsBaseline,
        qualityPerTokenRatio,
        costSavingsPercent,
      });
    }

    // Sort: baseline first, then by quality-per-token ratio
    reports.sort((a, b) => {
      if (a.name === baselineProvider) return -1;
      if (b.name === baselineProvider) return 1;
      return b.qualityPerTokenRatio - a.qualityPerTokenRatio;
    });

    return reports;
  }

  /**
   * Calculate task-level reports
   */
  private calculateTaskReports(run: BenchmarkRun, evalMap: Map<string, EvaluationResult>): TaskReport[] {
    const reports: TaskReport[] = [];

    for (const task of run.tasks) {
      const results: TaskProviderResult[] = [];

      for (const [providerName, providerResults] of run.results.entries()) {
        const taskResult = providerResults.find((r) => r.taskId === task.id);
        if (taskResult) {
          const evalKey = `${task.id}-${providerName}`;
          const evaluation = evalMap.get(evalKey);
          const qualityScore = evaluation?.scores.overall ?? 0;

          results.push({
            provider: providerName,
            tokens: taskResult.inputTokens + taskResult.outputTokens,
            qualityScore,
            latencyMs: taskResult.latencyMs,
          });
        }
      }

      reports.push({
        taskId: task.id,
        taskName: task.name,
        category: task.category,
        results,
      });
    }

    return reports;
  }

  /**
   * Validate the claim: 95% quality for 20% tokens
   */
  private validateClaim(providers: ProviderReport[], baselineProvider: string): ClaimValidation {
    const claim = '95% quality for 20% tokens';
    const providerResults: ProviderClaimResult[] = [];
    let anyValid = false;

    if (baselineProvider === 'none') {
      return {
        claim,
        valid: false,
        providers: [],
      };
    }

    for (const provider of providers) {
      // Skip baseline provider
      if (provider.name === baselineProvider) continue;

      const meetsQualityThreshold = provider.qualityPercentVsBaseline >= 95;
      const meetsTokenThreshold = provider.tokenPercentVsBaseline <= 20;
      const overallValid = meetsQualityThreshold && meetsTokenThreshold;

      if (overallValid) {
        anyValid = true;
      }

      providerResults.push({
        provider: provider.name,
        qualityPercent: provider.qualityPercentVsBaseline,
        tokenPercent: provider.tokenPercentVsBaseline,
        meetsQualityThreshold,
        meetsTokenThreshold,
        overallValid,
      });
    }

    return {
      claim,
      valid: anyValid,
      providers: providerResults,
    };
  }

  /**
   * Generate recommendations based on results
   */
  private generateRecommendations(
    providers: ProviderReport[],
    claimValidation: ClaimValidation,
    baselineProvider: string
  ): string[] {
    const recommendations: string[] = [];

    // Find best value (highest quality-per-token, non-baseline)
    const nonBaseline = providers.filter((p) => p.name !== baselineProvider);
    if (nonBaseline.length > 0) {
      const bestValue = nonBaseline.reduce((a, b) => (a.qualityPerTokenRatio > b.qualityPerTokenRatio ? a : b));
      const costDesc = bestValue.totalCost === 0 ? 'Free' : `$${bestValue.totalCost.toFixed(4)}`;
      recommendations.push(
        `**Best Value:** ${bestValue.name}/${bestValue.model} - ${costDesc} with ${bestValue.qualityPercentVsBaseline}% quality`
      );

      // Find best quality alternative
      const bestQuality = nonBaseline.reduce((a, b) =>
        a.qualityPercentVsBaseline > b.qualityPercentVsBaseline ? a : b
      );
      if (bestQuality.name !== bestValue.name) {
        recommendations.push(
          `**Best Quality Alternative:** ${bestQuality.name}/${bestQuality.model} - ${bestQuality.qualityPercentVsBaseline}% quality at $${bestQuality.totalCost.toFixed(4)}`
        );
      }
    }

    // Add claim-specific recommendations
    const validProviders = claimValidation.providers.filter((p) => p.overallValid);
    if (validProviders.length > 0) {
      recommendations.push(
        `**Claim Validated:** ${validProviders.map((p) => p.provider).join(', ')} achieve 95%+ quality with 20% or fewer tokens`
      );
    } else if (claimValidation.providers.length > 0) {
      const closeProviders = claimValidation.providers.filter(
        (p) => p.qualityPercent >= 90 && p.tokenPercent <= 25
      );
      if (closeProviders.length > 0) {
        recommendations.push(
          `**Near Claim:** ${closeProviders.map((p) => p.provider).join(', ')} are close to the 95%/20% target`
        );
      }
    }

    return recommendations;
  }

  /**
   * Find the best alternative provider
   */
  private findBestAlternative(providers: ProviderReport[], baselineProvider: string): string {
    const nonBaseline = providers.filter((p) => p.name !== baselineProvider);
    if (nonBaseline.length === 0) return 'none';

    const best = nonBaseline.reduce((a, b) => (a.qualityPerTokenRatio > b.qualityPerTokenRatio ? a : b));
    return best.name;
  }

  /**
   * Get verdict for a provider in the markdown table
   */
  private getProviderVerdict(provider: ProviderReport, claimValidation: ClaimValidation): string {
    if (provider.tokenPercentVsBaseline === 100 && provider.qualityPercentVsBaseline === 100) {
      return 'baseline';
    }

    const claimResult = claimValidation.providers.find((p) => p.provider === provider.name);
    if (claimResult?.overallValid) {
      return 'Y';
    }
    return 'N';
  }

  /**
   * Calculate cost for a model based on token usage
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Normalize model name for lookup
    const normalizedModel = this.normalizeModelName(model);
    const costs = MODEL_COSTS[normalizedModel] ?? { input: 0, output: 0 };

    // Cost is per million tokens
    const inputCost = (inputTokens / 1_000_000) * costs.input;
    const outputCost = (outputTokens / 1_000_000) * costs.output;

    return inputCost + outputCost;
  }

  /**
   * Normalize model name for cost lookup
   */
  private normalizeModelName(model: string): string {
    // Handle ollama format (e.g., "ollama/qwen2.5-coder:7b" -> "qwen2.5-coder:7b")
    if (model.startsWith('ollama/')) {
      return model.substring(7);
    }

    // Handle common model patterns
    if (model.includes('qwen2.5-coder')) {
      if (model.includes(':14b')) return 'qwen2.5-coder:14b';
      return 'qwen2.5-coder:7b';
    }

    if (model.includes('deepseek')) {
      if (model.includes('coder')) return 'deepseek-coder';
      return 'deepseek-chat';
    }

    if (model.includes('claude')) {
      if (model.includes('opus')) return 'claude-3-opus';
      if (model.includes('sonnet')) return 'claude-3-sonnet';
      if (model.includes('haiku')) return 'claude-3-haiku';
    }

    return model;
  }
}
