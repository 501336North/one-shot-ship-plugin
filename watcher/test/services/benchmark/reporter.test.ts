/**
 * @file Benchmark Reporter Tests
 * @behavior BenchmarkReporter generates comparison reports and validates the quality claim
 * @acceptance-criteria AC-REPORTER.1 through AC-REPORTER.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { BenchmarkTask, BenchmarkResult } from '../../../src/services/benchmark/types.js';
import type { BenchmarkRun } from '../../../src/services/benchmark/runner.js';
import type { EvaluationResult } from '../../../src/services/benchmark/evaluator.js';
import {
  BenchmarkReporter,
  type BenchmarkReport,
  type ProviderReport,
  type ClaimValidation,
} from '../../../src/services/benchmark/reporter.js';

describe('BenchmarkReporter', () => {
  let sampleTasks: BenchmarkTask[];
  let sampleRun: BenchmarkRun;
  let sampleEvaluations: EvaluationResult[];
  let reporter: BenchmarkReporter;

  beforeEach(() => {
    // Sample tasks for benchmarking
    sampleTasks = [
      {
        id: 'task-01',
        name: 'Code Review Task',
        category: 'code-review',
        prompt: 'Review this function',
        expectedBehavior: ['type checking', 'error handling'],
      },
      {
        id: 'task-02',
        name: 'Bug Fix Task',
        category: 'bug-fix',
        prompt: 'Fix this bug',
        expectedBehavior: ['fix applied', 'tests added'],
      },
    ];

    // Sample benchmark results from multiple providers
    const claudeResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'claude',
        model: 'claude-3-opus',
        output: 'Baseline review output',
        inputTokens: 500,
        outputTokens: 1500,
        latencyMs: 2000,
        timestamp: '2026-01-17T10:00:00.000Z',
      },
      {
        taskId: 'task-02',
        provider: 'claude',
        model: 'claude-3-opus',
        output: 'Baseline bug fix output',
        inputTokens: 600,
        outputTokens: 1400,
        latencyMs: 1800,
        timestamp: '2026-01-17T10:00:05.000Z',
      },
    ];

    const openrouterResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'openrouter',
        model: 'deepseek-chat',
        output: 'Alternative review output',
        inputTokens: 100,
        outputTokens: 320,
        latencyMs: 1500,
        timestamp: '2026-01-17T10:01:00.000Z',
      },
      {
        taskId: 'task-02',
        provider: 'openrouter',
        model: 'deepseek-chat',
        output: 'Alternative bug fix output',
        inputTokens: 120,
        outputTokens: 280,
        latencyMs: 1200,
        timestamp: '2026-01-17T10:01:05.000Z',
      },
    ];

    const ollamaResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        output: 'Local review output',
        inputTokens: 90,
        outputTokens: 270,
        latencyMs: 3000,
        timestamp: '2026-01-17T10:02:00.000Z',
      },
      {
        taskId: 'task-02',
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        output: 'Local bug fix output',
        inputTokens: 110,
        outputTokens: 250,
        latencyMs: 2800,
        timestamp: '2026-01-17T10:02:05.000Z',
      },
    ];

    const resultsMap = new Map<string, BenchmarkResult[]>();
    resultsMap.set('claude', claudeResults);
    resultsMap.set('openrouter', openrouterResults);
    resultsMap.set('ollama', ollamaResults);

    sampleRun = {
      id: 'benchmark-2026-01-17T10-00-00-000Z',
      timestamp: '2026-01-17T10:00:00.000Z',
      tasks: sampleTasks,
      results: resultsMap,
    };

    // Sample evaluation results
    // Claude baseline always scores 100% (it's the reference)
    sampleEvaluations = [
      // Claude evaluations (baseline = 100%)
      {
        taskId: 'task-01',
        provider: 'claude',
        scores: { correctness: 100, completeness: 100, style: 100, efficiency: 100, overall: 100 },
        evaluatedAt: '2026-01-17T10:03:00.000Z',
        evaluatorType: 'composite' as const,
      },
      {
        taskId: 'task-02',
        provider: 'claude',
        scores: { correctness: 100, completeness: 100, style: 100, efficiency: 100, overall: 100 },
        evaluatedAt: '2026-01-17T10:03:05.000Z',
        evaluatorType: 'composite' as const,
      },
      // OpenRouter evaluations (~96% quality)
      {
        taskId: 'task-01',
        provider: 'openrouter',
        scores: { correctness: 96, completeness: 95, style: 97, efficiency: 96, overall: 96 },
        evaluatedAt: '2026-01-17T10:04:00.000Z',
        evaluatorType: 'composite' as const,
      },
      {
        taskId: 'task-02',
        provider: 'openrouter',
        scores: { correctness: 97, completeness: 96, style: 96, efficiency: 95, overall: 96 },
        evaluatedAt: '2026-01-17T10:04:05.000Z',
        evaluatorType: 'composite' as const,
      },
      // Ollama evaluations (~94% quality)
      {
        taskId: 'task-01',
        provider: 'ollama',
        scores: { correctness: 94, completeness: 93, style: 95, efficiency: 94, overall: 94 },
        evaluatedAt: '2026-01-17T10:05:00.000Z',
        evaluatorType: 'composite' as const,
      },
      {
        taskId: 'task-02',
        provider: 'ollama',
        scores: { correctness: 95, completeness: 94, style: 95, efficiency: 94, overall: 95 },
        evaluatedAt: '2026-01-17T10:05:05.000Z',
        evaluatorType: 'composite' as const,
      },
    ];

    reporter = new BenchmarkReporter();
  });

  // ============================================================================
  // Task 4.1: Calculate Comparative Metrics
  // ============================================================================
  describe('BenchmarkReporter metrics', () => {
    /**
     * @behavior Calculates quality percentage vs baseline (Claude = 100%)
     * @acceptance-criteria AC-REPORTER.1
     */
    it('should calculate quality percentage vs baseline (Claude = 100%)', () => {
      // GIVEN a benchmark run with Claude baseline and alternative providers
      // WHEN generating a report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN Claude should be 100% (baseline)
      const claudeReport = report.providers.find((p) => p.name === 'claude');
      expect(claudeReport?.qualityPercentVsBaseline).toBe(100);

      // AND OpenRouter should be ~96% of baseline (average of 96, 96)
      const openrouterReport = report.providers.find((p) => p.name === 'openrouter');
      expect(openrouterReport?.qualityPercentVsBaseline).toBe(96);

      // AND Ollama should be ~94.5% of baseline (average of 94, 95)
      const ollamaReport = report.providers.find((p) => p.name === 'ollama');
      expect(ollamaReport?.qualityPercentVsBaseline).toBeCloseTo(94.5, 1);
    });

    /**
     * @behavior Calculates token percentage vs baseline
     * @acceptance-criteria AC-REPORTER.1
     */
    it('should calculate token percentage vs baseline', () => {
      // GIVEN Claude uses 4000 total tokens (500+1500 + 600+1400)
      // AND OpenRouter uses 820 total tokens (100+320 + 120+280)
      // AND Ollama uses 720 total tokens (90+270 + 110+250)

      // WHEN generating a report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN Claude should be 100% (baseline)
      const claudeReport = report.providers.find((p) => p.name === 'claude');
      expect(claudeReport?.tokenPercentVsBaseline).toBe(100);

      // AND OpenRouter should be ~20.5% (820/4000 = 0.205)
      const openrouterReport = report.providers.find((p) => p.name === 'openrouter');
      expect(openrouterReport?.tokenPercentVsBaseline).toBeCloseTo(20.5, 1);

      // AND Ollama should be 18% (720/4000 = 0.18)
      const ollamaReport = report.providers.find((p) => p.name === 'ollama');
      expect(ollamaReport?.tokenPercentVsBaseline).toBe(18);
    });

    /**
     * @behavior Calculates cost savings percentage
     * @acceptance-criteria AC-REPORTER.1
     */
    it('should calculate cost savings percentage', () => {
      // GIVEN Claude costs ~$0.15 (using typical opus pricing)
      // AND OpenRouter costs ~$0.006 (using deepseek pricing)
      // AND Ollama costs $0 (local)

      // WHEN generating a report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN Claude should have 0% savings (baseline)
      const claudeReport = report.providers.find((p) => p.name === 'claude');
      expect(claudeReport?.costSavingsPercent).toBe(0);

      // AND alternative providers should show positive savings
      const openrouterReport = report.providers.find((p) => p.name === 'openrouter');
      expect(openrouterReport?.costSavingsPercent).toBeGreaterThan(90); // Should be 95%+

      // AND Ollama should show 100% savings (free)
      const ollamaReport = report.providers.find((p) => p.name === 'ollama');
      expect(ollamaReport?.costSavingsPercent).toBe(100);
    });

    /**
     * @behavior Calculates quality-per-token ratio
     * @acceptance-criteria AC-REPORTER.1
     */
    it('should calculate quality-per-token ratio', () => {
      // GIVEN quality and token percentages for each provider
      // WHEN generating a report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN Claude ratio should be 1.0 (100/100)
      const claudeReport = report.providers.find((p) => p.name === 'claude');
      expect(claudeReport?.qualityPerTokenRatio).toBe(1);

      // AND OpenRouter ratio should be ~4.68 (96/20.5)
      const openrouterReport = report.providers.find((p) => p.name === 'openrouter');
      expect(openrouterReport?.qualityPerTokenRatio).toBeGreaterThan(4);

      // AND Ollama ratio should be ~5.25 (94.5/18)
      const ollamaReport = report.providers.find((p) => p.name === 'ollama');
      expect(ollamaReport?.qualityPerTokenRatio).toBeGreaterThan(5);
    });
  });

  // ============================================================================
  // Task 4.2: Generate Report Data
  // ============================================================================
  describe('BenchmarkReporter.generateReport()', () => {
    /**
     * @behavior Includes per-provider summary in report
     * @acceptance-criteria AC-REPORTER.2
     */
    it('should include per-provider summary', () => {
      // WHEN generating a report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN report should include all providers
      expect(report.providers).toHaveLength(3);

      // AND each provider should have required fields
      for (const provider of report.providers) {
        expect(provider.name).toBeDefined();
        expect(provider.model).toBeDefined();
        expect(provider.totalTokens).toBeGreaterThanOrEqual(0);
        expect(provider.totalCost).toBeGreaterThanOrEqual(0);
        expect(provider.avgQualityScore).toBeGreaterThanOrEqual(0);
        expect(provider.avgQualityScore).toBeLessThanOrEqual(100);
      }

      // AND summary should have correct totals
      expect(report.summary.totalTasks).toBe(2);
      expect(report.summary.totalProviders).toBe(3);
      expect(report.summary.baselineProvider).toBe('claude');
    });

    /**
     * @behavior Includes per-task breakdown in report
     * @acceptance-criteria AC-REPORTER.2
     */
    it('should include per-task breakdown', () => {
      // WHEN generating a report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN report should include task breakdown
      expect(report.tasks).toHaveLength(2);

      // AND each task should have results from all providers
      for (const task of report.tasks) {
        expect(task.taskId).toBeDefined();
        expect(task.taskName).toBeDefined();
        expect(task.category).toBeDefined();
        expect(task.results).toHaveLength(3);

        // Each result should have required fields
        for (const result of task.results) {
          expect(result.provider).toBeDefined();
          expect(result.tokens).toBeGreaterThanOrEqual(0);
          expect(result.qualityScore).toBeGreaterThanOrEqual(0);
          expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        }
      }
    });

    /**
     * @behavior Includes claim validation (95% quality / 20% tokens)
     * @acceptance-criteria AC-REPORTER.2
     */
    it('should include claim validation (95% quality / 20% tokens)', () => {
      // WHEN generating a report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN report should include claim validation
      expect(report.claimValidation).toBeDefined();
      expect(report.claimValidation.claim).toBe('95% quality for 20% tokens');

      // AND it should validate each non-baseline provider
      const providerResults = report.claimValidation.providers;
      expect(providerResults).toHaveLength(2); // Only non-baseline providers

      // OpenRouter: 96% quality (>= 95), 20.5% tokens (~<= 20) - borderline
      const openrouterClaim = providerResults.find((p) => p.provider === 'openrouter');
      expect(openrouterClaim?.meetsQualityThreshold).toBe(true);
      expect(openrouterClaim?.qualityPercent).toBe(96);

      // Ollama: 94.5% quality (< 95), 18% tokens (<= 20) - fails quality
      const ollamaClaim = providerResults.find((p) => p.provider === 'ollama');
      expect(ollamaClaim?.meetsQualityThreshold).toBe(false);
      expect(ollamaClaim?.meetsTokenThreshold).toBe(true);
    });

    /**
     * @behavior Handles missing baseline gracefully
     * @acceptance-criteria AC-REPORTER.2
     */
    it('should handle missing baseline gracefully', () => {
      // GIVEN a benchmark run without Claude baseline
      const noBaselineResults = new Map<string, BenchmarkResult[]>();
      noBaselineResults.set('openrouter', sampleRun.results.get('openrouter')!);
      noBaselineResults.set('ollama', sampleRun.results.get('ollama')!);

      const noBaselineRun: BenchmarkRun = {
        ...sampleRun,
        results: noBaselineResults,
      };

      // AND evaluations without Claude
      const noBaselineEvals = sampleEvaluations.filter((e) => e.provider !== 'claude');

      // WHEN generating a report
      const report = reporter.generateReport(noBaselineRun, noBaselineEvals);

      // THEN report should still be generated
      expect(report.providers).toHaveLength(2);

      // AND summary should indicate no baseline
      expect(report.summary.baselineProvider).toBe('none');

      // AND claim validation should indicate it cannot be validated
      expect(report.claimValidation.valid).toBe(false);
    });
  });

  // ============================================================================
  // Task 4.3: Format Report Output
  // ============================================================================
  describe('BenchmarkReporter formatting', () => {
    /**
     * @behavior Outputs markdown table format
     * @acceptance-criteria AC-REPORTER.3
     */
    it('should output markdown table format', () => {
      // GIVEN a generated report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // WHEN formatting as markdown
      const markdown = reporter.formatAsMarkdown(report);

      // THEN it should contain markdown table elements
      expect(markdown).toContain('# Model Quality Benchmark Report');
      expect(markdown).toContain('## Provider Summary');
      expect(markdown).toContain('| Provider |');
      expect(markdown).toContain('|----------|');

      // AND it should include all providers
      expect(markdown).toContain('claude');
      expect(markdown).toContain('openrouter');
      expect(markdown).toContain('ollama');

      // AND it should include key metrics
      expect(markdown).toContain('Quality');
      expect(markdown).toContain('Tokens');
    });

    /**
     * @behavior Outputs JSON for programmatic access
     * @acceptance-criteria AC-REPORTER.3
     */
    it('should output JSON for programmatic access', () => {
      // GIVEN a generated report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // WHEN formatting as JSON
      const json = reporter.formatAsJson(report);

      // THEN it should be valid JSON
      const parsed = JSON.parse(json);
      expect(parsed).toBeDefined();

      // AND it should contain all report fields
      expect(parsed.id).toBe(report.id);
      expect(parsed.summary).toBeDefined();
      expect(parsed.providers).toHaveLength(3);
      expect(parsed.tasks).toHaveLength(2);
      expect(parsed.claimValidation).toBeDefined();
    });

    /**
     * @behavior Highlights claim validation status
     * @acceptance-criteria AC-REPORTER.3
     */
    it('should highlight claim validation status', () => {
      // GIVEN a generated report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // WHEN formatting as markdown
      const markdown = reporter.formatAsMarkdown(report);

      // THEN it should include claim validation section
      expect(markdown).toContain('## Claim Validation');
      expect(markdown).toContain('95% quality for 20% tokens');

      // AND it should show pass/fail indicators
      expect(markdown).toMatch(/VALID|INVALID/);
    });

    /**
     * @behavior Includes recommendations based on results
     * @acceptance-criteria AC-REPORTER.3
     */
    it('should include recommendations based on results', () => {
      // GIVEN a generated report
      const report = reporter.generateReport(sampleRun, sampleEvaluations);

      // THEN report should include recommendations
      expect(report.recommendations).toBeDefined();
      expect(report.recommendations.length).toBeGreaterThan(0);

      // WHEN formatting as markdown
      const markdown = reporter.formatAsMarkdown(report);

      // THEN it should include recommendations section
      expect(markdown).toContain('## Recommendations');

      // AND recommendations should mention best alternatives
      const hasValueRec = report.recommendations.some((r) => r.toLowerCase().includes('value'));
      const hasQualityRec = report.recommendations.some((r) => r.toLowerCase().includes('quality'));
      expect(hasValueRec || hasQualityRec).toBe(true);
    });
  });
});
