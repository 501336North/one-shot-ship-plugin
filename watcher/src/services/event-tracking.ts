/**
 * Event Tracking Service
 *
 * Captures workflow telemetry for analytics and product insights.
 * All events are timestamped and can include context data.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Standard event types for workflow tracking
 */
export const EventType = {
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  COMMAND_STARTED: 'command_started',
  COMMAND_COMPLETED: 'command_completed',
  COMMAND_FAILED: 'command_failed',
  TEST_RUN: 'test_run',
  BUILD_RUN: 'build_run',
  PR_CREATED: 'pr_created',
  PR_MERGED: 'pr_merged',
  TDD_PHASE_CHANGE: 'tdd_phase_change',
  AGENT_DELEGATED: 'agent_delegated',
  ERROR_OCCURRED: 'error_occurred',
} as const;

export type EventTypeName = (typeof EventType)[keyof typeof EventType];

export interface TrackedEvent {
  name: string;
  timestamp: string;
  context: Record<string, unknown>;
  sessionId?: string;
}

interface EventTrackingOptions {
  maxEvents?: number;
}

const DEFAULT_MAX_EVENTS = 1000;

export class EventTrackingService {
  private events: TrackedEvent[] = [];
  private currentSessionId?: string;
  private eventsFile: string;
  private maxEvents: number;

  constructor(options: EventTrackingOptions = {}) {
    const ossDir = path.join(os.homedir(), '.oss');
    this.eventsFile = path.join(ossDir, 'events.json');
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  }

  /**
   * Start a new session (generates session ID)
   */
  startSession(): string {
    this.currentSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.trackEvent(EventType.SESSION_START, {});
    return this.currentSessionId;
  }

  /**
   * End the current session
   */
  endSession(): void {
    if (this.currentSessionId) {
      this.trackEvent(EventType.SESSION_END, {});
      this.currentSessionId = undefined;
    }
  }

  /**
   * Track an event with context
   */
  trackEvent(name: string, context: Record<string, unknown>): void {
    const event: TrackedEvent = {
      name,
      timestamp: new Date().toISOString(),
      context,
      sessionId: this.currentSessionId,
    };

    this.events.push(event);

    // Prune if over limit
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * Get most recent events
   */
  getRecentEvents(count: number): TrackedEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get event counts by type
   */
  getEventCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.events) {
      counts[event.name] = (counts[event.name] || 0) + 1;
    }
    return counts;
  }

  /**
   * Calculate duration between two event types for a session
   * Returns duration in milliseconds
   */
  getDuration(startEvent: string, endEvent: string, sessionId: string): number {
    const sessionEvents = this.events.filter(e => e.sessionId === sessionId);

    const start = sessionEvents.find(e => e.name === startEvent);
    const end = sessionEvents.find(e => e.name === endEvent);

    if (!start || !end) {
      return 0;
    }

    const startTime = new Date(start.timestamp).getTime();
    const endTime = new Date(end.timestamp).getTime();

    return Math.max(0, endTime - startTime);
  }

  /**
   * Get events for a specific session
   */
  getSessionEvents(sessionId: string): TrackedEvent[] {
    return this.events.filter(e => e.sessionId === sessionId);
  }

  /**
   * Flush events to disk
   */
  flush(): void {
    const ossDir = path.dirname(this.eventsFile);
    if (!fs.existsSync(ossDir)) {
      fs.mkdirSync(ossDir, { recursive: true });
    }

    fs.writeFileSync(this.eventsFile, JSON.stringify(this.events, null, 2));
  }

  /**
   * Load events from disk
   */
  load(): void {
    try {
      if (fs.existsSync(this.eventsFile)) {
        const content = fs.readFileSync(this.eventsFile, 'utf-8');
        this.events = JSON.parse(content);
      }
    } catch {
      // If file is corrupt, start fresh
      this.events = [];
    }
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
    if (fs.existsSync(this.eventsFile)) {
      fs.unlinkSync(this.eventsFile);
    }
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get events within a time range
   */
  getEventsInRange(startTime: Date, endTime: Date): TrackedEvent[] {
    return this.events.filter(e => {
      const eventTime = new Date(e.timestamp);
      return eventTime >= startTime && eventTime <= endTime;
    });
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }
}
