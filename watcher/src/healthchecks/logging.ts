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
    const lines = logContent.split('\n');

    for (const line of lines) {
      // Match pattern: [timestamp] TYPE message
      const match = line.match(/\[[\d\-:\s]+\]\s+([A-Z]+)\s+/);
      if (match) {
        entryTypes.add(match[1]);
      }
    }

    const hasPhaseEntries = entryTypes.has('PHASE');
    const hasToolEntries = entryTypes.has('TOOL');
    const hasTestEntries = entryTypes.has('TEST');
    const hasStructuredEntries = hasPhaseEntries || hasToolEntries || hasTestEntries;

    // Warn if stale during active session
    if (isStale && sessionActive) {
      return {
        status: 'warn',
        message: `Session log is stale (${Math.floor(ageMs / 1000 / 60)} minutes old) during active session`,
        details: {
          hasPhaseEntries,
          hasToolEntries,
          entryTypes: Array.from(entryTypes),
        },
      };
    }

    // Warn if no structured entries
    if (!hasStructuredEntries) {
      return {
        status: 'warn',
        message: 'Session log has no structured entries (PHASE, TOOL, TEST)',
        details: {
          hasPhaseEntries: false,
          hasToolEntries: false,
          entryTypes: Array.from(entryTypes),
        },
      };
    }

    // Pass
    return {
      status: 'pass',
      message: 'Logging is operational with structured entries',
      details: {
        hasPhaseEntries,
        hasToolEntries,
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
