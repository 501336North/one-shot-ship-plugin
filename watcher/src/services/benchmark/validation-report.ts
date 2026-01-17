/**
 * @file Validation Report Generator
 * @description Generates markdown reports with claim validation status
 *
 * @behavior ValidationReportGenerator generates markdown reports with claim status
 * @acceptance-criteria AC-VALIDATION-REPORT.1 through AC-VALIDATION-REPORT.3
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Provider validation result for the report
 */
export interface ProviderValidationResult {
  /** Provider name */
  provider: string;
  /** Model identifier */
  model: string;
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
 * Task-level result for the report
 */
export interface TaskResult {
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
 * Complete validation report data
 */
export interface ValidationReportData {
  /** ISO timestamp of when validation was run */
  validatedAt: string;
  /** The claim being validated */
  claim: string;
  /** Overall verdict: CLAIM_VALIDATED or CLAIM_NOT_VALIDATED */
  verdict: 'CLAIM_VALIDATED' | 'CLAIM_NOT_VALIDATED';
  /** Providers that passed the claim */
  passingProviders: string[];
  /** Per-provider validation results */
  providers: ProviderValidationResult[];
  /** Per-task breakdown */
  tasks: TaskResult[];
}

/**
 * Validation Report Generator - creates markdown reports for claim validation
 */
export class ValidationReportGenerator {
  /**
   * Generate a markdown report from validation data
   */
  generate(data: ValidationReportData): string {
    const lines: string[] = [];

    // Header
    lines.push('# Claim Validation Report');
    lines.push('');
    lines.push(`**Validated At:** ${data.validatedAt}`);
    lines.push(`**Claim:** ${data.claim}`);
    lines.push('');

    // Overall verdict
    const verdictIndicator = data.verdict === 'CLAIM_VALIDATED' ? 'PASS' : 'FAIL';
    lines.push(`## Overall Verdict: ${data.verdict} (${verdictIndicator})`);
    lines.push('');

    if (data.passingProviders.length > 0) {
      lines.push(`**Passing Providers:** ${data.passingProviders.join(', ')}`);
      lines.push('');
    }

    // Provider comparison table
    if (data.providers.length > 0) {
      lines.push('## Provider Comparison');
      lines.push('');
      lines.push('| Provider | Model | Quality % | Token % | Quality OK | Token OK | Verdict |');
      lines.push('|----------|-------|-----------|---------|------------|----------|---------|');

      for (const provider of data.providers) {
        const qualityOk = provider.meetsQualityThreshold ? 'Y' : 'N';
        const tokenOk = provider.meetsTokenThreshold ? 'Y' : 'N';
        lines.push(
          `| ${provider.provider} | ${provider.model} | ${provider.qualityPercent}% | ${provider.tokenPercent}% | ${qualityOk} | ${tokenOk} | ${provider.verdict} |`
        );
      }
      lines.push('');
    }

    // Task-by-task breakdown
    if (data.tasks.length > 0) {
      lines.push('## Task Breakdown');
      lines.push('');

      for (const task of data.tasks) {
        lines.push(`### ${task.taskId}: ${task.taskName}`);
        lines.push('');
        lines.push(`**Category:** ${task.category}`);
        lines.push('');

        if (task.results.length > 0) {
          lines.push('| Provider | Tokens | Quality Score | Latency (ms) |');
          lines.push('|----------|--------|---------------|--------------|');

          for (const result of task.results) {
            lines.push(
              `| ${result.provider} | ${result.tokens} | ${result.qualityScore} | ${result.latencyMs} |`
            );
          }
          lines.push('');
        }
      }
    }

    // Claim thresholds
    lines.push('## Claim Thresholds');
    lines.push('');
    lines.push('- **Quality:** >= 95% of Claude baseline');
    lines.push('- **Token:** <= 25% of Claude baseline');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Save report to ~/.oss/benchmarks/ directory
   */
  saveReport(data: ValidationReportData): string {
    const benchmarksDir = this.getBenchmarksDir();
    this.ensureBenchmarksDir(benchmarksDir);

    const report = this.generate(data);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `validation-${timestamp}.md`;
    const filepath = path.join(benchmarksDir, filename);

    fs.writeFileSync(filepath, report, 'utf-8');

    return filepath;
  }

  /**
   * Get the benchmarks output directory path
   */
  private getBenchmarksDir(): string {
    return path.join(os.homedir(), '.oss', 'benchmarks');
  }

  /**
   * Ensure the benchmarks directory exists
   */
  private ensureBenchmarksDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
