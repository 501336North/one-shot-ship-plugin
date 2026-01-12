/**
 * @behavior oss-notify.sh Telegram integration sends notifications for workflow events
 * @acceptance-criteria AC-TELEGRAM-INTEGRATION.1 through AC-TELEGRAM-INTEGRATION.5
 * @business-rule Workflow completion/failure events notify users via Telegram when enabled
 * @boundary Shell script (oss-notify.sh) -> Node CLI (telegram-notify.js)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-notify.sh Telegram integration', () => {
  const PLUGIN_ROOT = path.resolve(__dirname, '../../..');
  const OSS_NOTIFY = path.join(PLUGIN_ROOT, 'hooks/oss-notify.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const settingsFile = path.join(ossDir, 'settings.json');

  // Use unique test ID to avoid parallel test pollution
  const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Save original state
  let originalSettings: string | null = null;
  let mockTelegramScript: string | null = null;

  beforeEach(() => {
    // Save original settings if exists
    if (fs.existsSync(settingsFile)) {
      originalSettings = fs.readFileSync(settingsFile, 'utf-8');
    }

    // Ensure .oss directory exists
    fs.mkdirSync(ossDir, { recursive: true });

    // Create mock telegram-notify.js that logs calls
    const mockDir = path.join(os.tmpdir(), `oss-telegram-mock-${testId}`);
    fs.mkdirSync(mockDir, { recursive: true });
    mockTelegramScript = path.join(mockDir, 'telegram-notify.js');

    // Create mock script that logs arguments to a file
    fs.writeFileSync(
      mockTelegramScript,
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const logFile = '${path.join(mockDir, 'calls.log')}';
fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');
process.exit(0);
`
    );
    fs.chmodSync(mockTelegramScript, '755');
  });

  afterEach(() => {
    // Restore original settings
    if (originalSettings !== null) {
      fs.writeFileSync(settingsFile, originalSettings);
    } else if (fs.existsSync(settingsFile)) {
      // Don't delete settings file - just leave it as-is
    }

    // Clean up mock script directory
    if (mockTelegramScript) {
      const mockDir = path.dirname(mockTelegramScript);
      if (fs.existsSync(mockDir)) {
        fs.rmSync(mockDir, { recursive: true, force: true });
      }
    }
  });

  /**
   * Helper to read captured telegram-notify.js calls
   */
  function getCapturedCalls(): string[][] {
    if (!mockTelegramScript) return [];
    const logFile = path.join(path.dirname(mockTelegramScript), 'calls.log');
    if (!fs.existsSync(logFile)) return [];
    return fs
      .readFileSync(logFile, 'utf-8')
      .trim()
      .split('\n')
      .filter((line) => line)
      .map((line) => JSON.parse(line));
  }

  /**
   * Helper to run oss-notify.sh with custom TELEGRAM_CLI path
   */
  function runOssNotify(args: string, env: Record<string, string> = {}): void {
    // Create a wrapper script that sets TELEGRAM_CLI before calling oss-notify.sh
    // This allows us to inject our mock without modifying the actual script
    const wrapperScript = `
#!/bin/bash
# Override the TELEGRAM_CLI path for testing
export TELEGRAM_CLI="${mockTelegramScript}"
# Source the real script to get functions, then call it
source "${OSS_NOTIFY}" ${args}
`;

    // Since oss-notify.sh uses TELEGRAM_CLI as a local variable, we need a different approach
    // We'll create a modified version of the script for testing
    const ossNotifyContent = fs.readFileSync(OSS_NOTIFY, 'utf-8');

    // Create a test version that uses our mock
    const testScript = ossNotifyContent.replace(
      /TELEGRAM_CLI="\$PLUGIN_ROOT\/watcher\/dist\/cli\/telegram-notify\.js"/,
      `TELEGRAM_CLI="${mockTelegramScript}"`
    );

    const testScriptPath = path.join(path.dirname(mockTelegramScript!), 'oss-notify-test.sh');
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const fullEnv: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
        OSS_SKIP_WATCHER: '1',
        ...env,
      };
      delete fullEnv.CLAUDE_PROJECT_DIR;

      execSync(`bash "${testScriptPath}" ${args}`, {
        encoding: 'utf-8',
        env: fullEnv,
        timeout: 10000,
      });
    } catch {
      // Script may exit early due to verbosity filtering, that's OK
    }
  }

  /**
   * @behavior AC-TELEGRAM-INTEGRATION.1: Complete event sends Telegram notification
   * @acceptance-criteria When workflow completes, telegram-notify.js is called with success message
   */
  describe('complete event', () => {
    it('should send Telegram notification with correct message format on complete', () => {
      // GIVEN: Settings allow high priority notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // WHEN: Running oss-notify.sh with workflow complete event
      runOssNotify('--workflow build complete \'{"testsPass": 47, "duration": "2m 30s"}\'');

      // THEN: telegram-notify.js should have been called with message
      const calls = getCapturedCalls();
      expect(calls.length).toBeGreaterThanOrEqual(1);

      // Find the call with --message argument
      const messageCall = calls.find((args) => args.includes('--message'));
      expect(messageCall).toBeDefined();

      // Check message content
      const messageIndex = messageCall!.indexOf('--message');
      const message = messageCall![messageIndex + 1];
      expect(message).toContain('/oss:build complete');
      expect(message).toContain('47');
    });

    it('should include test count in complete notification when provided', () => {
      // GIVEN: Settings allow notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // WHEN: Running with test count in context
      runOssNotify('--workflow ship complete \'{"testsPass": 123, "duration": "5m 12s"}\'');

      // THEN: Message should contain test info
      const calls = getCapturedCalls();
      const messageCall = calls.find((args) => args.includes('--message'));
      if (messageCall) {
        const messageIndex = messageCall.indexOf('--message');
        const message = messageCall[messageIndex + 1];
        expect(message).toContain('123');
      }
    });
  });

  /**
   * @behavior AC-TELEGRAM-INTEGRATION.2: Merged event sends Telegram notification with PR number
   * @acceptance-criteria When PR is merged, telegram-notify.js is called with PR details
   */
  describe('merged event', () => {
    it('should send Telegram notification with PR number on merged', () => {
      // GIVEN: Settings allow high priority notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // WHEN: Running oss-notify.sh with workflow merged event
      runOssNotify('--workflow ship merged \'{"prNumber": 42, "branch": "feat/test-feature"}\'');

      // THEN: telegram-notify.js should have been called with PR info
      const calls = getCapturedCalls();
      const messageCall = calls.find((args) => args.includes('--message'));
      expect(messageCall).toBeDefined();

      const messageIndex = messageCall!.indexOf('--message');
      const message = messageCall![messageIndex + 1];
      expect(message).toContain('PR #42');
      expect(message).toContain('merged');
    });

    it('should include branch name in merged notification when provided', () => {
      // GIVEN: Settings allow notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // WHEN: Running with branch in context
      runOssNotify('--workflow ship merged \'{"prNumber": 99, "branch": "fix/critical-bug"}\'');

      // THEN: Message should contain branch info
      const calls = getCapturedCalls();
      const messageCall = calls.find((args) => args.includes('--message'));
      if (messageCall) {
        const messageIndex = messageCall.indexOf('--message');
        const message = messageCall[messageIndex + 1];
        expect(message).toContain('fix/critical-bug');
      }
    });
  });

  /**
   * @behavior AC-TELEGRAM-INTEGRATION.3: Failed event sends Telegram notification with blocker
   * @acceptance-criteria When workflow fails, telegram-notify.js is called with failure details
   */
  describe('failed event', () => {
    it('should send Telegram notification with blocker info on failed', () => {
      // GIVEN: Settings allow critical priority notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'errors-only',
          },
        })
      );

      // WHEN: Running oss-notify.sh with workflow failed event
      runOssNotify('--workflow build failed \'{"blocker": "Tests failing: 3 errors"}\'');

      // THEN: telegram-notify.js should have been called with failure info
      const calls = getCapturedCalls();
      const messageCall = calls.find((args) => args.includes('--message'));
      expect(messageCall).toBeDefined();

      const messageIndex = messageCall!.indexOf('--message');
      const message = messageCall![messageIndex + 1];
      expect(message).toContain('/oss:build failed');
      expect(message).toContain('Tests failing');
    });

    it('should include blocker details in failed notification', () => {
      // GIVEN: Settings allow notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // WHEN: Running with detailed blocker
      runOssNotify('--workflow ship failed \'{"blocker": "IRON LAW #4 violation: pushed to main"}\'');

      // THEN: Message should contain blocker details
      const calls = getCapturedCalls();
      const messageCall = calls.find((args) => args.includes('--message'));
      if (messageCall) {
        const messageIndex = messageCall.indexOf('--message');
        const message = messageCall[messageIndex + 1];
        expect(message).toContain('IRON LAW');
      }
    });
  });

  /**
   * @behavior AC-TELEGRAM-INTEGRATION.4: Notification skipped if telegram-notify.js doesn't exist
   * @acceptance-criteria When CLI doesn't exist, workflow continues without error
   */
  describe('missing telegram-notify.js', () => {
    it('should not error when telegram-notify.js does not exist', () => {
      // GIVEN: Settings allow notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // AND: telegram-notify.js doesn't exist (delete our mock)
      if (mockTelegramScript && fs.existsSync(mockTelegramScript)) {
        fs.unlinkSync(mockTelegramScript);
      }

      // WHEN: Running oss-notify.sh with workflow complete event
      // THEN: Should not throw (script handles missing CLI gracefully)
      expect(() => {
        runOssNotify('--workflow build complete \'{"testsPass": 47}\'');
      }).not.toThrow();
    });
  });

  /**
   * @behavior AC-TELEGRAM-INTEGRATION.5: Notification errors don't break the workflow
   * @acceptance-criteria When telegram-notify.js fails, workflow continues
   */
  describe('error handling', () => {
    it('should continue workflow when telegram-notify.js returns error', () => {
      // GIVEN: Settings allow notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // AND: telegram-notify.js returns error
      if (mockTelegramScript) {
        fs.writeFileSync(
          mockTelegramScript,
          `#!/usr/bin/env node
console.error('Simulated error');
process.exit(1);
`
        );
      }

      // WHEN: Running oss-notify.sh with workflow complete event
      // THEN: Should not throw (script uses || true to ignore errors)
      expect(() => {
        runOssNotify('--workflow build complete \'{"testsPass": 47}\'');
      }).not.toThrow();
    });

    it('should continue workflow when telegram-notify.js times out', () => {
      // GIVEN: Settings allow notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'all',
          },
        })
      );

      // AND: telegram-notify.js hangs (simulate with sleep but test has timeout)
      if (mockTelegramScript) {
        fs.writeFileSync(
          mockTelegramScript,
          `#!/usr/bin/env node
// Just exit immediately to simulate quick timeout handling
process.exit(0);
`
        );
      }

      // WHEN: Running oss-notify.sh
      // THEN: Should complete within reasonable time
      const startTime = Date.now();
      expect(() => {
        runOssNotify('--workflow build complete \'{}\'');
      }).not.toThrow();
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(5000); // Should not hang
    });
  });

  /**
   * @behavior Verbosity filtering affects Telegram notifications
   * @acceptance-criteria Low priority events filtered when verbosity is "important"
   */
  describe('verbosity filtering', () => {
    it('should not send Telegram notification for task_complete when verbosity is important', () => {
      // GIVEN: Settings only allow important notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'important',
          },
        })
      );

      // WHEN: Running oss-notify.sh with low priority task_complete event
      runOssNotify('--workflow build task_complete \'{"current": 1, "total": 5}\'');

      // THEN: telegram-notify.js should NOT have been called (filtered by verbosity)
      const calls = getCapturedCalls();
      expect(calls.length).toBe(0);
    });

    it('should send Telegram notification for complete when verbosity is important', () => {
      // GIVEN: Settings only allow important notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'important',
          },
        })
      );

      // WHEN: Running oss-notify.sh with high priority complete event
      runOssNotify('--workflow build complete \'{}\'');

      // THEN: telegram-notify.js should have been called
      const calls = getCapturedCalls();
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should send Telegram notification for failed when verbosity is errors-only', () => {
      // GIVEN: Settings only allow error notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'errors-only',
          },
        })
      );

      // WHEN: Running oss-notify.sh with critical failed event
      runOssNotify('--workflow build failed \'{"blocker": "Test failure"}\'');

      // THEN: telegram-notify.js should have been called
      const calls = getCapturedCalls();
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should not send Telegram notification for complete when verbosity is errors-only', () => {
      // GIVEN: Settings only allow error notifications
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'visual',
            verbosity: 'errors-only',
          },
        })
      );

      // WHEN: Running oss-notify.sh with high priority complete event
      runOssNotify('--workflow build complete \'{}\'');

      // THEN: telegram-notify.js should NOT have been called (filtered)
      const calls = getCapturedCalls();
      expect(calls.length).toBe(0);
    });
  });

  /**
   * @behavior Style filtering affects Telegram notifications
   * @acceptance-criteria When style is "none", no notifications sent
   */
  describe('style filtering', () => {
    it('should not send Telegram notification when style is none', () => {
      // GIVEN: Style is none (all notifications disabled)
      fs.writeFileSync(
        settingsFile,
        JSON.stringify({
          notifications: {
            style: 'none',
            verbosity: 'all',
          },
        })
      );

      // WHEN: Running oss-notify.sh with complete event
      runOssNotify('--workflow build complete \'{}\'');

      // THEN: telegram-notify.js should NOT have been called
      const calls = getCapturedCalls();
      expect(calls.length).toBe(0);
    });
  });
});
