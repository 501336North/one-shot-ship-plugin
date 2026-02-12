/**
 * Chain Trigger Integration Tests
 *
 * @behavior oss-notify.sh complete event triggers chain-trigger.js for custom commands
 * @acceptance-criteria AC-CHAIN-TRIGGER-INT.1 through AC-CHAIN-TRIGGER-INT.5
 * @business-rule Workflow chain execution fires automatically on command completion
 * @boundary Shell Hook → Node CLI
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Chain Trigger Integration', () => {
  test('oss-notify.sh should contain chain trigger invocation in complete handler', () => {
    // Read the actual oss-notify.sh file
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-notify.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    // Verify it contains the chain trigger CLI path resolution
    expect(content).toContain('chain-trigger.js');

    // Verify it references CHAIN_TRIGGER_CLI with --workflow flag
    expect(content).toContain('CHAIN_TRIGGER_CLI');
    expect(content).toContain('--workflow');
  });

  test('oss-notify.sh chain trigger should run in background (non-blocking)', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-notify.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    // Chain trigger must be backgrounded with & to not block the hook
    // The line should end with ) & indicating background subshell
    expect(content).toContain('CHAIN_TRIGGER_CLI');
    // Find the line with chain trigger invocation and verify it's backgrounded
    const lines = content.split('\n');
    const triggerLine = lines.find(l => l.includes('CHAIN_TRIGGER_CLI') && l.includes('--workflow'));
    expect(triggerLine).toBeDefined();
    expect(triggerLine).toMatch(/&\s*$/);
  });

  test('oss-notify.sh chain trigger should log output to file instead of /dev/null', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-notify.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    // H-3: Chain trigger output should go to a log file for observability,
    // not swallowed by /dev/null. The hook must still not fail (|| true).
    const lines = content.split('\n');
    const triggerLine = lines.find(l => l.includes('CHAIN_TRIGGER_CLI') && l.includes('--workflow'));
    expect(triggerLine).toBeDefined();

    // Should redirect to a log file, NOT /dev/null
    expect(triggerLine).not.toContain('2>/dev/null');
    // Should still have error suppression for the hook
    expect(triggerLine).toContain('|| true');
    // Should reference a log directory
    expect(content).toContain('CHAIN_TRIGGER_LOG');
  });

  // ==========================================================================
  // AC-CHAIN-TRIGGER-INT.4-5: Stale watcher spawn removed from session-start
  // ==========================================================================

  test('oss-session-start.sh should NOT spawn watcher as a background daemon', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-session-start.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    // The watcher index.js is a library (exports Watcher class, no main).
    // Spawning it with `node "$WATCHER_SCRIPT" &` exits immediately, creating stale PIDs.
    // Chain execution is now handled by oss-notify.sh hook, so no daemon needed.
    const lines = content.split('\n');
    const activeSpawnLines = lines.filter(l => {
      const trimmed = l.trim();
      // Skip comments
      if (trimmed.startsWith('#')) return false;
      // Look for the pattern: node "$WATCHER_SCRIPT" &
      return trimmed.includes('WATCHER_SCRIPT') && trimmed.includes('node') && trimmed.includes('&');
    });

    expect(activeSpawnLines).toHaveLength(0);
  });

  test('oss-session-start.sh should NOT create watcher PID files', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-session-start.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    // No active code should write to WATCHER_PID_FILE
    const lines = content.split('\n');
    const activePidWriteLines = lines.filter(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('#')) return false;
      return trimmed.includes('WATCHER_PID_FILE') && trimmed.includes('echo');
    });

    expect(activePidWriteLines).toHaveLength(0);
  });
});
