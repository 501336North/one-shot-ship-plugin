/**
 * @behavior While `/oss:build` runs, the tool gate refuses a source-file edit until a test has
 *   gone red in this build. After a red run any source file may be edited, and each edited file
 *   joins the cycle. After a green run only files already in the cycle may be edited; a new source
 *   file is refused until a test goes red again. Test files, Markdown, JSON, YAML and the dev docs
 *   are never covered. Outside a build (or with no workflow state) the rule does not apply. A cycle
 *   recorded under another build's start stamp counts as no run yet.
 * @business-rule US-004 (AC-004.1 to AC-004.6, AC-004.8), ADR-002 (per-cycle RED rule) and
 *   ADR-008 ("this build" is the build's start stamp): no production code without a failing test.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readEditCall, type EditCall } from '../../../src/tool-gate/edit-call.js';
import { loadSettings } from '../../../src/tool-gate/rule-file.js';
import type { CycleRecord, StateStore } from '../../../src/tool-gate/state-store.js';
import type { WorkflowState, WorkflowSnapshot } from '../../../src/tool-gate/workflow-state.js';
import { checkRedCycle } from '../../../src/tool-gate/rules/red-cycle.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOT = '/work/repo';
const HOME = '/home/dev';
const BUILD = '2026-11-09T11:00:00.000Z';
const OLD_BUILD = '2026-11-08T09:00:00.000Z';

const { settings: SETTINGS } = loadSettings(
  (p) => (p.startsWith(PLUGIN_ROOT) && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null),
  PLUGIN_ROOT,
  ROOT,
);

const NO_RUN_TEXT =
  "No failing test recorded. Write a failing test and run it. If your tests run with a command the gate doesn't recognize, ask the user to add it to .oss/tool-gates.json with `!`.";

function mockWorkflow(snapshot: WorkflowSnapshot | null = { currentCommand: 'build', currentCommandStartedAt: BUILD }) {
  return { read: vi.fn<WorkflowState['read']>(() => snapshot) };
}

function mockStore(cycle: CycleRecord | null = null) {
  return {
    readCycle: vi.fn<StateStore['readCycle']>(() => cycle),
    writeCycle: vi.fn<StateStore['writeCycle']>(),
    appendEvent: vi.fn<StateStore['appendEvent']>(),
  };
}

function edit(file: string): EditCall {
  const call = readEditCall('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, ROOT, HOME, () => null);
  if (call === null) throw new Error('not an edit call');
  return call;
}

function check(file: string, workflow: WorkflowState, store: StateStore) {
  return checkRedCycle(edit(file), SETTINGS, ROOT, HOME, workflow, store);
}

describe('RED rule: no source edit without a failing test', () => {
  it('should refuse a source edit in build with no recorded run, with the "No failing test recorded…" text', () => {
    const store = mockStore(null);

    const refusal = check('src/app.ts', mockWorkflow(), store);

    expect(refusal).toEqual({ rule: 'red-cycle', reason: `Refused: ${NO_RUN_TEXT}` });
    expect(store.writeCycle).not.toHaveBeenCalled();
  });

  it('should allow any source edit after red and add the file to the cycle', () => {
    const cycle: CycleRecord = { startedAt: BUILD, lastResult: 'red', files: ['/work/repo/src/a.ts'], adoptedCommand: 'npm test' };
    const store = mockStore(cycle);

    expect(check('src/new.ts', mockWorkflow(), store)).toBeNull();
    expect(store.writeCycle).toHaveBeenCalledWith({
      startedAt: BUILD,
      lastResult: 'red',
      files: ['/work/repo/src/a.ts', '/work/repo/src/new.ts'],
      adoptedCommand: 'npm test',
    });

    store.writeCycle.mockClear();
    expect(check('src/a.ts', mockWorkflow(), store)).toBeNull();
    expect(store.writeCycle).not.toHaveBeenCalled();
  });

  it('should allow a cycle file and refuse a new file after green', () => {
    const cycle: CycleRecord = { startedAt: BUILD, lastResult: 'green', files: ['/work/repo/src/a.ts'], adoptedCommand: null };
    const store = mockStore(cycle);

    expect(check('src/a.ts', mockWorkflow(), store)).toBeNull();

    const refusal = check('src/other.py', mockWorkflow(), store);
    expect(refusal?.rule).toBe('red-cycle');
    expect(refusal?.reason).toMatch(/^Refused: /);
    expect(refusal?.reason).toContain('src/other.py');
    expect(refusal?.reason).toContain('failing test');
    expect(store.writeCycle).not.toHaveBeenCalled();
  });

  it('should never cover test files, .md, .json, .yml/.yaml or .oss/dev/**', () => {
    const store = mockStore(null);
    const workflow = mockWorkflow();

    for (const file of [
      'src/app.test.ts',
      'src/__tests__/app.ts',
      'scripts/test_hooks.sh',
      'README.md',
      'package.json',
      '.github/workflows/ci.yml',
      'config/app.yaml',
      '.oss/dev/active/tool-gates/PROGRESS.md',
      '.oss/dev/active/tool-gates/timeline.ndjson',
    ]) {
      expect(check(file, workflow, store), file).toBeNull();
    }
    expect(store.writeCycle).not.toHaveBeenCalled();
  });

  it('should allow editing a script or code file kept with the dev docs, even with no recorded run', () => {
    const store = mockStore(null);

    expect(check('.oss/dev/active/x/check.sh', mockWorkflow(), store)).toBeNull();
    expect(check('.oss/dev/active/x/helper.ts', mockWorkflow(), store)).toBeNull();
    expect(store.writeCycle).not.toHaveBeenCalled();
  });

  it('should not apply when currentCommand is not build or workflow-state.json is missing', () => {
    const store = mockStore(null);

    expect(check('src/app.ts', mockWorkflow({ currentCommand: 'plan', currentCommandStartedAt: BUILD }), store)).toBeNull();
    expect(check('src/app.ts', mockWorkflow({ currentCommand: null, currentCommandStartedAt: null }), store)).toBeNull();
    expect(check('src/app.ts', mockWorkflow(null), store)).toBeNull();
    expect(store.writeCycle).not.toHaveBeenCalled();
  });

  it("should treat a cycle stamped with another build's start as no run yet", () => {
    const oldRed: CycleRecord = { startedAt: OLD_BUILD, lastResult: 'red', files: [], adoptedCommand: null };
    expect(check('src/app.ts', mockWorkflow(), mockStore(oldRed))?.reason).toBe(`Refused: ${NO_RUN_TEXT}`);

    const unstampedRed: CycleRecord = { startedAt: null, lastResult: 'red', files: [], adoptedCommand: null };
    expect(check('src/app.ts', mockWorkflow(), mockStore(unstampedRed))?.reason).toBe(`Refused: ${NO_RUN_TEXT}`);

    // Both stamps absent (an older workflow-state file) count as the same build.
    const store = mockStore(unstampedRed);
    expect(check('src/app.ts', mockWorkflow({ currentCommand: 'build', currentCommandStartedAt: null }), store)).toBeNull();
    expect(store.writeCycle).toHaveBeenCalledWith({ ...unstampedRed, files: ['/work/repo/src/app.ts'] });
  });
});
