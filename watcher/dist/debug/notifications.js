/**
 * Debug workflow notifications
 */
/**
 * Create notification params for debug workflow events
 * Compatible with oss-notify.sh
 */
export function createDebugNotification(event, data) {
    return {
        workflow: 'debug',
        event,
        context: data,
    };
}
//# sourceMappingURL=notifications.js.map