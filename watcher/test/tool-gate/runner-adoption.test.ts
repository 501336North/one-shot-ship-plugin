/**
 * @behavior During `/oss:build`, a test command the gate doesn't know (not in
 *   `testCommandPatterns`) is adopted as the build's test runner when it fails with
 *   "Exit code N", ran last, its result is not hidden (piped, `|| true`, interrupted), and it
 *   looks like a test run: one of its words, split on non-alphanumerics, is test/tests/spec/
 *   specs/check/checks, or one of its words names a test file. The adoption is logged once as
 *   `runner-adopted`, that run counts red, and later runs of it count red or green. A command
 *   with no test hint (plain `make`, `git checkout`, `npm run typecheck`) is never adopted, and
 *   an agent that runs no test-like command keeps its source edits refused however often it tries.
 * @business-rule US-004 amendment (AC-004.9 to AC-004.11), ADR-002 amendment, plan decision 4:
 *   no lockout for an unknown runner, and no unlock for an agent that runs no tests.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSettings, type GateSettings } from '../../src/tool-gate/rule-file.js';
import type { CycleRecord, GateEvent, StateStore } from '../../src/tool-gate/state-store.js';
import type { WorkflowState } from '../../src/tool-gate/workflow-state.js';
import { recordTestRun, type PostCall } from '../../src/tool-gate/recorder.js';
import { checkRedCycle } from '../../src/tool-gate/rules/red-cycle.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPO = '/work/repo';
const HOME = '/home/dev';
const TS = '2026-11-09T12:00:00.000Z';
const BUILD = '2026-11-09T11:00:00.000Z';

const { settings: SETTINGS } = loadSettings(
  (p) => (p.startsWith(PLUGIN_ROOT) && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null),
  PLUGIN_ROOT,
  REPO,
);

/** A state store that keeps what was written, so a sequence of runs builds on itself. */
function memoryStore(initial: CycleRecord | null = null) {
  let cycle = initial;
  return {
    readCycle: vi.fn<StateStore['readCycle']>(() => cycle),
    writeCycle: vi.fn<StateStore['writeCycle']>((next) => {
      cycle = next;
    }),
    appendEvent: vi.fn<StateStore['appendEvent']>(),
  };
}

type MemoryStore = ReturnType<typeof memoryStore>;

function success(command: string): PostCall {
  return { hookEvent: 'PostToolUse', command, cwd: REPO };
}

function failure(command: string, isInterrupt = false): PostCall {
  return { hookEvent: 'PostToolUseFailure', command, cwd: REPO, error: 'Exit code 1\nFAIL', isInterrupt };
}

function record(
  call: PostCall,
  store: StateStore,
  currentCommand: string | null = 'build',
  settings: GateSettings = SETTINGS,
) {
  recordTestRun(call, { settings, store, home: HOME, ts: TS, buildStartedAt: BUILD, currentCommand });
}

function events(store: MemoryStore, kind: GateEvent['kind']): GateEvent[] {
  return store.appendEvent.mock.calls.map(([event]) => event).filter((event) => event.kind === kind);
}

