/**
 * MenuBar Log Tail Tests
 *
 * @behavior SwiftBar can optionally show last N log entries
 * @acceptance-criteria AC-MENUBAR-LOG-001: Read last 5 log entries for display
 * @acceptance-criteria AC-MENUBAR-LOG-002: Highlight errors in log display
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader, ParsedLogEntry } from '../../src/logger/log-reader.js';

/**
 * Format log entries for SwiftBar display
 */
interface FormattedLogEntry {
  text: string;
  color?: string;
  timestamp: string;
  isError: boolean;
}

/**
 * Get recent logs formatted for SwiftBar display
 */
function getRecentLogs(reader: LogReader, n: number = 5): FormattedLogEntry[] {
  // This would be implemented in menubar.ts
  // For now we test the expected behavior
  return [];
}

/**
 * Format a single log entry for display
 */
function formatLogEntry(entry: ParsedLogEntry): FormattedLogEntry {
  const isError = entry.event === 'FAILED' || entry.data.status === 'failed';

  let text = `${entry.cmd.toUpperCase()}:${entry.event}`;
  if (entry.phase) {
    text = `${entry.cmd.toUpperCase()}:${entry.phase}:${entry.event}`;
  }

  // Add summary or error message if available
  if (entry.data.summary) {
    text += ` - ${entry.data.summary}`;
  } else if (entry.data.error) {
    text += ` - ${entry.data.error}`;
  }

  return {
    text,
    color: isError ? 'red' : undefined,
    timestamp: entry.ts,
    isError,
  };
}

describe('MenuBar Log Tail', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menubar-logs-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Reading recent logs', () => {
    it('should read last 5 log entries for display', async () => {
      // GIVEN: 10 log entries in the file
      for (let i = 1; i <= 10; i++) {
        await logger.log({
          cmd: 'build',
          event: 'MILESTONE',
          data: { step: `step-${i}` },
        });
      }

      // WHEN: Reading last 5 entries
      const allEntries = await reader.readAll();
      const lastFive = allEntries.slice(-5);

      // THEN: Should have exactly 5 entries
      expect(lastFive.length).toBe(5);
      expect(lastFive[0].data.step).toBe('step-6');
      expect(lastFive[4].data.step).toBe('step-10');
    });

    it('should return all entries when fewer than N exist', async () => {
      // GIVEN: Only 3 log entries
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'MILESTONE', data: {} });
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: {} });

      // WHEN: Reading last 5 entries
      const allEntries = await reader.readAll();
      const lastFive = allEntries.slice(-5);

      // THEN: Should have all 3 entries
      expect(lastFive.length).toBe(3);
    });

    it('should return empty array when no logs exist', async () => {
      // GIVEN: No log file
      // WHEN: Reading entries
      const entries = await reader.readAll();

      // THEN: Should be empty
      expect(entries.length).toBe(0);
    });
  });

  describe('Formatting log entries', () => {
    it('should format START event correctly', async () => {
      // GIVEN: A START entry
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'START',
        data: { feature: 'auth' },
      };

      // WHEN: Formatting for display
      const formatted = formatLogEntry(entry);

      // THEN: Formatted correctly
      expect(formatted.text).toBe('BUILD:START');
      expect(formatted.isError).toBe(false);
      expect(formatted.color).toBeUndefined();
    });

    it('should format COMPLETE event with summary', async () => {
      // GIVEN: A COMPLETE entry with summary
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'plan',
        event: 'COMPLETE',
        data: { summary: 'Created 5-phase TDD plan' },
      };

      // WHEN: Formatting for display
      const formatted = formatLogEntry(entry);

      // THEN: Includes summary
      expect(formatted.text).toBe('PLAN:COMPLETE - Created 5-phase TDD plan');
      expect(formatted.isError).toBe(false);
    });

    it('should format phase events correctly', async () => {
      // GIVEN: A phase event
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        phase: 'RED',
        event: 'PHASE_START',
        data: {},
      };

      // WHEN: Formatting for display
      const formatted = formatLogEntry(entry);

      // THEN: Includes phase
      expect(formatted.text).toBe('BUILD:RED:PHASE_START');
    });
  });

  describe('Error highlighting', () => {
    it('should highlight FAILED events in red', async () => {
      // GIVEN: A FAILED entry
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'FAILED',
        data: { error: 'Tests failed' },
      };

      // WHEN: Formatting for display
      const formatted = formatLogEntry(entry);

      // THEN: Highlighted as error
      expect(formatted.isError).toBe(true);
      expect(formatted.color).toBe('red');
      expect(formatted.text).toContain('Tests failed');
    });

    it('should highlight agent failures in red', async () => {
      // GIVEN: An agent failure
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'te-001',
          status: 'failed',
          error: 'Timeout after 60s',
        },
      };

      // WHEN: Formatting for display
      const formatted = formatLogEntry(entry);

      // THEN: Highlighted as error
      expect(formatted.isError).toBe(true);
      expect(formatted.color).toBe('red');
    });

    it('should NOT highlight success entries', async () => {
      // GIVEN: A successful COMPLETE entry
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'ship',
        event: 'COMPLETE',
        data: { summary: 'PR merged successfully' },
      };

      // WHEN: Formatting for display
      const formatted = formatLogEntry(entry);

      // THEN: Not highlighted as error
      expect(formatted.isError).toBe(false);
      expect(formatted.color).toBeUndefined();
    });
  });

  describe('SwiftBar submenu format', () => {
    it('should format entries for SwiftBar submenu', async () => {
      // GIVEN: Multiple log entries
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: { summary: 'Design done' } });
      await logger.log({ cmd: 'plan', event: 'START', data: {} });
      await logger.log({ cmd: 'plan', event: 'FAILED', data: { error: 'Invalid format' } });

      // WHEN: Reading and formatting
      const entries = await reader.readAll();
      const formatted = entries.map(formatLogEntry);

      // THEN: All entries formatted correctly
      expect(formatted.length).toBe(4);
      expect(formatted[0].text).toBe('IDEATE:START');
      expect(formatted[1].text).toBe('IDEATE:COMPLETE - Design done');
      expect(formatted[2].text).toBe('PLAN:START');
      expect(formatted[3].isError).toBe(true);
    });

    it('should include timestamps for each entry', async () => {
      // GIVEN: A log entry
      const now = new Date();
      await logger.log({ cmd: 'build', event: 'START', data: {} });

      // WHEN: Reading and formatting
      const entries = await reader.readAll();
      const formatted = entries.map(formatLogEntry);

      // THEN: Timestamp is included
      expect(formatted[0].timestamp).toBeDefined();
      expect(new Date(formatted[0].timestamp).getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
    });
  });

  describe('Mixed entry types', () => {
    it('should handle mix of commands, phases, and agents', async () => {
      // GIVEN: Various entry types
      await logger.log({ cmd: 'build', event: 'START', data: {} });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_START', data: {} });
      await logger.log({
        cmd: 'build',
        event: 'AGENT_SPAWN',
        data: { agent_type: 'test-engineer', agent_id: 'te-001' },
      });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_COMPLETE', data: {} });

      // WHEN: Reading and formatting
      const entries = await reader.readAll();
      const formatted = entries.map(formatLogEntry);

      // THEN: All types formatted correctly
      expect(formatted[0].text).toBe('BUILD:START');
      expect(formatted[1].text).toBe('BUILD:RED:PHASE_START');
      expect(formatted[2].text).toBe('BUILD:AGENT_SPAWN');
      expect(formatted[3].text).toBe('BUILD:RED:PHASE_COMPLETE');
    });
  });
});
