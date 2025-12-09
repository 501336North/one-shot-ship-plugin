#!/usr/bin/env node
/**
 * Health Check CLI
 *
 * Runs npm test and queues any failing tests to the watcher queue.
 * Called by session-start hook to catch pre-existing issues.
 *
 * Usage:
 *   node health-check.js [--quiet]
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

interface HealthCheckResult {
  passed: boolean;
  failureCount: number;
  message: string;
  queuedTasks: number;
}

async function runHealthCheck(quiet: boolean = false): Promise<HealthCheckResult> {
  const ossDir = path.join(process.cwd(), '.oss');
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(ossDir);

  // Ensure .oss directory exists
  if (!fs.existsSync(ossDir)) {
    fs.mkdirSync(ossDir, { recursive: true });
  }

  // Initialize queue manager
  const queueManager = new QueueManager(ossDir);
  await queueManager.initialize();

  // Disable debug notifications during health check to reduce noise
  // We'll send one summary notification at the end
  queueManager.setDebugNotifications(false);

  // Initialize test monitor
  const testMonitor = new TestMonitor(queueManager);

  // Send start notification
  if (!quiet) {
    sendNotification(pluginRoot, '🔍 Health Check', 'Running npm test...', 'high');
  }

  try {
    // Run npm test and capture output
    const output = execSync('npm test 2>&1', {
      cwd: process.cwd(),
      timeout: 300000, // 5 minutes max
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Analyze output
    const result = await testMonitor.analyzeTestOutput(output);

    if (result.hasFailures) {
      // Queue failing tests
      await testMonitor.reportFailure(result);

      const pendingCount = await queueManager.getPendingCount();
      const message = `${result.failedTests.length} test(s) failing`;

      if (!quiet) {
        console.log(`❌ Health check failed: ${message}`);
        console.log(`   ${pendingCount} task(s) queued for fixing`);
        sendNotification(pluginRoot, '❌ Health Check Failed', `${message} - ${pendingCount} queued`, 'critical');
      }

      return {
        passed: false,
        failureCount: result.failedTests.length,
        message,
        queuedTasks: pendingCount,
      };
    }

    if (!quiet) {
      console.log('✅ Health check passed: All tests passing');
      sendNotification(pluginRoot, '✅ Health Check Passed', 'All tests passing', 'high');
    }

    return {
      passed: true,
      failureCount: 0,
      message: 'All tests passing',
      queuedTasks: 0,
    };
  } catch (error) {
    // Test command failed - likely test failures
    const errorOutput = error instanceof Error && 'stdout' in error
      ? (error as { stdout?: string }).stdout || ''
      : '';

    if (errorOutput) {
      const result = await testMonitor.analyzeTestOutput(errorOutput);

      // Only report specific failures if we actually found test names
      if (result.hasFailures && result.failedTests.length > 0) {
        await testMonitor.reportFailure(result);

        const pendingCount = await queueManager.getPendingCount();
        const message = `${result.failedTests.length} test(s) failing`;

        if (!quiet) {
          console.log(`❌ Health check failed: ${message}`);
          console.log(`   ${pendingCount} task(s) queued for fixing`);
          sendNotification(pluginRoot, '❌ Health Check Failed', `${message} - ${pendingCount} queued`, 'critical');
        }

        return {
          passed: false,
          failureCount: result.failedTests.length,
          message,
          queuedTasks: pendingCount,
        };
      }

      // hasFailures but no specific tests found - likely build/parse error
      if (result.hasFailures) {
        if (!quiet) {
          console.log(`⚠️ Tests failed but could not parse details`);
          sendNotification(pluginRoot, '⚠️ Test Run Failed', 'Check npm test output', 'high');
        }
        return {
          passed: false,
          failureCount: 0,
          message: 'Test run failed - check output',
          queuedTasks: 0,
        };
      }
    }

    // Generic error (npm test couldn't even start)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (!quiet) {
      console.log(`⚠️ Health check error: ${errorMessage}`);
      sendNotification(pluginRoot, '⚠️ Health Check Error', 'Could not run tests', 'high');
    }

    return {
      passed: false,
      failureCount: 0,
      message: `Error: ${errorMessage}`,
      queuedTasks: 0,
    };
  }
}

function sendNotification(pluginRoot: string, title: string, message: string, priority: string): void {
  try {
    const notifyScript = path.join(pluginRoot, 'hooks', 'oss-notify.sh');

    if (fs.existsSync(notifyScript)) {
      execSync(`"${notifyScript}" "${title}" "${message}" ${priority}`, {
        timeout: 5000,
        stdio: 'ignore',
      });
    } else {
      // Fallback to terminal-notifier
      execSync(`terminal-notifier -title "${title}" -message "${message}" -sound default`, {
        timeout: 5000,
        stdio: 'ignore',
      });
    }
  } catch {
    // Ignore notification errors
  }
}

// Main execution
const quiet = process.argv.includes('--quiet') || process.argv.includes('-q');

runHealthCheck(quiet)
  .then((result) => {
    if (result.passed) {
      process.exit(0);
    } else if (result.failureCount > 0) {
      process.exit(1);
    } else {
      process.exit(2);
    }
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(2);
  });
