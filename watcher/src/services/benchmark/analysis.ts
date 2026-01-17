/**
 * @file Benchmark Analysis
 * @description Generates comparison reports and validates the quality claim
 *
 * @behavior BenchmarkAnalyzer generates reports comparing provider quality vs baseline
 * @acceptance-criteria AC-ANALYSIS.1 through AC-ANALYSIS.6
 */

import type { BenchmarkResult } from './types.js';
import type { BenchmarkRun } from './runner.js';
import type { EvaluationResult } from './evaluator.js';

/**
 * Analysis result for a single provider
 */
export interface ProviderAnalysis {
  /** Provider name */
  provider: string;
  /** Model identifier */
  model: string;
  /** Total tokens used */
  totalTokens: number;
  /** Average quality score (0-100) */
  avgQualityScore: number;
  /** Quality percentage vs baseline (e.g., 96 means 96% of Claude quality) */
  qualityPercentVsBaseline: number;
  /** Token percentage vs baseline (e.g., 20 means 20% of Claude tokens) */
  tokenPercentVsBaseline: number;
}

/**
 * Complete analysis report
 */
export interface AnalysisReport {
  /** Report identifier */
  id: string;
  /** ISO timestamp */
  generatedAt: string;
  /** Baseline provider name */
  baselineProvider: string;
  /** Per-provider analysis */
  providers: ProviderAnalysis[];
}

/**
 * Result of claim validation for a single provider
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
  /** Whether tokens <= 25% of baseline */
  meetsTokenThreshold: boolean;
  /** PASS if both thresholds met, FAIL otherwise */
  verdict: 'PASS' | 'FAIL';
}

/**
 * Overall claim validation verdict
 */
export interface ClaimVerdict {
  /** The claim being validated */
  claim: string;
  /** CLAIM_VALIDATED if at least one provider passes, CLAIM_NOT_VALIDATED otherwise */
  overallVerdict: 'CLAIM_VALIDATED' | 'CLAIM_NOT_VALIDATED';
  /** List of providers that passed */
  passingProviders: string[];
  /** Per-provider validation results */
  providers: ProviderClaimResult[];
}

/**
 * Benchmark Analyzer - generates analysis reports and validates claims
 */
export class BenchmarkAnalyzer {
  private readonly qualityThreshold = 95; // >= 95% of baseline quality
  private readonly tokenThreshold = 25; // <= 25% of baseline tokens

  /**
   * Analyze benchmark results and generate a report
   */
  analyze(run: BenchmarkRun, evaluations: EvaluationResult[]): AnalysisReport {
    const id = `analysis-${run.id}`;
    const generatedAt = new Date().toISOString();

    // Build evaluation lookup map: taskId-provider -> evaluation
    const evalMap = new Map<string, EvaluationResult>();
    for (const evaluation of evaluations) {
      const key = `${evaluation.taskId}-${evaluation.provider}`;
      evalMap.set(key, evaluation);
    }

    // Find baseline provider (Claude)
    const baselineProvider = this.findBaselineProvider(run);

    // Calculate baseline totals
    const baselineTotals = this.calculateProviderTotals(
      run.results.get(baselineProvider) ?? [],
      evalMap,
      baselineProvider
    );

    // Calculate per-provider analysis
    const providers: ProviderAnalysis[] = [];

    for (const [providerName, results] of run.results.entries()) {
      if (results.length === 0) continue;

      const totals = this.calculateProviderTotals(results, evalMap, providerName);

      // Calculate vs baseline percentages
      let qualityPercentVsBaseline: number;
      let tokenPercentVsBaseline: number;

      if (providerName === baselineProvider) {
        qualityPercentVsBaseline = 100;
        tokenPercentVsBaseline = 100;
      } else {
        qualityPercentVsBaseline = totals.avgQuality; // Since baseline is 100%
        tokenPercentVsBaseline =
          baselineTotals.totalTokens > 0
            ? Math.round((totals.totalTokens / baselineTotals.totalTokens) * 100)
            : 0;
      }

      providers.push({
        provider: providerName,
        model: results[0].model,
        totalTokens: totals.totalTokens,
        avgQualityScore: totals.avgQuality,
        qualityPercentVsBaseline,
        tokenPercentVsBaseline,
      });
    }

    return {
      id,
      generatedAt,
      baselineProvider,
      providers,
    };
  }

