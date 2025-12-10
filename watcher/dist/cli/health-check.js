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
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { QueueManager } from '../queue/manager.js';
import { TestMonitor } from '../monitors/test-monitor.js';
import { HealthcheckService } from '../services/healthcheck.js';
// Logging helper that respects quiet/verbose modes
function log(message, quiet, verbose, level = 'info') {
    if (quiet)
        return;
    if (level === 'detail' && !verbose)
        return;
    console.log(message);
}
/**
 * Format status indicator with symbol and color
 */
export function formatStatusIndicator(status) {
    switch (status) {
        case 'pass':
            return '✅';
        case 'warn':
            return '⚠️';
        case 'fail':
            return '❌';
        default:
            return '❓';
    }
}
/**
 * Format overall status summary
 */
export function formatOverallStatus(status) {
    switch (status) {
        case 'healthy':
            return '✅ HEALTHY';
        case 'warning':
            return '⚠️  WARNING';
        case 'critical':
            return '❌ CRITICAL';
        default:
            return '❓ UNKNOWN';
    }
}
/**
 * Format a single check line with proper spacing
 */
function formatCheckLine(label, indicator, message, isLast = false) {
    const prefix = isLast ? '└─' : '├─';
    return `   ${prefix} ${label.padEnd(15)} ${indicator} ${message}`;
}
/**
 * Format health report for display
 */
export function formatHealthReport(report, verbose) {
    const lines = [];
    lines.push('');
    lines.push('📊 SYSTEM HEALTH CHECK');
    lines.push('─'.repeat(50));
    lines.push(`   Overall: ${formatOverallStatus(report.overall_status)}`);
    lines.push('');
    if (verbose) {
        lines.push('   Individual Checks:');
        const checks = [
            { label: 'Logging:', check: report.checks.logging },
            { label: 'Dev Docs:', check: report.checks.dev_docs },
            { label: 'Delegation:', check: report.checks.delegation },
            { label: 'Queue:', check: report.checks.queue },
            { label: 'Archive:', check: report.checks.archive },
            { label: 'Quality Gates:', check: report.checks.quality_gates },
            { label: 'Notifications:', check: report.checks.notifications },
            { label: 'Git Safety:', check: report.checks.git_safety },
        ];
        checks.forEach((item, index) => {
            const isLast = index === checks.length - 1;
            lines.push(formatCheckLine(item.label, formatStatusIndicator(item.check.status), item.check.message, isLast));
        });
    }
    return lines.join('\n');
}
/**
 * Format a check result for log file
 */
function formatCheckForLog(label, status, message) {
    return `  - ${label.padEnd(16)} ${status.padEnd(4)} | ${message}`;
}
/**
 * Write health report to log file
 */
