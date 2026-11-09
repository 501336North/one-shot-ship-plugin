/**
 * RED rule (US-004, ADR-002, ADR-008): while `/oss:build` runs, a source-file edit (an extension
 * in `sourceExtensions`, outside `testFilePatterns`) needs a red test run in this build. After
 * red any source file may be edited and joins the cycle; after green only the cycle's files may.
 * A cycle stamped with another build's start counts as no run yet.
 */

import path from 'node:path';
import type { EditCall } from '../edit-call.js';
import { matchPath } from '../patterns.js';
import type { GateSettings } from '../rule-file.js';
import type { StateStore } from '../state-store.js';
import type { WorkflowState } from '../workflow-state.js';
import type { Refusal } from './refusal.js';

/** The `/oss:*` command the rule is limited to (a workflow name, not a rule value). */
const BUILD_COMMAND = 'build';

const NO_RUN =
  "Refused: No failing test recorded. Write a failing test and run it. If your tests run with a command the gate doesn't recognize, ask the user to add it to .oss/tool-gates.json with `!`.";

/**
 * The OSS dev docs are never covered (AC-004.5). A code constant, not a rule value: it is the
 * fixed OSS dev-docs location, and a repo rule file must not be able to change it.
 */
const DEV_DOCS = '.oss/dev/**';

function isSourceFile(filePath: string, settings: GateSettings, root: string, home: string): boolean {
  return (
    settings.sourceExtensions.includes(path.extname(filePath)) &&
    !matchPath(DEV_DOCS, filePath, { home, root }) &&
    !settings.testFilePatterns.some((glob) => matchPath(glob, filePath, { home, root }))
  );
}

export function checkRedCycle(
  call: EditCall,
  settings: GateSettings,
  root: string,
  home: string,
  workflow: WorkflowState,
  store: StateStore,
): Refusal | null {
  const state = workflow.read();
  if (state === null || state.currentCommand !== BUILD_COMMAND) return null;
  if (!isSourceFile(call.filePath, settings, root, home)) return null;

  const cycle = store.readCycle();
  if (cycle === null || cycle.startedAt !== state.currentCommandStartedAt) {
    return { rule: 'red-cycle', reason: NO_RUN };
  }
  if (cycle.files.includes(call.filePath)) return null;
  if (cycle.lastResult === 'green') {
    return {
      rule: 'red-cycle',
      reason: `Refused: \`${path.relative(root, call.filePath)}\` is not in this cycle and the last test run was green. Write a failing test and run it before editing a new source file.`,
    };
  }
  store.writeCycle({ ...cycle, files: [...cycle.files, call.filePath] });
  return null;
}
