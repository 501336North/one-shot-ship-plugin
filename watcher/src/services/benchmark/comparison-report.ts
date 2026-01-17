/**
 * @file Comparison Report Generator
 * @description Generates markdown reports from model comparison results
 *
 * @behavior ComparisonReportGenerator generates markdown reports with verdict and task breakdown
 * @acceptance-criteria AC-COMPARISON-REPORT.1 through AC-COMPARISON-REPORT.4
 */

import * as fs from 'fs';
import type { ClaimValidationResult } from './comparison-claim-validator.js';
import type { JudgeResults } from './judge-executor.js';
import type { ComparisonResult } from './comparison-executor.js';
import type { ComparisonTask } from './comparison-tasks.js';

/**
 * ComparisonReportGenerator - Creates markdown reports for model comparison results
 *
 * The report includes:
 * - Overall verdict (CLAIM_VALIDATED / CLAIM_NOT_VALIDATED)
 * - Average quality score and token ratio
 * - Per-task breakdown with scores and token counts
 * - Threshold information
 */
export class ComparisonReportGenerator {
  /**
   * Generate a markdown report from comparison results
   *
   * @param verdict - The claim validation result
   * @param judgeResults - Results from the quality judge
   * @param comparisons - Comparison results with token data
   * @param tasks - The comparison tasks that were evaluated
   * @returns Markdown string
   */
  generate(
    verdict: ClaimValidationResult,
    judgeResults: JudgeResults,
    comparisons: ComparisonResult[],
    tasks: ComparisonTask[]
  ): string {
    const lines: string[] = [];

    // Header
    lines.push('# Model Comparison Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push('');

    // Overall verdict
    const verdictIndicator = verdict.verdict === 'CLAIM_VALIDATED' ? 'PASS' : 'FAIL';
    lines.push(`## Verdict: ${verdict.verdict} (${verdictIndicator})`);
    lines.push('');
    lines.push(`- **Average Quality:** ${verdict.avgQuality}%`);
    lines.push(`- **Average Token Ratio:** ${Math.round(verdict.avgTokenRatio * 100)}%`);
    lines.push('');

    // Thresholds
    lines.push('### Claim Thresholds');
    lines.push('');
    lines.push('| Metric | Required | Actual | Status |');
    lines.push('|--------|----------|--------|--------|');
    const qualityStatus = verdict.avgQuality >= 95 ? 'PASS' : 'FAIL';
    const tokenStatus = verdict.avgTokenRatio <= 0.25 ? 'PASS' : 'FAIL';
    lines.push(`| Quality | >= 95% | ${verdict.avgQuality}% | ${qualityStatus} |`);
    lines.push(`| Token Ratio | <= 25% | ${Math.round(verdict.avgTokenRatio * 100)}% | ${tokenStatus} |`);
    lines.push('');

    // Per-task breakdown
    if (judgeResults.taskResults.length > 0) {
      lines.push('## Task Breakdown');
      lines.push('');
      lines.push('*Note: Token ratio compares OUTPUT tokens only (apples-to-apples comparison)*');
      lines.push('');
      lines.push('| Task ID | Name | Category | Score | Claude Est. | Ollama Out | Ratio |');
      lines.push('|---------|------|----------|-------|-------------|------------|-------|');

      // Index tasks and comparisons for lookup
      const taskMap = new Map<string, ComparisonTask>();
      for (const task of tasks) {
        taskMap.set(task.id, task);
      }

      const comparisonMap = new Map<string, ComparisonResult>();
      for (const comparison of comparisons) {
        comparisonMap.set(comparison.taskId, comparison);
      }

      for (const result of judgeResults.taskResults) {
        const task = taskMap.get(result.taskId);
        const comparison = comparisonMap.get(result.taskId);

        const taskName = task?.name ?? 'Unknown';
        const category = task?.category ?? 'unknown';
        const score = result.judgeResult.weightedScore;

        let claudeTokens = '-';
        let ollamaTokens = '-';
        let ratioStr = '-';
        if (comparison) {
          claudeTokens = String(comparison.baseline.estimatedTokens);
          ollamaTokens = String(comparison.challenger.outputTokens);
          ratioStr = `${Math.round(comparison.tokenRatio * 100)}%`;
        }

        lines.push(`| ${result.taskId} | ${taskName} | ${category} | ${score} | ${claudeTokens} | ${ollamaTokens} | ${ratioStr} |`);
      }
      lines.push('');
    }

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Tasks Evaluated:** ${judgeResults.taskResults.length}`);
    lines.push(`- **Average Weighted Score:** ${judgeResults.averageScore.toFixed(2)}`);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Save a report to a file path
   *
   * @param report - The markdown report content
   * @param filepath - The file path to save to
   */
  save(report: string, filepath: string): void {
    fs.writeFileSync(filepath, report, 'utf-8');
  }
}