export function writeHealthReportLog(report, logsPath) {
    const logFile = path.join(logsPath, 'health-check.log');
    const separator = '═'.repeat(60);
    const lines = [
        separator,
        'HEALTH CHECK REPORT',
        separator,
        `Timestamp: ${report.timestamp}`,
        `Overall Status: ${report.overall_status}`,
        '',
        'Individual Checks:',
    ];
    // Add all checks
    const checkEntries = [
        { label: 'Logging:', check: report.checks.logging },
        { label: 'Dev Docs:', check: report.checks.dev_docs },
        { label: 'Delegation:', check: report.checks.delegation },
        { label: 'Queue:', check: report.checks.queue },
        { label: 'Archive:', check: report.checks.archive },
        { label: 'Quality Gates:', check: report.checks.quality_gates },
        { label: 'Notifications:', check: report.checks.notifications },
        { label: 'Git Safety:', check: report.checks.git_safety },
    ];
    checkEntries.forEach(entry => {
        lines.push(formatCheckForLog(entry.label, entry.check.status, entry.check.message));
    });
    lines.push(separator, '');
    fs.writeFileSync(logFile, lines.join('\n'), 'utf-8');
}
async function runHealthCheck(quiet = false, verbose = false) {
    // Global OSS directory for logs and session state
    const globalOssDir = path.join(process.env.HOME || '', '.oss');
    // Project-local OSS directory for queue
    const projectOssDir = path.join(process.cwd(), '.oss');
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(process.env.HOME || '', '.claude', 'plugins', 'cache', 'oss');
    const projectName = path.basename(process.cwd());
    log(`\n🔍 OSS Health Check - ${projectName}`, quiet, verbose);
    log(`${'─'.repeat(50)}`, quiet, verbose);
    // Ensure global .oss directory exists for logs
    if (!fs.existsSync(globalOssDir)) {
        fs.mkdirSync(globalOssDir, { recursive: true });
        log(`📁 Created global .oss directory`, quiet, verbose, 'detail');
    }
    // Ensure project-local .oss directory exists for queue
    if (!fs.existsSync(projectOssDir)) {
        fs.mkdirSync(projectOssDir, { recursive: true });
        log(`📁 Created project .oss directory`, quiet, verbose, 'detail');
    }
    // Check for package.json
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        const msg = 'No package.json found - skipping health check';
        log(`⚠️  ${msg}`, quiet, verbose);
        return {
            passed: true,
            failureCount: 0,
            message: msg,
            queuedTasks: 0,
        };
    }
    // Initialize queue manager (uses project-local .oss for queue.json)
    log(`📋 Initializing queue manager...`, quiet, verbose, 'detail');
    const queueManager = new QueueManager(projectOssDir);
    await queueManager.initialize();
    // Disable debug notifications during health check to reduce noise
    queueManager.setDebugNotifications(false);
    // Initialize test monitor
    const testMonitor = new TestMonitor(queueManager);
    // Send start notification
    if (!quiet) {
        sendNotification(pluginRoot, '🔍 Health Check', `Running tests for ${projectName}...`, 'high');
    }
    log(`🧪 Running npm test...`, quiet, verbose);
    const startTime = Date.now();
    try {
        // Run npm test and capture output
        const output = execSync('npm test 2>&1', {
            cwd: process.cwd(),
            timeout: 300000, // 5 minutes max
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        // Analyze output
        log(`📊 Analyzing test output...`, quiet, verbose, 'detail');
        const result = await testMonitor.analyzeTestOutput(output);
        // Run system health checks
        log(`🏥 Running system health checks...`, quiet, verbose);
        const healthcheckService = new HealthcheckService({
            logReader: null,
            queueManager,
            fileSystem: null,
            // Session logs are in global ~/.oss/
            sessionLogPath: path.join(globalOssDir, 'logs', 'current-session', 'session.log'),
            sessionActive: true,
            // Dev docs are in global ~/.oss/dev/active/
            featurePath: path.join(globalOssDir, 'dev', 'active', 'current-feature'),
            devActivePath: path.join(globalOssDir, 'dev', 'active'),
        });
        const healthReport = await healthcheckService.runChecks();
        // Display health report
        const healthOutput = formatHealthReport(healthReport, verbose);
        log(healthOutput, quiet, verbose);
        // Write health report to log (global ~/.oss/logs/)
        const logsPath = path.join(globalOssDir, 'logs', 'current-session');
        if (!fs.existsSync(logsPath)) {
            fs.mkdirSync(logsPath, { recursive: true });
        }
        writeHealthReportLog(healthReport, logsPath);
        // Only treat as failure if we have actual test names
        // This prevents false positives from build tool output
        if (result.hasFailures && result.failedTests.length > 0) {
            // Queue failing tests
            await testMonitor.reportFailure(result);
            const pendingCount = await queueManager.getPendingCount();
            const message = `${result.failedTests.length} test(s) failing`;
            log(`\n❌ HEALTH CHECK FAILED`, quiet, verbose);
            log(`${'─'.repeat(50)}`, quiet, verbose);
            log(`   Duration: ${duration}s`, quiet, verbose);
            log(`   Failed:   ${result.failedTests.length} test(s)`, quiet, verbose);
            log(`   Queued:   ${pendingCount} task(s) for fixing`, quiet, verbose);
            if (result.failedTests.length > 0) {
                log(`\n   Failing tests:`, quiet, verbose);
                result.failedTests.slice(0, 5).forEach((test, i) => {
                    log(`   ${i + 1}. ${test}`, quiet, verbose);
                });
                if (result.failedTests.length > 5) {
                    log(`   ... and ${result.failedTests.length - 5} more`, quiet, verbose);
                }
            }
            sendNotification(pluginRoot, '❌ Health Check Failed', `${message} - ${pendingCount} queued`, 'critical');
            return {
                passed: false,
                failureCount: result.failedTests.length,
                message,
                queuedTasks: pendingCount,
                details: result.failedTests.join('\n'),
            };
        }
        // Extract test counts from output
        const passMatch = output.match(/(\d+)\s+pass/i);
        const testCount = passMatch ? passMatch[1] : result.passedTests.length.toString();
        // Check if system health has critical issues
        const systemHealthFailed = healthReport.overall_status === 'critical';
        const systemHealthWarning = healthReport.overall_status === 'warning';
        if (systemHealthFailed) {
            // Count how many checks failed
            const failedChecks = Object.values(healthReport.checks).filter(c => c.status === 'fail').length;
            log(`\n⚠️  HEALTH CHECK WARNING`, quiet, verbose);
            log(`${'─'.repeat(50)}`, quiet, verbose);
            log(`   Duration: ${duration}s`, quiet, verbose);
            log(`   Tests:    ${testCount} passing`, quiet, verbose);
            log(`   System:   ${failedChecks} check(s) failing`, quiet, verbose);
            sendNotification(pluginRoot, '⚠️ Health Check Warning', `Tests pass but ${failedChecks} system check(s) failing`, 'high');
            return {
                passed: true, // Tests pass, but warn about system issues
                failureCount: 0,
                message: `Tests passing (${testCount}) but ${failedChecks} system check(s) failing`,
                queuedTasks: 0,
            };
        }
        if (systemHealthWarning) {
            const warnChecks = Object.values(healthReport.checks).filter(c => c.status === 'warn').length;
            log(`\n✅ HEALTH CHECK PASSED (with warnings)`, quiet, verbose);
            log(`${'─'.repeat(50)}`, quiet, verbose);
            log(`   Duration: ${duration}s`, quiet, verbose);
            log(`   Tests:    ${testCount} passing`, quiet, verbose);
            log(`   System:   ${warnChecks} warning(s)`, quiet, verbose);
            sendNotification(pluginRoot, '✅ Health Check Passed', `${testCount} tests, ${warnChecks} warning(s)`, 'high');
            return {
                passed: true,
                failureCount: 0,
                message: `All tests passing (${testCount}), ${warnChecks} warning(s)`,
                queuedTasks: 0,
            };
        }
        log(`\n✅ HEALTH CHECK PASSED`, quiet, verbose);
        log(`${'─'.repeat(50)}`, quiet, verbose);
        log(`   Duration: ${duration}s`, quiet, verbose);
        log(`   Tests:    ${testCount} passing`, quiet, verbose);
        sendNotification(pluginRoot, '✅ Health Check Passed', `${testCount} tests passing`, 'high');
        return {
            passed: true,
            failureCount: 0,
            message: `All tests passing (${testCount})`,
            queuedTasks: 0,
        };
    }
    catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        // Extract error details
        const execError = error;
        const errorOutput = execError.stdout || '';
        const errorStderr = execError.stderr || '';
        const exitCode = execError.status;
        const errorMessage = execError.message || 'Unknown error';
        log(`\n⚠️  TEST COMMAND FAILED`, quiet, verbose);
        log(`${'─'.repeat(50)}`, quiet, verbose);
        log(`   Duration:  ${duration}s`, quiet, verbose);
        log(`   Exit code: ${exitCode ?? 'unknown'}`, quiet, verbose);
        // Show verbose error details
        if (verbose) {
            log(`\n   Error message:`, quiet, verbose, 'detail');
            log(`   ${errorMessage.split('\n')[0]}`, quiet, verbose, 'detail');
            if (errorStderr) {
                log(`\n   Stderr (last 500 chars):`, quiet, verbose, 'detail');
                const stderrTail = errorStderr.slice(-500).trim();
                stderrTail.split('\n').forEach(line => {
                    log(`   ${line}`, quiet, verbose, 'detail');
                });
            }
        }
        if (errorOutput) {
            const result = await testMonitor.analyzeTestOutput(errorOutput);
            // Only report specific failures if we actually found test names
            if (result.hasFailures && result.failedTests.length > 0) {
                await testMonitor.reportFailure(result);
                const pendingCount = await queueManager.getPendingCount();
                const message = `${result.failedTests.length} test(s) failing`;
                log(`\n   Test failures detected:`, quiet, verbose);
                log(`   Failed:  ${result.failedTests.length} test(s)`, quiet, verbose);
                log(`   Queued:  ${pendingCount} task(s) for fixing`, quiet, verbose);
                if (result.failedTests.length > 0) {
                    log(`\n   Failing tests:`, quiet, verbose);
                    result.failedTests.slice(0, 5).forEach((test, i) => {
                        log(`   ${i + 1}. ${test}`, quiet, verbose);
                    });
                    if (result.failedTests.length > 5) {
                        log(`   ... and ${result.failedTests.length - 5} more`, quiet, verbose);
                    }
                }
                sendNotification(pluginRoot, '❌ Health Check Failed', `${message} - ${pendingCount} queued`, 'critical');
                return {
                    passed: false,
                    failureCount: result.failedTests.length,
                    message,
                    queuedTasks: pendingCount,
                    details: result.failedTests.join('\n'),
                };
            }
            // hasFailures but no specific tests found - likely build/parse error
            if (result.hasFailures) {
                log(`\n   ⚠️  Tests failed but could not parse specific failures`, quiet, verbose);
                log(`   This usually means a build error or configuration issue`, quiet, verbose);
                // Try to extract useful info from output
                const buildErrorMatch = errorOutput.match(/error TS\d+:|SyntaxError:|Cannot find module|Module not found/i);
                if (buildErrorMatch) {
                    log(`\n   Possible cause: ${buildErrorMatch[0]}`, quiet, verbose);
                    // Show context around the error
                    const errorIndex = errorOutput.indexOf(buildErrorMatch[0]);
                    if (errorIndex !== -1) {
                        const contextStart = Math.max(0, errorIndex - 100);
                        const contextEnd = Math.min(errorOutput.length, errorIndex + 200);
                        const context = errorOutput.slice(contextStart, contextEnd).trim();
                        log(`\n   Context:`, quiet, verbose, 'detail');
                        context.split('\n').slice(0, 5).forEach(line => {
                            log(`   ${line.trim()}`, quiet, verbose, 'detail');
                        });
                    }
                }
                sendNotification(pluginRoot, '⚠️ Test Run Failed', 'Build or config error - check output', 'high');
                return {
                    passed: false,
                    failureCount: 0,
                    message: 'Test run failed - build or config error',
                    queuedTasks: 0,
                    details: buildErrorMatch ? buildErrorMatch[0] : 'Unknown build error',
                };
            }
            // No failures detected in output but command still failed
            log(`\n   ⚠️  Command failed but no test failures detected`, quiet, verbose);
            log(`   Exit code: ${exitCode}`, quiet, verbose);
            // Check for common issues
            if (errorOutput.includes('npm ERR!')) {
                const npmError = errorOutput.match(/npm ERR! (.+)/);
                if (npmError) {
                    log(`   npm error: ${npmError[1]}`, quiet, verbose);
                }
            }
            sendNotification(pluginRoot, '⚠️ Health Check Warning', `Exit code ${exitCode} - no failures found`, 'high');
            return {
                passed: true, // No actual test failures detected
                failureCount: 0,
                message: `Command exited with code ${exitCode} but no test failures detected`,
                queuedTasks: 0,
            };
        }
        // No output at all - generic error
        log(`\n   ❌ Could not run tests`, quiet, verbose);
        log(`   Error: ${errorMessage.split('\n')[0]}`, quiet, verbose);
        sendNotification(pluginRoot, '⚠️ Health Check Error', 'Could not run npm test', 'high');
        return {
            passed: false,
            failureCount: 0,
            message: `Error: ${errorMessage.split('\n')[0]}`,
            queuedTasks: 0,
            details: errorMessage,
        };
    }
}
function sendNotification(pluginRoot, title, message, priority) {
    try {
        const notifyScript = path.join(pluginRoot, 'hooks', 'oss-notify.sh');
        if (fs.existsSync(notifyScript)) {
            execSync(`"${notifyScript}" "${title}" "${message}" ${priority}`, {
                timeout: 5000,
                stdio: 'ignore',
            });
        }
        else {
            // Fallback to terminal-notifier
            execSync(`terminal-notifier -title "${title}" -message "${message}" -sound default`, {
                timeout: 5000,
                stdio: 'ignore',
            });
        }
    }
    catch {
        // Ignore notification errors
    }
}
// Main execution - only run when called directly (not when imported)
// Use import.meta.url check for ESM compatibility
const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('health-check.js');
if (isMainModule) {
    const quiet = process.argv.includes('--quiet') || process.argv.includes('-q');
    const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
    runHealthCheck(quiet, verbose)
        .then((result) => {
        if (!quiet) {
            console.log(`${'─'.repeat(50)}\n`);
        }
        if (result.passed) {
            process.exit(0);
        }
        else if (result.failureCount > 0) {
            process.exit(1);
        }
        else {
            process.exit(2);
        }
    })
        .catch((error) => {
        console.error('\n❌ Fatal error:', error);
        process.exit(2);
    });
}
//# sourceMappingURL=health-check.js.map