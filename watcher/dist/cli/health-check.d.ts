#!/usr/bin/env node
/**
 * Health Check CLI
 *
 * Runs npm test and queues any failing tests to the watcher queue.
 * Called by session-start hook to catch pre-existing issues.
 *
 * Usage:
 *   node health-check.js [--quiet] [--verbose]
 *
 * Exit codes:
 *   0 - All tests passing
 *   1 - Tests failing (tasks queued)
 *   2 - Error running tests
 */
import { HealthReport, CheckStatus, OverallStatus } from '../types.js';
/**
 * Format status indicator with symbol and color
 */
export declare function formatStatusIndicator(status: CheckStatus): string;
/**
 * Format overall status summary
 */
export declare function formatOverallStatus(status: OverallStatus): string;
/**
 * Format health report for display
 */
export declare function formatHealthReport(report: HealthReport, verbose: boolean): string;
/**
 * Write health report to log file
 */
export declare function writeHealthReportLog(report: HealthReport, logsPath: string): void;
//# sourceMappingURL=health-check.d.ts.map