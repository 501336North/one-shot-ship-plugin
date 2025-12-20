/**
 * Debug workflow structured logging
 */
/**
 * Format debug log entry as JSON line
 * Follows workflow.log format: [timestamp] [command] [event] data
 */
export function formatDebugLogEntry(event, data) {
    const entry = {
        timestamp: new Date().toISOString(),
        command: 'debug',
        event,
        data,
    };
    return JSON.stringify(entry);
}
//# sourceMappingURL=logging.js.map