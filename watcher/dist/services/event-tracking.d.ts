/**
 * Event Tracking Service
 *
 * Captures workflow telemetry for analytics and product insights.
 * All events are timestamped and can include context data.
 */
/**
 * Standard event types for workflow tracking
 */
export declare const EventType: {
    readonly SESSION_START: "session_start";
    readonly SESSION_END: "session_end";
    readonly COMMAND_STARTED: "command_started";
    readonly COMMAND_COMPLETED: "command_completed";
    readonly COMMAND_FAILED: "command_failed";
    readonly TEST_RUN: "test_run";
    readonly BUILD_RUN: "build_run";
    readonly PR_CREATED: "pr_created";
    readonly PR_MERGED: "pr_merged";
    readonly TDD_PHASE_CHANGE: "tdd_phase_change";
    readonly AGENT_DELEGATED: "agent_delegated";
    readonly ERROR_OCCURRED: "error_occurred";
};
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
export declare class EventTrackingService {
    private events;
    private currentSessionId?;
    private eventsFile;
    private maxEvents;
    constructor(options?: EventTrackingOptions);
    /**
     * Start a new session (generates session ID)
     */
    startSession(): string;
    /**
     * End the current session
     */
    endSession(): void;
    /**
     * Track an event with context
     */
    trackEvent(name: string, context: Record<string, unknown>): void;
    /**
     * Get most recent events
     */
    getRecentEvents(count: number): TrackedEvent[];
    /**
     * Get event counts by type
     */
    getEventCounts(): Record<string, number>;
    /**
     * Calculate duration between two event types for a session
     * Returns duration in milliseconds
     */
    getDuration(startEvent: string, endEvent: string, sessionId: string): number;
    /**
     * Get events for a specific session
     */
    getSessionEvents(sessionId: string): TrackedEvent[];
    /**
     * Flush events to disk
     */
    flush(): void;
    /**
     * Load events from disk
     */
    load(): void;
    /**
     * Clear all events
     */
    clear(): void;
    /**
     * Get total event count
     */
    getEventCount(): number;
    /**
     * Get events within a time range
     */
    getEventsInRange(startTime: Date, endTime: Date): TrackedEvent[];
    /**
     * Get the current session ID
     */
    getCurrentSessionId(): string | undefined;
}
export {};
//# sourceMappingURL=event-tracking.d.ts.map