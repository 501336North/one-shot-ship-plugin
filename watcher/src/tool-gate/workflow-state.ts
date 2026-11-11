/**
 * Workflow state for the tool gate: the running `/oss:*` command and its start stamp, from
 * `<project>/.oss/workflow-state.json`. A collaborator, mocked in the RED-rule tests.
 */

import path from 'node:path';
import { readRegularFile } from './regular-file.js';

/** The `/oss:*` command the RED rule and runner adoption apply in (a workflow name, not a rule value). */
export const BUILD_COMMAND = 'build';

export interface WorkflowSnapshot {
  /** Top-level `currentCommand`, e.g. "build" (null when absent). */
  currentCommand: string | null;
  /** Top-level `currentCommandStartedAt` (null when absent, ADR-008). */
  currentCommandStartedAt: string | null;
}

export interface WorkflowState {
  /** The snapshot, or null when workflow-state.json is missing. */
  read(): WorkflowSnapshot | null;
}

/** Largest workflow-state.json read (a read limit, not a rule value). */
const MAX_STATE_BYTES = 1024 * 1024;

/**
 * Reads `<projectDir>/.oss/workflow-state.json` on each call; a missing file is null. A corrupt
 * one throws, and so does anything but a regular file (a named pipe would stall the gate; a
 * symlink is not followed): the caller's gate-error.
 */
export function fileWorkflowState(projectDir: string): WorkflowState {
  return {
    read() {
      const read = readRegularFile(path.join(projectDir, '.oss', 'workflow-state.json'), MAX_STATE_BYTES, true);
      if (read === 'missing') return null;
      if (read === 'not-regular') throw new Error('workflow state is not a regular file under 1 MB');
      const data: unknown = JSON.parse(read.text);
      const record: Record<string, unknown> = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      return {
        currentCommand: typeof record.currentCommand === 'string' ? record.currentCommand : null,
        currentCommandStartedAt:
          typeof record.currentCommandStartedAt === 'string' ? record.currentCommandStartedAt : null,
      };
    },
  };
}
