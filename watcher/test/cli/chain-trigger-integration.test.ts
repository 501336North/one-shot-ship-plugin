/**
 * Chain Trigger Integration Tests
 *
 * @behavior oss-notify.sh complete event runs chain-trigger.js synchronously
 * @acceptance-criteria AC-CHAIN-TRIGGER-INT.1 through AC-CHAIN-TRIGGER-INT.6
 * @business-rule Chain trigger stdout must be visible to Claude in Bash tool result
 * @boundary Shell Hook → Node CLI
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Chain Trigger Integration', () => {
  test('oss-notify.sh should contain chain trigger invocation in complete handler', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-notify.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    expect(content).toContain('chain-trigger.js');
    expect(content).toContain('CHAIN_TRIGGER_CLI');
    expect(content).toContain('--workflow');
  });

  /**
   * @behavior Chain trigger must run synchronously so Claude sees the output
   * @acceptance-criteria AC-CHAIN-TRIGGER-INT.2
   * @business-rule Backgrounded process output is invisible to Claude
   */
  test('oss-notify.sh chain trigger should NOT be backgrounded', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-notify.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    const lines = content.split('\n');
    const triggerLine = lines.find(l =>
      l.includes('CHAIN_TRIGGER_CLI') && l.includes('--workflow')
    );
    expect(triggerLine).toBeDefined();

    // Must NOT end with & (background operator)
    expect(triggerLine).not.toMatch(/&\s*$/);
    // Must NOT be wrapped in a subshell with &
    expect(triggerLine).not.toMatch(/\(\s.*\)\s*&/);
  });

  /**
   * @behavior Chain trigger stdout must be visible (not redirected to file or /dev/null)
   * @acceptance-criteria AC-CHAIN-TRIGGER-INT.3
   * @business-rule Claude reads CHAIN: lines from Bash tool result
   */
  test('oss-notify.sh chain trigger stdout should NOT be suppressed', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-notify.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    const lines = content.split('\n');
    const triggerLine = lines.find(l =>
      l.includes('CHAIN_TRIGGER_CLI') && l.includes('--workflow')
    );
    expect(triggerLine).toBeDefined();

    // Stdout must NOT be redirected to a file or /dev/null
    // It's OK for stderr (2>>) to go to a log file
    // Check there's no bare >> or > (stdout redirect) — only 2>> is allowed
    expect(triggerLine).not.toMatch(/[^2]>>\s*"\$CHAIN_TRIGGER_LOG"/);  // no stdout >> to log
    expect(triggerLine).not.toContain('>/dev/null');
    expect(triggerLine).not.toContain('1>');  // no explicit stdout redirect
  });

  /**
   * @behavior Chain trigger stderr should still go to log file for debugging
   * @acceptance-criteria AC-CHAIN-TRIGGER-INT.4
   * @business-rule Errors are logged, not shown to Claude
   */
  test('oss-notify.sh chain trigger stderr should go to log file', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-notify.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    const lines = content.split('\n');
    const triggerLine = lines.find(l =>
      l.includes('CHAIN_TRIGGER_CLI') && l.includes('--workflow')
    );
    expect(triggerLine).toBeDefined();

    // Stderr should be redirected to log file
    expect(triggerLine).toContain('2>>');
    expect(content).toContain('CHAIN_TRIGGER_LOG');
    // Should still have error suppression for the hook
    expect(triggerLine).toContain('|| true');
    // Should reference a log directory
    expect(content).toContain('CHAIN_TRIGGER_LOG');
  });

  // ==========================================================================
  // AC-CHAIN-TRIGGER-INT.5-6: Stale watcher spawn removed from session-start
  // ==========================================================================

  test('oss-session-start.sh should NOT spawn watcher as a background daemon', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-session-start.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    const lines = content.split('\n');
    const activeSpawnLines = lines.filter(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('#')) return false;
      return trimmed.includes('WATCHER_SCRIPT') && trimmed.includes('node') && trimmed.includes('&');
    });

    expect(activeSpawnLines).toHaveLength(0);
  });

  test('oss-session-start.sh should NOT create watcher PID files', () => {
    const hookPath = path.resolve(__dirname, '../../../hooks/oss-session-start.sh');
    const content = fs.readFileSync(hookPath, 'utf8');

    const lines = content.split('\n');
    const activePidWriteLines = lines.filter(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('#')) return false;
      return trimmed.includes('WATCHER_PID_FILE') && trimmed.includes('echo');
    });

    expect(activePidWriteLines).toHaveLength(0);
  });
});
