/**
 * @file Benchmark Analysis Tests
 * @description Tests for benchmark report generation and claim validation
 *
 * @behavior BenchmarkAnalyzer generates comparison reports and validates claims
 * @acceptance-criteria AC-ANALYSIS.1 through AC-ANALYSIS.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { BenchmarkTask, BenchmarkResult } from '../../../src/services/benchmark/types.js';
import type { BenchmarkRun } from '../../../src/services/benchmark/runner.js';
import type { EvaluationResult } from '../../../src/services/benchmark/evaluator.js';
import { BenchmarkAnalyzer, type AnalysisReport, type ClaimVerdict } from '../../../src/services/benchmark/analysis.js';

describe('Benchmark report generation', () => {
  let sampleTasks: BenchmarkTask[];
  let sampleRun: BenchmarkRun;
  let sampleEvaluations: EvaluationResult[];
  let analyzer: BenchmarkAnalyzer;

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

    // Claude baseline: 4000 total tokens (500+1500 + 600+1400)
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

    // Alternative provider: 800 total tokens (200+400 + 100+100) = 20% of Claude
    const openrouterResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'openrouter',
        model: 'deepseek-chat',
        output: 'Alternative review output',
        inputTokens: 200,
        outputTokens: 400,
        latencyMs: 1500,
        timestamp: '2026-01-17T10:01:00.000Z',
      },
      {
        taskId: 'task-02',
        provider: 'openrouter',
        model: 'deepseek-chat',
        output: 'Alternative bug fix output',
        inputTokens: 100,
        outputTokens: 100,
        latencyMs: 1200,
        timestamp: '2026-01-17T10:01:05.000Z',
      },
    ];

    const resultsMap = new Map<string, BenchmarkResult[]>();
    resultsMap.set('claude', claudeResults);
    resultsMap.set('openrouter', openrouterResults);

    sampleRun = {
      id: 'benchmark-2026-01-17T10-00-00-000Z',
      timestamp: '2026-01-17T10:00:00.000Z',
      tasks: sampleTasks,
      results: resultsMap,
    };

    // Claude baseline always scores 100% (it's the reference)
    // OpenRouter scores 96% average quality
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
      // OpenRouter evaluations (96% quality average)
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
    ];

    analyzer = new BenchmarkAnalyzer();
  });

  /**
   * @behavior Calculates quality percentage vs Claude baseline
   * @acceptance-criteria AC-ANALYSIS.1
   */
  it('should calculate quality percentage vs Claude baseline', () => {
    // GIVEN benchmark run with Claude baseline (100%) and OpenRouter (96% avg)
    // WHEN analyzing the results
    const report = analyzer.analyze(sampleRun, sampleEvaluations);

    // THEN quality percentage should be calculated relative to baseline
    const openrouterAnalysis = report.providers.find((p) => p.provider === 'openrouter');
    expect(openrouterAnalysis).toBeDefined();
    expect(openrouterAnalysis!.qualityPercentVsBaseline).toBe(96);
  });

  /**
   * @behavior Calculates token percentage vs Claude baseline
   * @acceptance-criteria AC-ANALYSIS.2
   */
  it('should calculate token percentage vs Claude baseline', () => {
    // GIVEN Claude uses 4000 tokens, OpenRouter uses 800 tokens (20%)
    // WHEN analyzing the results
    const report = analyzer.analyze(sampleRun, sampleEvaluations);

    // THEN token percentage should be 20% of baseline
    const openrouterAnalysis = report.providers.find((p) => p.provider === 'openrouter');
    expect(openrouterAnalysis).toBeDefined();
    expect(openrouterAnalysis!.tokenPercentVsBaseline).toBe(20);
  });

  /**
   * @behavior Generates markdown report with findings
   * @acceptance-criteria AC-ANALYSIS.3
   */
  it('should generate markdown report with findings', () => {
    // GIVEN a completed analysis
    const report = analyzer.analyze(sampleRun, sampleEvaluations);

    // WHEN generating markdown output
    const markdown = analyzer.toMarkdown(report);

    // THEN it should contain key sections
    expect(markdown).toContain('# Benchmark Analysis Report');
    expect(markdown).toContain('## Quality vs Baseline');
    expect(markdown).toContain('## Token Usage vs Baseline');
    expect(markdown).toContain('## Findings');

    // AND it should include provider data
    expect(markdown).toContain('openrouter');
    expect(markdown).toContain('96%');
    expect(markdown).toContain('20%');
  });
});

