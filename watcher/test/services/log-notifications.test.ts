/**
 * Log-Based Notifications Tests
 *
 * @behavior Notifications can be triggered by log patterns
 * @acceptance-criteria AC-LOG-NOTIFY-001: Trigger notification on FAILED events
 * @acceptance-criteria AC-LOG-NOTIFY-002: Trigger notification on abandoned agents
 * @acceptance-criteria AC-LOG-NOTIFY-003: Batch multiple errors into single notification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader, ParsedLogEntry } from '../../src/logger/log-reader.js';

/**
 * Notification to be sent based on log patterns
 */
interface LogNotification {
  title: string;
  message: string;
  priority: 'high' | 'normal' | 'low';
  sound?: string;
  entries: ParsedLogEntry[];
}

/**
 * Check if entry should trigger a notification
 */
function shouldNotify(entry: ParsedLogEntry): boolean {
  // FAILED events always notify
  if (entry.event === 'FAILED') {
    return true;
  }

  // Abandoned agents notify
  if (entry.event === 'AGENT_COMPLETE' && entry.data.status === 'abandoned') {
    return true;
  }

  // Agent failures notify
  if (entry.event === 'AGENT_COMPLETE' && entry.data.status === 'failed') {
    return true;
  }

  return false;
}

/**
 * Create notification from log entry
 */
function createNotification(entry: ParsedLogEntry): LogNotification {
  const isFailure = entry.event === 'FAILED' || entry.data.status === 'failed';
  const isAbandoned = entry.data.status === 'abandoned';

  let title = `${entry.cmd.toUpperCase()}`;
  if (entry.phase) {
    title += `:${entry.phase}`;
  }
  title += ` ${entry.event}`;

  let message = '';
  if (entry.data.error) {
    message = entry.data.error;
  } else if (entry.data.summary) {
    message = entry.data.summary;
  } else if (isAbandoned) {
    message = `Agent ${entry.data.agent_id || 'unknown'} was abandoned`;
  }

  return {
    title,
    message,
    priority: isFailure || isAbandoned ? 'high' : 'normal',
    sound: isFailure ? 'Basso' : undefined,
    entries: [entry],
  };
}

/**
 * Batch multiple notifications within a time window
 */
function batchNotifications(notifications: LogNotification[], windowMs: number = 5000): LogNotification[] {
  if (notifications.length <= 1) {
    return notifications;
  }

  // Group by priority
  const highPriority = notifications.filter((n) => n.priority === 'high');
  const normalPriority = notifications.filter((n) => n.priority !== 'high');

  const batched: LogNotification[] = [];

  // Batch high priority notifications
  if (highPriority.length > 1) {
    batched.push({
      title: `${highPriority.length} Failures Detected`,
      message: highPriority.map((n) => n.title).join(', '),
      priority: 'high',
      sound: 'Basso',
      entries: highPriority.flatMap((n) => n.entries),
    });
  } else if (highPriority.length === 1) {
    batched.push(highPriority[0]);
  }

  // Batch normal priority if many
  if (normalPriority.length > 2) {
    batched.push({
      title: `${normalPriority.length} Events`,
      message: normalPriority.map((n) => n.title).join(', '),
      priority: 'normal',
      entries: normalPriority.flatMap((n) => n.entries),
    });
  } else {
    batched.push(...normalPriority);
  }

  return batched;
}

