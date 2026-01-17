/**
 * @file Validation Report Tests
 * @behavior ValidationReportGenerator generates markdown reports with claim status
 * @acceptance-criteria AC-VALIDATION-REPORT.1 through AC-VALIDATION-REPORT.3
 * @boundary Service
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

describe('Validation Report', () => {
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
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior Generator produces markdown report with claim status
   * @acceptance-criteria AC-VALIDATION-REPORT.1
   */
  describe('markdown report generation', () => {
    it('should generate markdown report with claim status', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const report = generator.generate({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: ['ollama'],
        providers: [
          {
            provider: 'ollama',
            model: 'qwen2.5-coder:7b',
            qualityPercent: 96,
            tokenPercent: 20,
            meetsQualityThreshold: true,
            meetsTokenThreshold: true,
            verdict: 'PASS',
          },
        ],
        tasks: [],
      });

      expect(report).toContain('# Claim Validation Report');
      expect(report).toContain('CLAIM_VALIDATED');
      expect(report).toContain('PASS');
    });

    it('should include claim thresholds in report', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const report = generator.generate({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_NOT_VALIDATED',
        passingProviders: [],
        providers: [
          {
            provider: 'ollama',
            model: 'qwen2.5-coder:7b',
            qualityPercent: 90,
            tokenPercent: 30,
            meetsQualityThreshold: false,
            meetsTokenThreshold: false,
            verdict: 'FAIL',
          },
        ],
        tasks: [],
      });

      expect(report).toContain('95%');
      expect(report).toContain('25%');
      expect(report).toContain('Quality');
      expect(report).toContain('Token');
    });

    it('should show CLAIM_NOT_VALIDATED when no providers pass', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const report = generator.generate({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_NOT_VALIDATED',
        passingProviders: [],
        providers: [
          {
            provider: 'ollama',
            model: 'qwen2.5-coder:7b',
            qualityPercent: 90,
            tokenPercent: 30,
            meetsQualityThreshold: false,
            meetsTokenThreshold: false,
            verdict: 'FAIL',
          },
        ],
        tasks: [],
      });

      expect(report).toContain('CLAIM_NOT_VALIDATED');
      expect(report).toContain('FAIL');
    });
  });

  /**
   * @behavior Report includes task-by-task breakdown
   * @acceptance-criteria AC-VALIDATION-REPORT.2
   */
  describe('task-by-task breakdown', () => {
    it('should include task-by-task breakdown', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const report = generator.generate({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: ['ollama'],
        providers: [
          {
            provider: 'ollama',
            model: 'qwen2.5-coder:7b',
            qualityPercent: 96,
            tokenPercent: 20,
            meetsQualityThreshold: true,
            meetsTokenThreshold: true,
            verdict: 'PASS',
          },
        ],
        tasks: [
          {
            taskId: 'code-review-01',
            taskName: 'Review authentication function',
            category: 'code-review',
            results: [
              {
                provider: 'claude',
                tokens: 1500,
                qualityScore: 100,
                latencyMs: 2000,
              },
              {
                provider: 'ollama',
                tokens: 300,
                qualityScore: 95,
                latencyMs: 500,
              },
            ],
          },
          {
            taskId: 'bug-fix-01',
            taskName: 'Fix null pointer exception',
            category: 'bug-fix',
            results: [
              {
                provider: 'claude',
                tokens: 1200,
                qualityScore: 100,
                latencyMs: 1800,
              },
              {
                provider: 'ollama',
                tokens: 250,
                qualityScore: 97,
                latencyMs: 400,
              },
            ],
          },
        ],
      });

      expect(report).toContain('Task Breakdown');
      expect(report).toContain('code-review-01');
      expect(report).toContain('bug-fix-01');
      expect(report).toContain('Review authentication function');
      expect(report).toContain('Fix null pointer exception');
    });

    it('should show quality scores per task', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const report = generator.generate({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: ['ollama'],
        providers: [
          {
            provider: 'ollama',
            model: 'qwen2.5-coder:7b',
            qualityPercent: 96,
            tokenPercent: 20,
            meetsQualityThreshold: true,
            meetsTokenThreshold: true,
            verdict: 'PASS',
          },
        ],
        tasks: [
          {
            taskId: 'code-review-01',
            taskName: 'Review function',
            category: 'code-review',
            results: [
              {
                provider: 'ollama',
                tokens: 300,
                qualityScore: 95,
                latencyMs: 500,
              },
            ],
          },
        ],
      });

      // Quality score should appear in task breakdown
      expect(report).toContain('95');
    });

    it('should show token savings percentage per task', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const report = generator.generate({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: ['ollama'],
        providers: [
          {
            provider: 'ollama',
            model: 'qwen2.5-coder:7b',
            qualityPercent: 96,
            tokenPercent: 20,
            meetsQualityThreshold: true,
            meetsTokenThreshold: true,
            verdict: 'PASS',
          },
        ],
        tasks: [
          {
            taskId: 'code-review-01',
            taskName: 'Review function',
            category: 'code-review',
            results: [
              {
                provider: 'claude',
                tokens: 1500,
                qualityScore: 100,
                latencyMs: 2000,
              },
              {
                provider: 'ollama',
                tokens: 300,
                qualityScore: 95,
                latencyMs: 500,
              },
            ],
          },
        ],
      });

      // Token count should appear in task breakdown
      expect(report).toContain('300');
      expect(report).toContain('1500');
    });
  });

  /**
   * @behavior Report is saved to ~/.oss/benchmarks/
   * @acceptance-criteria AC-VALIDATION-REPORT.3
   */
  describe('saving report to benchmarks directory', () => {
    it('should save report to ~/.oss/benchmarks/', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const filePath = generator.saveReport({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: ['ollama'],
        providers: [],
        tasks: [],
      });

      // Verify the file was saved to the correct directory
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.oss/benchmarks/validation-'),
        expect.any(String),
        expect.anything()
      );

      // Verify the returned path is correct
      expect(filePath).toContain('.oss/benchmarks/validation-');
      expect(filePath).toContain('.md');
    });

    it('should create benchmarks directory if it does not exist', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      generator.saveReport({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: [],
        providers: [],
        tasks: [],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.oss/benchmarks'), {
        recursive: true,
      });
    });

    it('should include timestamp in filename', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const filePath = generator.saveReport({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: [],
        providers: [],
        tasks: [],
      });

      // Filename should contain timestamp pattern
      expect(filePath).toMatch(/validation-\d{4}-\d{2}-\d{2}T/);
    });
  });

  /**
   * Provider comparison table tests
   */
  describe('provider comparison table', () => {
    it('should include provider comparison table', async () => {
      const { ValidationReportGenerator } = await import(
        '../../../src/services/benchmark/validation-report.js'
      );

      const generator = new ValidationReportGenerator();
      const report = generator.generate({
        validatedAt: '2025-01-17T12:00:00.000Z',
        claim: '95% quality for 25% tokens',
        verdict: 'CLAIM_VALIDATED',
        passingProviders: ['ollama', 'openrouter'],
        providers: [
          {
            provider: 'ollama',
            model: 'qwen2.5-coder:7b',
            qualityPercent: 96,
            tokenPercent: 20,
            meetsQualityThreshold: true,
            meetsTokenThreshold: true,
            verdict: 'PASS',
          },
          {
            provider: 'openrouter',
            model: 'deepseek-coder',
            qualityPercent: 95,
            tokenPercent: 22,
            meetsQualityThreshold: true,
            meetsTokenThreshold: true,
            verdict: 'PASS',
          },
        ],
        tasks: [],
      });

      expect(report).toContain('Provider');
      expect(report).toContain('ollama');
      expect(report).toContain('openrouter');
      expect(report).toContain('qwen2.5-coder:7b');
      expect(report).toContain('deepseek-coder');
    });
  });
});
