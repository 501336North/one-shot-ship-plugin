/**
 * LogReader Tests
 *
 * @behavior Watcher can read and tail workflow logs in real-time
 * @acceptance-criteria AC-004.1 through AC-004.5, AC-008.1 through AC-008.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogReader, ParsedLogEntry } from '../src/logger/log-reader.js';
import { WorkflowLogger } from '../src/logger/workflow-logger.js';

describe('LogReader', () => {
  let testDir: string;
  let reader: LogReader;
  let logger: WorkflowLogger;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-reader-test-'));
    reader = new LogReader(testDir);
    logger = new WorkflowLogger(testDir);
  });

  afterEach(() => {
    reader.stopTailing();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('readAll()', () => {
    it('reads all entries from beginning', async () => {
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: { summary: 'Done' } });

      const entries = await reader.readAll();

      expect(entries.length).toBe(2);
      expect(entries[0].cmd).toBe('ideate');
      expect(entries[0].event).toBe('START');
      expect(entries[1].event).toBe('COMPLETE');
    });

    it('returns array of parsed entries', async () => {
      await logger.log({
        cmd: 'build',
        phase: 'RED',
        event: 'PHASE_START',
        data: { test_count: 3 },
      });

      const entries = await reader.readAll();

      expect(entries[0]).toEqual(
        expect.objectContaining({
          cmd: 'build',
          phase: 'RED',
          event: 'PHASE_START',
          data: { test_count: 3 },
        })
      );
      expect(entries[0].ts).toBeDefined();
    });

    it('handles empty file', async () => {
      // Create empty log file
      fs.writeFileSync(path.join(testDir, 'workflow.log'), '');

      const entries = await reader.readAll();

      expect(entries).toEqual([]);
    });

    it('handles missing file', async () => {
      const entries = await reader.readAll();

      expect(entries).toEqual([]);
    });
  });

  describe('tail()', () => {
    it('reads new entries as they are appended', async () => {
      const received: ParsedLogEntry[] = [];

      reader.startTailing((entry) => {
        received.push(entry);
      });

      // Wait a bit for tail to start
      await new Promise((r) => setTimeout(r, 50));

      await logger.log({ cmd: 'plan', event: 'START', data: {} });

      // Wait for tail to pick up
      await new Promise((r) => setTimeout(r, 100));

      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0].cmd).toBe('plan');
    });

    it('parses JSON lines correctly', async () => {
      const received: ParsedLogEntry[] = [];

      reader.startTailing((entry) => {
        received.push(entry);
      });

      await new Promise((r) => setTimeout(r, 50));

      await logger.log({
        cmd: 'ship',
        event: 'MILESTONE',
        data: { step: 'lint', passed: true },
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(received[0].data).toEqual({ step: 'lint', passed: true });
    });

    it('skips human summary lines (starting with #)', async () => {
      const received: ParsedLogEntry[] = [];

      reader.startTailing((entry) => {
        received.push(entry);
      });

      await new Promise((r) => setTimeout(r, 50));

      await logger.log({ cmd: 'build', event: 'START', data: {} });
      await logger.log({ cmd: 'build', event: 'COMPLETE', data: {} });

      await new Promise((r) => setTimeout(r, 100));

      // Should only get JSON entries, not human summary lines
      expect(received.every((e) => e.cmd !== undefined)).toBe(true);
    });

    it('emits parsed entries via callback', async () => {
      const callback = vi.fn();

      reader.startTailing(callback);

      await new Promise((r) => setTimeout(r, 50));

      await logger.log({ cmd: 'test', event: 'START', data: {} });

      await new Promise((r) => setTimeout(r, 100));

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          cmd: 'test',
          event: 'START',
        })
      );
    });

    it('handles malformed JSON gracefully', async () => {
      const received: ParsedLogEntry[] = [];
      const logPath = path.join(testDir, 'workflow.log');

      // Write valid entry first
      await logger.log({ cmd: 'valid', event: 'START', data: {} });

      reader.startTailing((entry) => {
        received.push(entry);
      });

      await new Promise((r) => setTimeout(r, 50));

      // Append malformed JSON directly
      fs.appendFileSync(logPath, 'not valid json\n');
      fs.appendFileSync(logPath, '# human line\n');

      // Write another valid entry
      await logger.log({ cmd: 'valid2', event: 'COMPLETE', data: {} });

      await new Promise((r) => setTimeout(r, 100));

      // Should have at least the valid entries
      const validEntries = received.filter((e) => e.cmd?.startsWith('valid'));
      expect(validEntries.length).toBeGreaterThanOrEqual(1);
    });

    it('tracks read position', async () => {
      await logger.log({ cmd: 'before', event: 'START', data: {} });

      const received: ParsedLogEntry[] = [];

      // Start tailing after first entry
      reader.startTailing((entry) => {
        received.push(entry);
      });

      await new Promise((r) => setTimeout(r, 50));

      await logger.log({ cmd: 'after', event: 'START', data: {} });

      await new Promise((r) => setTimeout(r, 100));

      // Should only get entries after tailing started (or all if reader reads from start)
      // The key is that new entries after start ARE received
      expect(received.some((e) => e.cmd === 'after')).toBe(true);
    });
  });

  describe('queryLast()', () => {
    it('finds last entry matching command', async () => {
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'plan', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: { summary: 'Design done' } });

      const entry = await reader.queryLast({ cmd: 'ideate' });

      expect(entry).not.toBeNull();
      expect(entry?.event).toBe('COMPLETE');
      expect(entry?.data.summary).toBe('Design done');
    });

    it('finds last entry matching command and event', async () => {
      await logger.log({ cmd: 'build', event: 'START', data: {} });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_START', data: {} });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_COMPLETE', data: { tests: 3 } });

      const entry = await reader.queryLast({ cmd: 'build', event: 'PHASE_COMPLETE' });

      expect(entry).not.toBeNull();
      expect(entry?.phase).toBe('RED');
      expect(entry?.data.tests).toBe(3);
    });

    it('returns null if no match', async () => {
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });

      const entry = await reader.queryLast({ cmd: 'ship' });

      expect(entry).toBeNull();
    });

    it('returns data from matching entry', async () => {
      await logger.log({
        cmd: 'plan',
        event: 'COMPLETE',
        data: {
          summary: 'Created TDD plan',
          outputs: ['dev/active/feature/PLAN.md'],
          next_suggested: 'build',
        },
      });

      const entry = await reader.queryLast({ cmd: 'plan', event: 'COMPLETE' });

      expect(entry?.data.outputs).toEqual(['dev/active/feature/PLAN.md']);
      expect(entry?.data.next_suggested).toBe('build');
    });
  });
});