describe('Log-Based Notifications', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-notify-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Notification triggers', () => {
    it('should trigger notification on FAILED events', async () => {
      // GIVEN: A FAILED log entry
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'FAILED',
        data: { error: 'Tests failed: 3 assertions' },
      };

      // WHEN: Checking if should notify
      const shouldTrigger = shouldNotify(entry);

      // THEN: Should trigger notification
      expect(shouldTrigger).toBe(true);
    });

    it('should trigger notification on abandoned agents', async () => {
      // GIVEN: An abandoned agent entry
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'te-001',
          agent_type: 'test-engineer',
          status: 'abandoned',
        },
      };

      // WHEN: Checking if should notify
      const shouldTrigger = shouldNotify(entry);

      // THEN: Should trigger notification
      expect(shouldTrigger).toBe(true);
    });

    it('should trigger notification on agent failures', async () => {
      // GIVEN: A failed agent entry
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'cr-001',
          agent_type: 'code-reviewer',
          status: 'failed',
          error: 'Timeout after 60s',
        },
      };

      // WHEN: Checking if should notify
      const shouldTrigger = shouldNotify(entry);

      // THEN: Should trigger notification
      expect(shouldTrigger).toBe(true);
    });

    it('should NOT trigger notification on successful completions', async () => {
      // GIVEN: A successful completion
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'COMPLETE',
        data: { summary: 'All tests passed' },
      };

      // WHEN: Checking if should notify
      const shouldTrigger = shouldNotify(entry);

      // THEN: Should NOT trigger notification
      expect(shouldTrigger).toBe(false);
    });

    it('should NOT trigger notification on START events', async () => {
      // GIVEN: A START event
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'plan',
        event: 'START',
        data: {},
      };

      // WHEN: Checking if should notify
      const shouldTrigger = shouldNotify(entry);

      // THEN: Should NOT trigger notification
      expect(shouldTrigger).toBe(false);
    });
  });

  describe('Notification creation', () => {
    it('should create high-priority notification for failures', async () => {
      // GIVEN: A FAILED entry
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        phase: 'RED',
        event: 'FAILED',
        data: { error: 'Type error in auth.ts' },
      };

      // WHEN: Creating notification
      const notification = createNotification(entry);

      // THEN: High priority with error message
      expect(notification.priority).toBe('high');
      expect(notification.title).toBe('BUILD:RED FAILED');
      expect(notification.message).toBe('Type error in auth.ts');
      expect(notification.sound).toBe('Basso');
    });

    it('should create notification for abandoned agent', async () => {
      // GIVEN: An abandoned agent
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'build',
        event: 'AGENT_COMPLETE',
        data: {
          agent_id: 'pe-001',
          status: 'abandoned',
        },
      };

      // WHEN: Creating notification
      const notification = createNotification(entry);

      // THEN: High priority with agent info
      expect(notification.priority).toBe('high');
      expect(notification.message).toContain('pe-001');
      expect(notification.message).toContain('abandoned');
    });

    it('should include summary in notification message', async () => {
      // GIVEN: Entry with summary
      const entry: ParsedLogEntry = {
        ts: new Date().toISOString(),
        cmd: 'ship',
        event: 'FAILED',
        data: { summary: 'PR checks failed: linting errors' },
      };

      // WHEN: Creating notification
      const notification = createNotification(entry);

      // THEN: Summary in message
      expect(notification.message).toBe('PR checks failed: linting errors');
    });
  });

  describe('Notification batching', () => {
    it('should batch multiple failures into single notification', async () => {
      // GIVEN: Multiple failure notifications
      const notifications: LogNotification[] = [
        {
          title: 'BUILD FAILED',
          message: 'Test 1 failed',
          priority: 'high',
          entries: [{ ts: '', cmd: 'build', event: 'FAILED', data: {} }],
        },
        {
          title: 'BUILD FAILED',
          message: 'Test 2 failed',
          priority: 'high',
          entries: [{ ts: '', cmd: 'build', event: 'FAILED', data: {} }],
        },
        {
          title: 'BUILD FAILED',
          message: 'Test 3 failed',
          priority: 'high',
          entries: [{ ts: '', cmd: 'build', event: 'FAILED', data: {} }],
        },
      ];

      // WHEN: Batching notifications
      const batched = batchNotifications(notifications);

      // THEN: Single batched notification
      expect(batched.length).toBe(1);
      expect(batched[0].title).toBe('3 Failures Detected');
      expect(batched[0].priority).toBe('high');
      expect(batched[0].entries.length).toBe(3);
    });

    it('should keep single notification unbatched', async () => {
      // GIVEN: Single notification
      const notifications: LogNotification[] = [
        {
          title: 'BUILD FAILED',
          message: 'Test failed',
          priority: 'high',
          entries: [{ ts: '', cmd: 'build', event: 'FAILED', data: {} }],
        },
      ];

      // WHEN: Batching notifications
      const batched = batchNotifications(notifications);

      // THEN: Same notification returned
      expect(batched.length).toBe(1);
      expect(batched[0].title).toBe('BUILD FAILED');
    });

    it('should separate high and normal priority in batches', async () => {
      // GIVEN: Mixed priority notifications
      const notifications: LogNotification[] = [
        {
          title: 'BUILD FAILED',
          message: 'Critical error',
          priority: 'high',
          entries: [{ ts: '', cmd: 'build', event: 'FAILED', data: {} }],
        },
        {
          title: 'INFO',
          message: 'Some info',
          priority: 'normal',
          entries: [{ ts: '', cmd: 'build', event: 'MILESTONE', data: {} }],
        },
        {
          title: 'INFO 2',
          message: 'More info',
          priority: 'normal',
          entries: [{ ts: '', cmd: 'build', event: 'MILESTONE', data: {} }],
        },
      ];

      // WHEN: Batching notifications
      const batched = batchNotifications(notifications);

      // THEN: High priority separate from normal
      const highPriority = batched.filter((n) => n.priority === 'high');
      expect(highPriority.length).toBe(1);
      expect(highPriority[0].title).toBe('BUILD FAILED');
    });
  });

  describe('Integration with log reader', () => {
    it('should find notifiable entries from log file', async () => {
      // GIVEN: Log file with mixed entries
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: {} });
      await logger.log({ cmd: 'plan', event: 'START', data: {} });
      await logger.log({ cmd: 'plan', event: 'FAILED', data: { error: 'Invalid format' } });

      // WHEN: Reading and filtering for notifications
      const entries = await reader.readAll();
      const notifiable = entries.filter(shouldNotify);

      // THEN: Only FAILED entry is notifiable
      expect(notifiable.length).toBe(1);
      expect(notifiable[0].event).toBe('FAILED');
    });

    it('should detect multiple failures in sequence', async () => {
      // GIVEN: Multiple failures
      await logger.log({ cmd: 'build', event: 'FAILED', data: { error: 'Error 1' } });
      await logger.log({ cmd: 'build', event: 'START', data: {} }); // Retry
      await logger.log({ cmd: 'build', event: 'FAILED', data: { error: 'Error 2' } });

      // WHEN: Reading and filtering
      const entries = await reader.readAll();
      const notifiable = entries.filter(shouldNotify);

      // THEN: Both failures detected
      expect(notifiable.length).toBe(2);
    });
  });
});