  /**
   * Validate the claim: 95% quality for 25% tokens
   */
  validateClaim(run: BenchmarkRun, evaluations: EvaluationResult[]): ClaimVerdict {
    const report = this.analyze(run, evaluations);
    const claim = '95% quality for 25% tokens';
    const providerResults: ProviderClaimResult[] = [];
    const passingProviders: string[] = [];

    for (const provider of report.providers) {
      // Skip baseline provider
      if (provider.provider === report.baselineProvider) continue;

      const meetsQualityThreshold = provider.qualityPercentVsBaseline >= this.qualityThreshold;
      const meetsTokenThreshold = provider.tokenPercentVsBaseline <= this.tokenThreshold;
      const verdict: 'PASS' | 'FAIL' = meetsQualityThreshold && meetsTokenThreshold ? 'PASS' : 'FAIL';

      if (verdict === 'PASS') {
        passingProviders.push(provider.provider);
      }

      providerResults.push({
        provider: provider.provider,
        qualityPercent: provider.qualityPercentVsBaseline,
        tokenPercent: provider.tokenPercentVsBaseline,
        meetsQualityThreshold,
        meetsTokenThreshold,
        verdict,
      });
    }

    return {
      claim,
      overallVerdict: passingProviders.length > 0 ? 'CLAIM_VALIDATED' : 'CLAIM_NOT_VALIDATED',
      passingProviders,
      providers: providerResults,
    };
  }

  /**
   * Format analysis report as markdown
   */
  toMarkdown(report: AnalysisReport): string {
    const lines: string[] = [];

    lines.push('# Benchmark Analysis Report');
    lines.push('');
    lines.push(`**Generated:** ${report.generatedAt}`);
    lines.push(`**Baseline:** ${report.baselineProvider}`);
    lines.push('');

    // Quality vs Baseline section
    lines.push('## Quality vs Baseline');
    lines.push('');
    lines.push('| Provider | Model | Quality Score | vs Baseline |');
    lines.push('|----------|-------|---------------|-------------|');

    for (const provider of report.providers) {
      lines.push(
        `| ${provider.provider} | ${provider.model} | ${provider.avgQualityScore} | ${provider.qualityPercentVsBaseline}% |`
      );
    }
    lines.push('');

    // Token Usage section
    lines.push('## Token Usage vs Baseline');
    lines.push('');
    lines.push('| Provider | Total Tokens | vs Baseline |');
    lines.push('|----------|--------------|-------------|');

    for (const provider of report.providers) {
      lines.push(
        `| ${provider.provider} | ${provider.totalTokens.toLocaleString()} | ${provider.tokenPercentVsBaseline}% |`
      );
    }
    lines.push('');

    // Findings section
    lines.push('## Findings');
    lines.push('');

    const nonBaseline = report.providers.filter((p) => p.provider !== report.baselineProvider);
    for (const provider of nonBaseline) {
      const qualityStatus = provider.qualityPercentVsBaseline >= 95 ? 'MEETS' : 'BELOW';
      const tokenStatus = provider.tokenPercentVsBaseline <= 25 ? 'MEETS' : 'EXCEEDS';

      lines.push(`### ${provider.provider}`);
      lines.push(`- Quality: ${provider.qualityPercentVsBaseline}% (${qualityStatus} 95% threshold)`);
      lines.push(`- Tokens: ${provider.tokenPercentVsBaseline}% (${tokenStatus} 25% threshold)`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Find the baseline provider (Claude)
   */
  private findBaselineProvider(run: BenchmarkRun): string {
    for (const provider of run.results.keys()) {
      if (provider.toLowerCase() === 'claude') {
        return provider;
      }
    }
    return 'none';
  }

  /**
   * Calculate totals for a provider's results
   */
  private calculateProviderTotals(
    results: BenchmarkResult[],
    evalMap: Map<string, EvaluationResult>,
    providerName: string
  ): { totalTokens: number; avgQuality: number } {
    let totalTokens = 0;
    let qualitySum = 0;
    let qualityCount = 0;

    for (const result of results) {
      totalTokens += result.inputTokens + result.outputTokens;

      const evalKey = `${result.taskId}-${providerName}`;
      const evaluation = evalMap.get(evalKey);
      if (evaluation) {
        qualitySum += evaluation.scores.overall;
        qualityCount++;
      }
    }

    return {
      totalTokens,
      avgQuality: qualityCount > 0 ? qualitySum / qualityCount : 0,
    };
  }
}
