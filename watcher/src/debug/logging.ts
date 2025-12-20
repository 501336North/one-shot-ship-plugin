/**
 * Debug workflow structured logging
 */

export type DebugEvent = 'START' | 'MILESTONE' | 'COMPLETE' | 'FAILED';
export type DebugPhase = 'investigate' | 'confirm' | 'reproduce' | 'plan';

/**
 * Format debug log entry as JSON line
 * Follows workflow.log format: [timestamp] [command] [event] data
 */
export function formatDebugLogEntry(
  event: DebugEvent,
  data: Record<string, unknown>
): string {
  const entry = {
    timestamp: new Date().toISOString(),
    command: 'debug',
    event,
    data,
  };

  return JSON.stringify(entry);
}
