/**
 * @file Validate Claim CLI Tests
 * @behavior CLI runs full benchmark validation and produces PASS/FAIL verdict for claim
 * @acceptance-criteria AC-VALIDATE-CLAIM.1 through AC-VALIDATE-CLAIM.3
 * @boundary CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

// Mock the benchmark services
const mockRunBenchmark = vi.fn();
const mockEvaluate = vi.fn();
const mockValidateClaim = vi.fn();
const mockAnalyze = vi.fn();

vi.mock('../../src/services/benchmark/runner.js', () => ({
  BenchmarkRunner: vi.fn().mockImplementation(() => ({
    runBenchmark: mockRunBenchmark,
  })),
}));

vi.mock('../../src/services/benchmark/evaluator.js', () => ({
  AutomatedEvaluator: vi.fn().mockImplementation(() => ({
    evaluate: mockEvaluate,
  })),
}));

vi.mock('../../src/services/benchmark/analysis.js', () => ({
  BenchmarkAnalyzer: vi.fn().mockImplementation(() => ({
    analyze: mockAnalyze,
    validateClaim: mockValidateClaim,
  })),
}));

vi.mock('../../src/services/benchmark/standard-tasks.js', () => ({
  STANDARD_TASKS: [
    { id: 'code-review-01', name: 'Review function', category: 'code-review', prompt: 'test', expectedBehavior: [] },
    { id: 'bug-fix-01', name: 'Fix bug', category: 'bug-fix', prompt: 'test', expectedBehavior: [] },
  ],
}));

describe('Validate Claim CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default mocks for fs
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.mkdirSync as Mock).mockReturnValue(undefined);
    (fs.writeFileSync as Mock).mockReturnValue(undefined);

    // Default mock results
    mockRunBenchmark.mockResolvedValue({
      id: 'benchmark-test-id',
      timestamp: '2025-01-17T12:00:00.000Z',
      tasks: [
        { id: 'code-review-01', name: 'Review function', category: 'code-review', prompt: 'test', expectedBehavior: [] },
      ],
      results: new Map([
        ['claude', [{ taskId: 'code-review-01', model: 'claude-3-opus', inputTokens: 1000, outputTokens: 500, output: 'Claude output', latencyMs: 1500 }]],
        ['ollama', [{ taskId: 'code-review-01', model: 'qwen2.5-coder:7b', inputTokens: 200, outputTokens: 100, output: 'Ollama output', latencyMs: 500 }]],
      ]),
    });

    mockEvaluate.mockResolvedValue({
      taskId: 'code-review-01',
      provider: 'ollama',
      scores: {
        correctness: 95,
        completeness: 96,
        style: 94,
        efficiency: 95,
        overall: 95,
      },
      evaluatedAt: '2025-01-17T12:00:00.000Z',
      evaluatorType: 'automated',
    });

    mockAnalyze.mockReturnValue({
      id: 'analysis-test-id',
      generatedAt: '2025-01-17T12:00:00.000Z',
      baselineProvider: 'claude',
      providers: [
        { provider: 'claude', model: 'claude-3-opus', totalTokens: 1500, avgQualityScore: 100, qualityPercentVsBaseline: 100, tokenPercentVsBaseline: 100 },
        { provider: 'ollama', model: 'qwen2.5-coder:7b', totalTokens: 300, avgQualityScore: 95, qualityPercentVsBaseline: 95, tokenPercentVsBaseline: 20 },
      ],
    });

    mockValidateClaim.mockReturnValue({
      claim: '95% quality for 25% tokens',
      overallVerdict: 'CLAIM_VALIDATED',
      passingProviders: ['ollama'],
      providers: [
        { provider: 'ollama', qualityPercent: 95, tokenPercent: 20, meetsQualityThreshold: true, meetsTokenThreshold: true, verdict: 'PASS' },
      ],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior CLI runs benchmarks on all configured providers
   * @acceptance-criteria AC-VALIDATE-CLAIM.1
   */
  describe('running benchmarks on providers', () => {
    it('should run benchmarks on all configured providers', async () => {
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: false });

      // Verify BenchmarkRunner was called to run benchmarks
      expect(mockRunBenchmark).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should use ProviderFactory to route to correct providers', async () => {
      const { BenchmarkRunner } = await import('../../src/services/benchmark/runner.js');
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      await executeValidateClaim({ showHelp: false, providers: 'ollama,openrouter' });

      // Verify BenchmarkRunner was constructed with provider configurations
      expect(BenchmarkRunner).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.arrayContaining([
            expect.objectContaining({ name: 'claude' }), // Always includes baseline
            expect.objectContaining({ name: 'ollama' }),
            expect.objectContaining({ name: 'openrouter' }),
          ]),
        })
      );
    });

    it('should filter to specific task when --task is provided', async () => {
      const { BenchmarkRunner } = await import('../../src/services/benchmark/runner.js');
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      await executeValidateClaim({ showHelp: false, task: 'code-review' });

      // Verify BenchmarkRunner was constructed with filtered tasks
      expect(BenchmarkRunner).toHaveBeenCalledWith(
        expect.objectContaining({
          tasks: expect.arrayContaining([
            expect.objectContaining({ category: 'code-review' }),
          ]),
        })
      );
    });
  });

  /**
   * @behavior CLI calculates quality and token percentages vs baseline
   * @acceptance-criteria AC-VALIDATE-CLAIM.2
   */
  describe('calculating percentages vs baseline', () => {
    it('should calculate quality percentage vs baseline', async () => {
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: false });

      // Result should contain quality percentage information
      expect(result).toContain('95%'); // Quality percentage
    });

    it('should calculate token percentage vs baseline', async () => {
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: false });

      // Result should contain token percentage information
      expect(result).toContain('20%'); // Token percentage
    });

    it('should use BenchmarkAnalyzer to validate claim', async () => {
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      await executeValidateClaim({ showHelp: false });

      // Verify BenchmarkAnalyzer.validateClaim was called
      expect(mockValidateClaim).toHaveBeenCalled();
    });
  });

  /**
   * @behavior CLI produces PASS/FAIL verdict for claim
   * @acceptance-criteria AC-VALIDATE-CLAIM.3
   */
  describe('PASS/FAIL verdict', () => {
    it('should return PASS if quality >= 95% AND tokens <= 25%', async () => {
      mockValidateClaim.mockReturnValue({
        claim: '95% quality for 25% tokens',
        overallVerdict: 'CLAIM_VALIDATED',
        passingProviders: ['ollama'],
        providers: [
          { provider: 'ollama', qualityPercent: 96, tokenPercent: 20, meetsQualityThreshold: true, meetsTokenThreshold: true, verdict: 'PASS' },
        ],
      });

      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: false });

      expect(result).toContain('PASS');
      expect(result).toContain('CLAIM_VALIDATED');
    });

    it('should return FAIL if quality < 95%', async () => {
      mockValidateClaim.mockReturnValue({
        claim: '95% quality for 25% tokens',
        overallVerdict: 'CLAIM_NOT_VALIDATED',
        passingProviders: [],
        providers: [
          { provider: 'ollama', qualityPercent: 90, tokenPercent: 20, meetsQualityThreshold: false, meetsTokenThreshold: true, verdict: 'FAIL' },
        ],
      });

      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: false });

      expect(result).toContain('FAIL');
      expect(result).toContain('CLAIM_NOT_VALIDATED');
    });

    it('should return FAIL if tokens > 25%', async () => {
      mockValidateClaim.mockReturnValue({
        claim: '95% quality for 25% tokens',
        overallVerdict: 'CLAIM_NOT_VALIDATED',
        passingProviders: [],
        providers: [
          { provider: 'ollama', qualityPercent: 96, tokenPercent: 30, meetsQualityThreshold: true, meetsTokenThreshold: false, verdict: 'FAIL' },
        ],
      });

      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: false });

      expect(result).toContain('FAIL');
      expect(result).toContain('CLAIM_NOT_VALIDATED');
    });

    it('should output in JSON format when --format json is specified', async () => {
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: false, format: 'json' });

      // Should be valid JSON
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('verdict');
      expect(parsed).toHaveProperty('providers');
    });
  });

  /**
   * CLI argument parsing tests
   */
  describe('argument parsing', () => {
    it('should parse --providers flag', async () => {
      const { parseValidateClaimArgs } = await import('../../src/cli/validate-claim.js');

      const args = parseValidateClaimArgs(['--providers', 'ollama,openrouter']);

      expect(args.providers).toBe('ollama,openrouter');
    });

    it('should parse --task flag', async () => {
      const { parseValidateClaimArgs } = await import('../../src/cli/validate-claim.js');

      const args = parseValidateClaimArgs(['--task', 'code-review']);

      expect(args.task).toBe('code-review');
    });

    it('should parse --format flag', async () => {
      const { parseValidateClaimArgs } = await import('../../src/cli/validate-claim.js');

      const args = parseValidateClaimArgs(['--format', 'json']);

      expect(args.format).toBe('json');
    });

    it('should parse --help flag', async () => {
      const { parseValidateClaimArgs } = await import('../../src/cli/validate-claim.js');

      const args = parseValidateClaimArgs(['--help']);

      expect(args.showHelp).toBe(true);
    });

    it('should show help text with usage examples', async () => {
      const { executeValidateClaim } = await import('../../src/cli/validate-claim.js');

      const result = await executeValidateClaim({ showHelp: true });

      expect(result).toContain('Usage:');
      expect(result).toContain('--providers');
      expect(result).toContain('--task');
      expect(result).toContain('--format');
    });
  });
});
