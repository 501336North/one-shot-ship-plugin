/**
 * RED rule (US-004, ADR-002, ADR-008): while `/oss:build` runs, a source-file edit (an extension
 * in `sourceExtensions`, outside `testFilePatterns`) needs a red test run in this build. After
 * red any source file may be edited and joins the cycle; after green only the cycle's files may.
 * A cycle stamped with another build's start counts as no run yet.
 */

import path from 'node:path';
import type { EditCall } from '../edit-call.js';
import { matchAnyPath, matchPath } from '../patterns.js';
import type { GateSettings } from '../rule-file.js';
import type { StateStore } from '../state-store.js';
import { BUILD_COMMAND, type WorkflowState } from '../workflow-state.js';
import type { Refusal } from './refusal.js';

const NO_RUN =
  "Refused: No failing test recorded in this build. Write a failing test and run it on its own with a test command, unpiped (for example `npx vitest run <file>` or `pytest <file>`). Another command that names a test file or has the word test, spec or check in it, and fails, is taken as this build's test command.";

/**
 * The OSS dev docs are never covered (AC-004.5). A code constant, not a rule value: it is the
 * fixed OSS dev-docs location, and a repo rule file must not be able to change it.
 */
const DEV_DOCS = '.oss/dev/**';

function isSourceFile(filePath: string, settings: GateSettings, root: string, home: string): boolean {
  return (
    // Any case: `foo.TS` is the same kind of file. Test-file patterns and the dev-docs folder stay
    // case-sensitive here, since matching them more widely would exempt more files from the rule.
    settings.sourceExtensions.some((ext) => ext.toLowerCase() === path.extname(filePath).toLowerCase()) &&
    !matchPath(DEV_DOCS, filePath, { home, root }) &&
    !matchAnyPath(settings.testFilePatterns, filePath, { home, root })
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
