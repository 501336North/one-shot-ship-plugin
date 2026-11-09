/**
 * Workflow state for the tool gate: the running `/oss:*` command and its start stamp, from
 * `<project>/.oss/workflow-state.json`. A collaborator, mocked in the RED-rule tests.
 */

import fs from 'node:fs';
import path from 'node:path';

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

/** Reads `<projectDir>/.oss/workflow-state.json` on each call; a missing file is null, a corrupt one throws. */
export function fileWorkflowState(projectDir: string): WorkflowState {
  return {
    read() {
      let text: string;
      try {
        text = fs.readFileSync(path.join(projectDir, '.oss', 'workflow-state.json'), 'utf8');
      } catch {
        return null;
      }
      const data: unknown = JSON.parse(text);
      const record: Record<string, unknown> = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      return {
        currentCommand: typeof record.currentCommand === 'string' ? record.currentCommand : null,
        currentCommandStartedAt:
          typeof record.currentCommandStartedAt === 'string' ? record.currentCommandStartedAt : null,
      };
    },
  };
}
