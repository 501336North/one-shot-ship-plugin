/**
 * Workflow state for the tool gate: the running `/oss:*` command and its start stamp, from
 * `<project>/.oss/workflow-state.json`. A collaborator, mocked in the RED-rule tests.
 */

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
