/**
 * @behavior Event tracking captures workflow telemetry for analytics
 * @acceptance-criteria All workflow events are tracked with timestamps and context
 * @business-rule Event data drives product improvements and user insights
 * @boundary Service (EventTrackingService)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Event Tracking Service', () => {
  let testDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-tracking-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = testDir;
    fs.mkdirSync(path.join(testDir, '.oss'), { recursive: true });
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('trackEvent', () => {
    /**
     * @behavior Events are recorded with timestamp and context
     * @acceptance-criteria Each event has: name, timestamp, context
     */
    it('should record event with timestamp and context', async () => {
      const { EventTrackingService } = await import('../../src/services/event-tracking');

      const tracker = new EventTrackingService();

      tracker.trackEvent('command_started', { command: 'build', version: '1.0.0' });

      const events = tracker.getRecentEvents(1);
      expect(events.length).toBe(1);
      expect(events[0].name).toBe('command_started');
      expect(events[0].context.command).toBe('build');
      expect(events[0].timestamp).toBeDefined();
    });

    /**
     * @behavior Multiple events are tracked in order
     * @acceptance-criteria Events maintain chronological order
     */
    it('should track multiple events in order', async () => {
      const { EventTrackingService } = await import('../../src/services/event-tracking');

      const tracker = new EventTrackingService();

      tracker.trackEvent('session_start', {});
      tracker.trackEvent('command_started', { command: 'plan' });
      tracker.trackEvent('command_completed', { command: 'plan' });

      const events = tracker.getRecentEvents(10);
      expect(events.length).toBe(3);
      expect(events[0].name).toBe('session_start');
      expect(events[2].name).toBe('command_completed');
    });
  });

  describe('event types', () => {
    /**
     * @behavior Workflow events are categorized by type
     * @acceptance-criteria Common event types are predefined
     */
    it('should support standard event types', async () => {
      const { EventTrackingService, EventType } = await import('../../src/services/event-tracking');

      expect(EventType.SESSION_START).toBe('session_start');
      expect(EventType.COMMAND_STARTED).toBe('command_started');
      expect(EventType.COMMAND_COMPLETED).toBe('command_completed');
      expect(EventType.COMMAND_FAILED).toBe('command_failed');
      expect(EventType.TEST_RUN).toBe('test_run');
      expect(EventType.BUILD_RUN).toBe('build_run');
      expect(EventType.PR_CREATED).toBe('pr_created');
    });
  });

  describe('aggregation', () => {
    /**
     * @behavior Events can be aggregated by type
     * @acceptance-criteria Can count events by type for analytics
     */
    it('should count events by type', async () => {
      const { EventTrackingService } = await import('../../src/services/event-tracking');

      const tracker = new EventTrackingService();

      tracker.trackEvent('command_started', { command: 'build' });
      tracker.trackEvent('command_started', { command: 'ship' });
      tracker.trackEvent('command_completed', { command: 'build' });

      const counts = tracker.getEventCounts();
      expect(counts['command_started']).toBe(2);
      expect(counts['command_completed']).toBe(1);
    });

    /**
     * @behavior Duration can be calculated between events
     * @acceptance-criteria Can measure time between start and complete
     */
    it('should calculate duration between paired events', async () => {
      const { EventTrackingService } = await import('../../src/services/event-tracking');

      const tracker = new EventTrackingService();
      const sessionId = 'session-123';

      tracker.trackEvent('command_started', { command: 'build', sessionId });
      // Simulate some time passing
      tracker.trackEvent('command_completed', { command: 'build', sessionId });

      const duration = tracker.getDuration('command_started', 'command_completed', sessionId);
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('persistence', () => {
    /**
     * @behavior Events are persisted to disk
     * @acceptance-criteria Events survive process restarts
     */
    it('should persist events to disk', async () => {
      const { EventTrackingService } = await import('../../src/services/event-tracking');

      const tracker1 = new EventTrackingService();
      tracker1.trackEvent('test_event', { data: 'test' });
      tracker1.flush();

      // Create new instance
      const tracker2 = new EventTrackingService();
      tracker2.load();

      const events = tracker2.getRecentEvents(10);
      expect(events.some(e => e.name === 'test_event')).toBe(true);
    });

    /**
     * @behavior Event log has size limit
     * @acceptance-criteria Old events are pruned when limit reached
     */
    it('should prune old events when limit reached', async () => {
      const { EventTrackingService } = await import('../../src/services/event-tracking');

      const tracker = new EventTrackingService({ maxEvents: 5 });

      // Add more than max events
      for (let i = 0; i < 10; i++) {
        tracker.trackEvent(`event_${i}`, {});
      }

      const events = tracker.getRecentEvents(100);
      expect(events.length).toBeLessThanOrEqual(5);
    });
  });

  describe('session tracking', () => {
    /**
     * @behavior Session ID links related events
     * @acceptance-criteria Events in same session share session ID
     */
    it('should track session ID across events', async () => {
      const { EventTrackingService } = await import('../../src/services/event-tracking');

      const tracker = new EventTrackingService();
      tracker.startSession();

      tracker.trackEvent('command_started', { command: 'build' });
      tracker.trackEvent('command_completed', { command: 'build' });

      const events = tracker.getRecentEvents(10);
      const sessionId = events[0].sessionId;
      expect(sessionId).toBeDefined();
      expect(events[1].sessionId).toBe(sessionId);
    });
  });
});
