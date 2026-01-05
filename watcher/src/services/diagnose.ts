/**
 * Diagnose Service
 *
 * Analyzes command failures and provides actionable recovery guidance.
 * Implements Stripe-style error experience with pattern matching
 * and self-service recovery suggestions.
 */

import { ErrorRegistry, ErrorCategory, OSSError } from './error-codes';

interface AnalyzeInput {
  command: string;
  exitCode: number;
  output: string;
}

interface DiagnosisResult {
  errorCode: string;
  category: string;
  message: string;
  cause: string;
  recovery: string[];
  relatedCommands: string[];
  confidence: number;
  learnMore: string;
}

interface ErrorPattern {
  pattern: RegExp;
  errorCode: string;
  confidence: number;
}

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

export class DiagnoseService {
  private registry: ErrorRegistry;
  private patterns: ErrorPattern[];

  constructor() {
    this.registry = new ErrorRegistry();
    this.patterns = this.initializePatterns();
  }

  private initializePatterns(): ErrorPattern[] {
    return [
      // Auth patterns
      {
        pattern: /(?:authentication failed|invalid.?api.?key|unauthorized)/i,
        errorCode: 'OSS-AUTH-001',
        confidence: 0.9,
      },
      {
        pattern: /subscription.?expired/i,
        errorCode: 'OSS-AUTH-002',
        confidence: 0.95,
      },
      {
        pattern: /(?:no api key|not authenticated|run.*login)/i,
        errorCode: 'OSS-AUTH-003',
        confidence: 0.85,
      },

      // TDD patterns
      {
        pattern: /(?:FAIL|tests?.?fail|assertion.?error|\d+\s*failed)/i,
        errorCode: 'OSS-TDD-001',
        confidence: 0.9,
      },
      {
        pattern: /code.?before.?test/i,
        errorCode: 'OSS-TDD-002',
        confidence: 0.95,
      },
      {
        pattern: /flaky.?test/i,
        errorCode: 'OSS-TDD-003',
        confidence: 0.9,
      },

      // Git patterns
      {
        pattern: /(?:protected.?branch|cannot push.?main|on main branch)/i,
        errorCode: 'OSS-GIT-001',
        confidence: 0.95,
      },
      {
        pattern: /uncommitted.?changes/i,
        errorCode: 'OSS-GIT-002',
        confidence: 0.9,
      },
      {
        pattern: /(?:push failed|git push.*error|remote.?rejected)/i,
        errorCode: 'OSS-GIT-003',
        confidence: 0.85,
      },

      // API patterns
      {
        pattern: /(?:api.*unavailable|503|504|connection.?refused|timeout)/i,
        errorCode: 'OSS-API-001',
        confidence: 0.85,
      },

      // Workflow patterns
      {
        pattern: /context.?(?:limit|exceeded|gate)/i,
        errorCode: 'OSS-WORKFLOW-001',
        confidence: 0.9,
      },

      // Config patterns
      {
        pattern: /(?:config.*corrupt|invalid.?json|parse.?error)/i,
        errorCode: 'OSS-CONFIG-001',
        confidence: 0.8,
      },
    ];
  }

  /**
   * Analyze command output and diagnose the error
   */
  analyze(input: AnalyzeInput): DiagnosisResult {
    const { output } = input;

    // Try to match against known patterns
    for (const { pattern, errorCode, confidence } of this.patterns) {
      if (pattern.test(output)) {
        const error = this.registry.getError(errorCode);
        if (error) {
          return {
            errorCode: error.code,
            category: error.category,
            message: error.message,
            cause: error.cause,
            recovery: error.recovery,
            relatedCommands: error.relatedCommands,
            confidence,
            learnMore: error.learnMore,
          };
        }
      }
    }

    // Unknown error
    return this.createUnknownErrorResult(input);
  }

  private createUnknownErrorResult(input: AnalyzeInput): DiagnosisResult {
    return {
      errorCode: 'OSS-UNKNOWN-001',
      category: 'unknown',
      message: 'Unrecognized error occurred',
      cause: `The command "${input.command}" failed with exit code ${input.exitCode}`,
      recovery: [
        'Check the error output for specific details',
        'Run /oss:debug for detailed investigation',
        'Contact support@oneshotship.com if the issue persists',
      ],
      relatedCommands: ['/oss:debug', '/oss:status'],
      confidence: 0.3,
      learnMore: 'https://docs.oneshotship.com/troubleshooting',
    };
  }

  /**
   * Format diagnosis as a readable report
   */
  formatReport(result: DiagnosisResult): string {
    const confidencePercent = Math.round(result.confidence * 100);
    const confidenceColor = result.confidence >= 0.7 ? COLORS.green : COLORS.yellow;

    const lines: string[] = [
      `${COLORS.bold}${COLORS.cyan}╭─────────────────────────────────────────╮${COLORS.reset}`,
      `${COLORS.bold}${COLORS.cyan}│          Diagnosis Report               │${COLORS.reset}`,
      `${COLORS.bold}${COLORS.cyan}╰─────────────────────────────────────────╯${COLORS.reset}`,
      '',
      `${COLORS.bold}Error Code:${COLORS.reset} ${COLORS.red}${result.errorCode}${COLORS.reset}`,
      `${COLORS.bold}Category:${COLORS.reset}   ${result.category}`,
      `${COLORS.bold}Confidence:${COLORS.reset} ${confidenceColor}${confidencePercent}%${COLORS.reset}`,
      '',
      `${COLORS.bold}${COLORS.yellow}Problem:${COLORS.reset}`,
      `  ${result.message}`,
      '',
      `${COLORS.bold}${COLORS.yellow}Cause:${COLORS.reset}`,
      `  ${result.cause}`,
      '',
      `${COLORS.bold}${COLORS.green}Recovery Steps:${COLORS.reset}`,
    ];

    for (let i = 0; i < result.recovery.length; i++) {
      lines.push(`  ${i + 1}. ${result.recovery[i]}`);
    }

    if (result.relatedCommands.length > 0) {
      lines.push('');
      lines.push(`${COLORS.bold}${COLORS.blue}Related Commands:${COLORS.reset}`);
      lines.push(`  ${result.relatedCommands.join('  ')}`);
    }

    lines.push('');
    lines.push(`${COLORS.dim}Learn more: ${result.learnMore}${COLORS.reset}`);

    return lines.join('\n');
  }

  /**
   * Get quick suggestion for common errors
   */
  getQuickFix(errorCode: string): string | undefined {
    const quickFixes: Record<string, string> = {
      'OSS-AUTH-001': 'Run: /oss:login',
      'OSS-AUTH-002': 'Visit: https://www.oneshotship.com/pricing',
      'OSS-AUTH-003': 'Run: /oss:login',
      'OSS-TDD-001': 'Run: /oss:debug',
      'OSS-GIT-001': 'Run: git checkout -b feat/agent-<feature>',
      'OSS-API-001': 'Wait and retry',
    };

    return quickFixes[errorCode];
  }
}
