/**
 * Debug workflow notifications
 */
export type DebugNotificationEvent = 'start' | 'investigate_complete' | 'reproduce_complete' | 'complete' | 'failed';
export interface DebugNotificationParams {
    workflow: 'debug';
    event: DebugNotificationEvent;
    context: Record<string, unknown>;
}
/**
 * Create notification params for debug workflow events
 * Compatible with oss-notify.sh
 */
export declare function createDebugNotification(event: DebugNotificationEvent, data: Record<string, unknown>): DebugNotificationParams;
//# sourceMappingURL=notifications.d.ts.map