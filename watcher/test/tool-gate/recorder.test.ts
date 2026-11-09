/**
 * @behavior After a Bash call finishes, the tool gate records whether it was a test run and
 *   how it went. A listed test command that succeeds is recorded green; one that fails with
 *   "Exit code N" is recorded red and starts a new cycle (the list of edited files empties).
 *   A test run whose result is hidden (piped into another command, followed by `|| true` /
 *   `|| :`, or interrupted) is logged as unknown and leaves the cycle as it was. A command that
 *   is not a test run records nothing. The cycle carries the start stamp of the current build.
 * @business-rule US-005 (AC-005.1 to AC-005.4, AC-005.6) and AC-004.7: the RED rule and later
 *   cards rely on a trustworthy record of red and green test runs (ADR-008: "this build").
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSettings } from '../../src/tool-gate/rule-file.js';
import type { CycleRecord, GateEvent, StateStore } from '../../src/tool-gate/state-store.js';
import { recordTestRun, type PostCall } from '../../src/tool-gate/recorder.js';

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

function mockStore(cycle: CycleRecord | null = null) {
  const store = {
    readCycle: vi.fn<StateStore['readCycle']>(() => cycle),
    writeCycle: vi.fn<StateStore['writeCycle']>(),
    appendEvent: vi.fn<StateStore['appendEvent']>(),
  };
  return store;
}

function success(command: string): PostCall {
  return { hookEvent: 'PostToolUse', command, cwd: REPO };
}

function failure(command: string, error = 'Exit code 1\nFAIL src/a.test.ts', isInterrupt = false): PostCall {
  return { hookEvent: 'PostToolUseFailure', command, cwd: REPO, error, isInterrupt };
}

function record(call: PostCall, store: StateStore, buildStartedAt: string | null = BUILD) {
  recordTestRun(call, { settings: SETTINGS, store, home: HOME, ts: TS, buildStartedAt });
}

function testRun(command: string, result: GateEvent['result']): GateEvent {
  return { ts: TS, tool: 'Bash', kind: 'test-run', command, result };
}

describe('post-call test-run recorder', () => {
  it('should record green for a listed test command on PostToolUse', () => {
    const cycle: CycleRecord = { startedAt: BUILD, lastResult: 'red', files: ['/work/repo/src/a.ts'], adoptedCommand: null };
    const store = mockStore(cycle);

    record(success('npm test'), store);

    expect(store.appendEvent).toHaveBeenCalledWith(testRun('npm test', 'green'));
    expect(store.writeCycle).toHaveBeenCalledWith({ ...cycle, lastResult: 'green' });
  });

  it('should record red on PostToolUseFailure with "Exit code N"', () => {
    const cycle: CycleRecord = {
      startedAt: BUILD,
      lastResult: 'green',
      files: ['/work/repo/src/a.ts', '/work/repo/src/b.ts'],
      adoptedCommand: './run-tests.sh',
    };
    const store = mockStore(cycle);

    record(failure('cd sub && npx vitest run'), store);

    expect(store.appendEvent).toHaveBeenCalledWith(testRun('cd sub && npx vitest run', 'red'));
    // A red run starts a new cycle: the file list empties; the build's adopted runner stays.
    expect(store.writeCycle).toHaveBeenCalledWith({
      startedAt: BUILD,
      lastResult: 'red',
      files: [],
      adoptedCommand: './run-tests.sh',
    });

    // A failure that is not a test's exit code (e.g. a hook timeout) is not counted red.
    const other = mockStore(cycle);
    record(failure('npm test', 'Command timed out after 2m'), other);
    expect(other.appendEvent).toHaveBeenCalledWith(testRun('npm test', 'unknown'));
    expect(other.writeCycle).not.toHaveBeenCalled();
  });

  it('should record unknown for piped, || true, || : and is_interrupt runs, and leave the cycle unchanged', () => {
    const cycle: CycleRecord = { startedAt: BUILD, lastResult: 'green', files: ['/work/repo/src/a.ts'], adoptedCommand: null };
    const hidden: PostCall[] = [
      failure('npm test | tail -5'),
      success('npm test | tail -5'),
      failure('pytest || true'),
      success('pytest || true'),
      success('go test ./... || :'),
      failure('cargo test', 'Exit code 130', true),
    ];

    for (const call of hidden) {
      const store = mockStore(cycle);
      record(call, store);
      expect(store.appendEvent).toHaveBeenCalledWith(testRun(call.command, 'unknown'));
      expect(store.writeCycle).not.toHaveBeenCalled();
    }
  });

  it('should record nothing for a non-test command', () => {
    for (const call of [success('git status'), failure('npm run lint'), failure('ls missing | wc -l')]) {
      const store = mockStore({ startedAt: BUILD, lastResult: 'red', files: [], adoptedCommand: null });
      record(call, store);
      expect(store.appendEvent).not.toHaveBeenCalled();
      expect(store.writeCycle).not.toHaveBeenCalled();
    }
  });

  it('should recognize pnpm test, npm run test:unit, make test, swift test, ./gradlew test, dotnet test', () => {
    for (const command of ['pnpm test', 'npm run test:unit', 'make test', 'swift test', './gradlew test', 'dotnet test']) {
      const store = mockStore();
      record(failure(command), store);
      expect(store.appendEvent).toHaveBeenCalledWith(testRun(command, 'red'));
      expect(store.writeCycle).toHaveBeenCalledWith({ startedAt: BUILD, lastResult: 'red', files: [], adoptedCommand: null });
    }
  });

  it("should stamp the cycle with the current build's currentCommandStartedAt", () => {
    const NEW_BUILD = '2026-11-09T13:30:00.000Z';
    const oldBuildCycle: CycleRecord = {
      startedAt: BUILD,
      lastResult: 'red',
      files: ['/work/repo/src/a.ts'],
      adoptedCommand: './run-tests.sh',
    };

    // A green run under a new build does not carry the old build's files or runner.
    const green = mockStore(oldBuildCycle);
    record(success('npm test'), green, NEW_BUILD);
    expect(green.writeCycle).toHaveBeenCalledWith({ startedAt: NEW_BUILD, lastResult: 'green', files: [], adoptedCommand: null });

    const red = mockStore(oldBuildCycle);
    record(failure('npm test'), red, NEW_BUILD);
    expect(red.writeCycle).toHaveBeenCalledWith({ startedAt: NEW_BUILD, lastResult: 'red', files: [], adoptedCommand: null });

    // An older state file with no build stamp: the cycle is stamped as absent.
    const unstamped = mockStore();
    record(failure('npm test'), unstamped, null);
    expect(unstamped.writeCycle).toHaveBeenCalledWith({ startedAt: null, lastResult: 'red', files: [], adoptedCommand: null });
  });
});