describe('runner adoption during a build', () => {
  it('should adopt ./run-tests.sh that exits non-zero during build, log runner-adopted once and count red', () => {
    const store = memoryStore();

    record(failure('./run-tests.sh'), store);

    expect(store.readCycle()).toEqual({ startedAt: BUILD, lastResult: 'red', files: [], adoptedCommand: './run-tests.sh' });
    expect(events(store, 'runner-adopted')).toEqual([
      { ts: TS, tool: 'Bash', kind: 'runner-adopted', command: './run-tests.sh', result: 'red' },
    ]);
    expect(events(store, 'test-run')).toEqual([
      { ts: TS, tool: 'Bash', kind: 'test-run', command: './run-tests.sh', result: 'red' },
    ]);

    // Failing again: still red, but the runner was already adopted, so it is not logged again.
    record(failure('./run-tests.sh'), store);
    expect(events(store, 'runner-adopted')).toHaveLength(1);
    expect(events(store, 'test-run').map((event) => event.result)).toEqual(['red', 'red']);
  });

  it('should count later runs of the adopted command red or green', () => {
    const store = memoryStore({ startedAt: BUILD, lastResult: 'red', files: ['/work/repo/src/a.ts'], adoptedCommand: './run-tests.sh' });

    record(success('./run-tests.sh'), store);
    expect(store.readCycle()).toEqual({
      startedAt: BUILD,
      lastResult: 'green',
      files: ['/work/repo/src/a.ts'],
      adoptedCommand: './run-tests.sh',
    });

    record(failure('./run-tests.sh unit'), store);
    expect(store.readCycle()).toEqual({ startedAt: BUILD, lastResult: 'red', files: [], adoptedCommand: './run-tests.sh' });

    // A hidden result of the adopted command is unknown, like any listed test command.
    record(success('./run-tests.sh | tail -5'), store);
    expect(store.readCycle()?.lastResult).toBe('red');
    expect(events(store, 'test-run').map((event) => event.result)).toEqual(['green', 'red', 'unknown']);
    expect(events(store, 'runner-adopted')).toEqual([]);
  });

  it('should adopt a command that names a test file (node foo.test.js)', () => {
    const store = memoryStore();
    record(failure('node foo.test.js'), store);
    expect(store.readCycle()).toEqual({ startedAt: BUILD, lastResult: 'red', files: [], adoptedCommand: 'node foo.test.js' });

    // A test file named by the repo's own testFilePatterns, with no test word in it.
    const withE2e: GateSettings = { ...SETTINGS, testFilePatterns: [...SETTINGS.testFilePatterns, '**/*.e2e.js'] };
    const e2e = memoryStore();
    record(failure('node login.e2e.js'), e2e, 'build', withE2e);
    expect(e2e.readCycle()?.adoptedCommand).toBe('node login.e2e.js');
    expect(events(e2e, 'runner-adopted')).toHaveLength(1);
  });

  it('should not adopt plain make, git checkout, or npm run typecheck', () => {
    for (const command of ['make', 'git checkout feature', 'npm run typecheck', 'node login.e2e.js']) {
      const store = memoryStore();
      record(failure(command), store);
      expect(store.writeCycle).not.toHaveBeenCalled();
      expect(store.appendEvent).not.toHaveBeenCalled();
    }
  });

  it('should not adopt shell tests, searches or git commands that fail', () => {
    // These fail easily and hold a test word, so adopting them would hand out a red with no failing test.
    for (const command of ['test -f missing.txt', '[ -f x ]', 'grep -r check src', 'rg spec', 'git check-ignore x']) {
      const store = memoryStore();
      record(failure(command), store);
      expect(store.writeCycle).not.toHaveBeenCalled();
      expect(store.appendEvent).not.toHaveBeenCalled();
    }

    const runner = memoryStore();
    record(failure('./run-tests.sh'), runner);
    expect(runner.readCycle()).toEqual({ startedAt: BUILD, lastResult: 'red', files: [], adoptedCommand: './run-tests.sh' });
  });

  it('should keep the first adopted runner for the rest of the build', () => {
    const store = memoryStore();
    record(failure('./run-tests.sh'), store);

    // Another unlisted test-like command fails later in the same build: the first runner stays.
    record(failure('./check-all.sh'), store);
    expect(store.readCycle()?.adoptedCommand).toBe('./run-tests.sh');
    expect(events(store, 'runner-adopted')).toHaveLength(1);
    expect(events(store, 'test-run').map((event) => event.command)).toEqual(['./run-tests.sh']);

    // The adopted runner still counts.
    record(success('./run-tests.sh'), store);
    expect(store.readCycle()).toEqual({ startedAt: BUILD, lastResult: 'green', files: [], adoptedCommand: './run-tests.sh' });
  });

  it('should not adopt outside build or from a piped / || true run', () => {
    // Outside a build (another command, or none running).
    for (const currentCommand of ['plan', null]) {
      const store = memoryStore();
      record(failure('./run-tests.sh'), store, currentCommand);
      expect(store.writeCycle).not.toHaveBeenCalled();
      expect(store.appendEvent).not.toHaveBeenCalled();
    }

    // Hidden or not-last results: the failure may not be the runner's.
    const hidden: PostCall[] = [
      failure('./run-tests.sh | tail -5'),
      failure('./run-tests.sh | grep test'),
      failure('./run-tests.sh || true'),
      failure('./run-tests.sh', true),
      failure('./run-tests.sh; false'),
    ];
    for (const call of hidden) {
      const store = memoryStore();
      record(call, store);
      expect(store.writeCycle).not.toHaveBeenCalled();
      expect(events(store, 'runner-adopted')).toEqual([]);
    }
  });

  it('should keep source edits refused for an agent that runs no test-like command, after 20 attempts', () => {
    const store = memoryStore();
    const workflow: WorkflowState = { read: () => ({ currentCommand: 'build', currentCommandStartedAt: BUILD }) };
    const nonTests = ['make', 'git checkout feature', 'npm run typecheck', 'npm run lint', 'tsc --noEmit'];

    for (let attempt = 0; attempt < 20; attempt++) {
      record(failure(nonTests[attempt % nonTests.length]!), store);
      const refusal = checkRedCycle(
        { tool: 'Edit', filePath: `/work/repo/src/feature-${attempt}.ts`, changes: [{ before: 'a', after: 'b' }] },
        SETTINGS,
        REPO,
        HOME,
        workflow,
        store,
      );
      expect(refusal?.rule).toBe('red-cycle');
    }
    expect(store.writeCycle).not.toHaveBeenCalled();
  });
});