describe('Claim validation', () => {
  let sampleTasks: BenchmarkTask[];
  let sampleRun: BenchmarkRun;
  let sampleEvaluations: EvaluationResult[];
  let analyzer: BenchmarkAnalyzer;

  beforeEach(() => {
    sampleTasks = [
      {
        id: 'task-01',
        name: 'Code Review Task',
        category: 'code-review',
        prompt: 'Review this function',
        expectedBehavior: ['type checking', 'error handling'],
      },
    ];

    // Claude: 1000 tokens (baseline)
    const claudeResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'claude',
        model: 'claude-3-opus',
        output: 'Baseline output',
        inputTokens: 400,
        outputTokens: 600,
        latencyMs: 2000,
        timestamp: '2026-01-17T10:00:00.000Z',
      },
    ];

    // Provider A: 200 tokens (20%), 96% quality - PASSES
    const providerAResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'provider-a',
        model: 'model-a',
        output: 'Provider A output',
        inputTokens: 80,
        outputTokens: 120,
        latencyMs: 1000,
        timestamp: '2026-01-17T10:01:00.000Z',
      },
    ];

    // Provider B: 300 tokens (30%), 97% quality - FAILS (tokens > 25%)
    const providerBResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'provider-b',
        model: 'model-b',
        output: 'Provider B output',
        inputTokens: 120,
        outputTokens: 180,
        latencyMs: 1200,
        timestamp: '2026-01-17T10:02:00.000Z',
      },
    ];

    // Provider C: 200 tokens (20%), 90% quality - FAILS (quality < 95%)
    const providerCResults: BenchmarkResult[] = [
      {
        taskId: 'task-01',
        provider: 'provider-c',
        model: 'model-c',
        output: 'Provider C output',
        inputTokens: 80,
        outputTokens: 120,
        latencyMs: 800,
        timestamp: '2026-01-17T10:03:00.000Z',
      },
    ];

    const resultsMap = new Map<string, BenchmarkResult[]>();
    resultsMap.set('claude', claudeResults);
    resultsMap.set('provider-a', providerAResults);
    resultsMap.set('provider-b', providerBResults);
    resultsMap.set('provider-c', providerCResults);

    sampleRun = {
      id: 'benchmark-claim-validation',
      timestamp: '2026-01-17T10:00:00.000Z',
      tasks: sampleTasks,
      results: resultsMap,
    };

    sampleEvaluations = [
      // Claude baseline
      {
        taskId: 'task-01',
        provider: 'claude',
        scores: { correctness: 100, completeness: 100, style: 100, efficiency: 100, overall: 100 },
        evaluatedAt: '2026-01-17T10:10:00.000Z',
        evaluatorType: 'composite' as const,
      },
      // Provider A: 96% quality - MEETS threshold
      {
        taskId: 'task-01',
        provider: 'provider-a',
        scores: { correctness: 96, completeness: 96, style: 96, efficiency: 96, overall: 96 },
        evaluatedAt: '2026-01-17T10:10:01.000Z',
        evaluatorType: 'composite' as const,
      },
      // Provider B: 97% quality - MEETS threshold
      {
        taskId: 'task-01',
        provider: 'provider-b',
        scores: { correctness: 97, completeness: 97, style: 97, efficiency: 97, overall: 97 },
        evaluatedAt: '2026-01-17T10:10:02.000Z',
        evaluatorType: 'composite' as const,
      },
      // Provider C: 90% quality - FAILS threshold
      {
        taskId: 'task-01',
        provider: 'provider-c',
        scores: { correctness: 90, completeness: 90, style: 90, efficiency: 90, overall: 90 },
        evaluatedAt: '2026-01-17T10:10:03.000Z',
        evaluatorType: 'composite' as const,
      },
    ];

    analyzer = new BenchmarkAnalyzer();
  });

  /**
   * @behavior Validates if quality >= 95% of baseline
   * @acceptance-criteria AC-ANALYSIS.4
   */
  it('should validate if quality >= 95% of baseline', () => {
    // GIVEN providers with different quality scores
    // WHEN validating the claim
    const verdict = analyzer.validateClaim(sampleRun, sampleEvaluations);

    // THEN provider-a (96%) and provider-b (97%) should meet quality threshold
    const providerA = verdict.providers.find((p) => p.provider === 'provider-a');
    expect(providerA!.meetsQualityThreshold).toBe(true);

    const providerB = verdict.providers.find((p) => p.provider === 'provider-b');
    expect(providerB!.meetsQualityThreshold).toBe(true);

    // AND provider-c (90%) should NOT meet quality threshold
    const providerC = verdict.providers.find((p) => p.provider === 'provider-c');
    expect(providerC!.meetsQualityThreshold).toBe(false);
  });

  /**
   * @behavior Validates if tokens <= 25% of baseline
   * @acceptance-criteria AC-ANALYSIS.5
   */
  it('should validate if tokens <= 25% of baseline', () => {
    // GIVEN providers with different token usage
    // Claude: 1000 tokens
    // Provider A: 200 tokens (20%) - MEETS
    // Provider B: 300 tokens (30%) - FAILS
    // Provider C: 200 tokens (20%) - MEETS

    // WHEN validating the claim
    const verdict = analyzer.validateClaim(sampleRun, sampleEvaluations);

    // THEN provider-a (20%) should meet token threshold
    const providerA = verdict.providers.find((p) => p.provider === 'provider-a');
    expect(providerA!.meetsTokenThreshold).toBe(true);

    // AND provider-b (30%) should NOT meet token threshold
    const providerB = verdict.providers.find((p) => p.provider === 'provider-b');
    expect(providerB!.meetsTokenThreshold).toBe(false);

    // AND provider-c (20%) should meet token threshold
    const providerC = verdict.providers.find((p) => p.provider === 'provider-c');
    expect(providerC!.meetsTokenThreshold).toBe(true);
  });

  /**
   * @behavior Produces clear pass/fail verdict
   * @acceptance-criteria AC-ANALYSIS.6
   */
  it('should produce clear pass/fail verdict', () => {
    // GIVEN providers with various quality and token combinations
    // WHEN validating the claim
    const verdict = analyzer.validateClaim(sampleRun, sampleEvaluations);

    // THEN provider-a should PASS (96% quality >= 95%, 20% tokens <= 25%)
    const providerA = verdict.providers.find((p) => p.provider === 'provider-a');
    expect(providerA!.verdict).toBe('PASS');

    // AND provider-b should FAIL (97% quality >= 95%, but 30% tokens > 25%)
    const providerB = verdict.providers.find((p) => p.provider === 'provider-b');
    expect(providerB!.verdict).toBe('FAIL');

    // AND provider-c should FAIL (90% quality < 95%, even though 20% tokens <= 25%)
    const providerC = verdict.providers.find((p) => p.provider === 'provider-c');
    expect(providerC!.verdict).toBe('FAIL');

    // AND overall verdict should indicate at least one provider passed
    expect(verdict.overallVerdict).toBe('CLAIM_VALIDATED');
    expect(verdict.passingProviders).toContain('provider-a');
    expect(verdict.passingProviders).toHaveLength(1);
  });
});
