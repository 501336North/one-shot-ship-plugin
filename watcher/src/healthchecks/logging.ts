import { promises as fs } from 'fs';
import type { CheckResult } from '../types.js';

interface LoggingCheckOptions {
  sessionLogPath: string;
  sessionActive?: boolean;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function checkLogging(
  options: LoggingCheckOptions
): Promise<CheckResult> {
  const { sessionLogPath, sessionActive = false } = options;

  try {
    // Read log file
    const logContent = await fs.readFile(sessionLogPath, 'utf-8');

    // Check file modification time
    const stats = await fs.stat(sessionLogPath);
    const ageMs = Date.now() - stats.mtime.getTime();
    const isStale = ageMs > STALE_THRESHOLD_MS;

    // Parse log entries to find types
    const entryTypes = new Set<string>();
    const workflowCommands = new Set<string>();
    const workflowEvents = new Set<string>();
    const lines = logContent.split('\n');

    // Workflow commands that indicate structured logging
    const WORKFLOW_COMMANDS = [
      'ideate',
      'plan',
      'build',
      'ship',
      'test',
      'red',
      'green',
      'refactor',
      'debug',
      'review',
      'integration',
    ];

    // Events that indicate meaningful workflow activity
    const WORKFLOW_EVENTS = [
      'start',
      'complete',
      'task_complete',
      'INIT',
      'IRON_LAW',
      'PROGRESS',
      'milestone',
      'pr_created',
      'merged',
      'quality_passed',
    ];

    for (const line of lines) {
      // Match legacy pattern: [timestamp] TYPE message
      const legacyMatch = line.match(/\[[\d\-:\s]+\]\s+([A-Z]+)\s+/);
      if (legacyMatch) {
        entryTypes.add(legacyMatch[1]);
      }

      // Match actual format: [timestamp] [command] [event] data
      // e.g., [13:40:01] [ideate] [start] idea=...
      const actualMatch = line.match(
        /\[[\d:]+\]\s+\[(\w+)\]\s+\[(\w+)\]/
      );
      if (actualMatch) {
        const command = actualMatch[1].toLowerCase();
        const event = actualMatch[2];
        if (WORKFLOW_COMMANDS.includes(command)) {
          workflowCommands.add(command);
        }
        if (WORKFLOW_EVENTS.includes(event)) {
          workflowEvents.add(event);
        }
      }
    }

    // Legacy check
    const hasPhaseEntries = entryTypes.has('PHASE');
    const hasToolEntries = entryTypes.has('TOOL');
    const hasTestEntries = entryTypes.has('TEST');
    const hasLegacyStructuredEntries =
      hasPhaseEntries || hasToolEntries || hasTestEntries;

    // Actual format check - has workflow commands with meaningful events
    const hasWorkflowEntries = workflowCommands.size > 0 && workflowEvents.size > 0;

    const hasStructuredEntries = hasLegacyStructuredEntries || hasWorkflowEntries;

    // Warn if stale during active session
    if (isStale && sessionActive) {
      return {
        status: 'warn',
        message: `Session log is stale (${Math.floor(ageMs / 1000 / 60)} minutes old) during active session`,
        details: {
          hasPhaseEntries,
          hasToolEntries,
          hasWorkflowEntries,
          workflowCommands: Array.from(workflowCommands),
          workflowEvents: Array.from(workflowEvents),
          entryTypes: Array.from(entryTypes),
        },
      };
    }

    // Warn if no structured entries
    if (!hasStructuredEntries) {
      return {
        status: 'warn',
        message:
          'Session log has no structured entries (no workflow commands like ideate/plan/build/ship)',
        details: {
          hasPhaseEntries: false,
          hasToolEntries: false,
          hasWorkflowEntries: false,
          workflowCommands: Array.from(workflowCommands),
          workflowEvents: Array.from(workflowEvents),
          entryTypes: Array.from(entryTypes),
        },
      };
    }

    // Pass
    return {
      status: 'pass',
      message: `Logging operational (${workflowCommands.size} commands, ${workflowEvents.size} events)`,
      details: {
        hasPhaseEntries,
        hasToolEntries,
        hasWorkflowEntries,
        workflowCommands: Array.from(workflowCommands),
        workflowEvents: Array.from(workflowEvents),
        entryTypes: Array.from(entryTypes),
      },
    };
  } catch (error) {
    // Fail if file is missing
    return {
      status: 'fail',
      message: `Session log is missing: ${sessionLogPath}`,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
