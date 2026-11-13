/**
 * @behavior When a build phase ends, the plugin builds the build result from the tool gate's own test-run log
 *           (`.oss/tool-gates/events.ndjson`, written by the R-253 recorder), so "I saw a failing test, then a passing
 *           one" is recorded by code, not claimed by the model.
 * @business-rule R-257 AC-003.3: only this build's test runs count (events at or after the build's startedAt); red
 *                then green passes, green with no red is `no_red`, no runs is `no_test_runs`, a last red is
 *                `not_green`. F4: the log is read backwards with an 8 MB cap; hitting the cap is `unverified` with
 *                `events_truncated`, never a wrong `no_red`. D15: `evidenceTrust` is `repo-file`. A symlinked or
 *                non-regular log is `unsafe_path`.
 * @boundary watcher/src/phase-results/assemble-build.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { assembleBuild } from '../../src/phase-results/assemble-build.js';
import type { AssembleContext, AssembleOutcome } from '../../src/phase-results/assemble-common.js';
import { loadPhaseSchema } from '../../src/phase-results/schemas.js';
import { validate } from '../../src/phase-results/validate.js';
import { fileStateStore, type GateEvent, type TestResult } from '../../src/tool-gate/state-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '../../..');
const STARTED_AT = '2026-11-13T09:00:00.000Z';
const EARLIER_BUILD = '2026-11-12T09:00:00.000Z';
const CAP = 8 * 1024 * 1024;
const CHUNK = 64 * 1024;

let repo: string;
let valueDir: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-build-'));
  valueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-build-values-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(valueDir, { recursive: true, force: true });
});

function ctx(): AssembleContext {
  return {
    repo,
    feature: 'phase-results',
    startedAt: STARTED_AT,
    headSha: 'a'.repeat(40),
    valueDir,
    now: () => new Date('2026-11-13T10:00:00.000Z'),
  };
}

function eventsFile(): string {
  return path.join(repo, '.oss', 'tool-gates', 'events.ndjson');
}

function at(base: string, seconds: number): string {
  return new Date(Date.parse(base) + seconds * 1000).toISOString();
}

function testRun(ts: string, result: TestResult): GateEvent {
  return { ts, tool: 'Bash', kind: 'test-run', program: 'npx', result };
}

/** Writes events the way the recorder does, through the real state store, and the cycle for the last one. */
function record(buildStartedAt: string, runs: Array<[number, TestResult]>): void {
  const store = fileStateStore(repo);
  for (const [s, result] of runs) {
    store.appendEvent(testRun(at(buildStartedAt, s), result));
    store.writeCycle({ startedAt: buildStartedAt, lastResult: result, files: [], adoptedCommand: null });
  }
}

function result(o: AssembleOutcome): Record<string, unknown> {
  if (!o.ok) throw new Error(`expected ok, got ${o.error}`);
  return o.result;
}

function errorOf(o: AssembleOutcome): string {
  if (o.ok) throw new Error('expected a failure');
  return o.error;
}

describe('assembleBuild', () => {
  // User who saw a failing test and then a passing one gets a verified, schema-valid build result.
  // Rule: red then green for this build passes; every field is code-sourced and evidence is repo-file (D15).
  it('builds a verified, schema-valid result from red then green', () => {
    record(STARTED_AT, [
      [10, 'red'],
      [20, 'green'],
    ]);
    const r = result(assembleBuild(ctx()));
    expect(r.verification).toBe('verified');
    expect(r.testRuns).toEqual({ sawRed: true, lastResult: 'green', count: 2 });
    expect(r.sources).toEqual({ testRuns: 'code', evidenceTrust: 'code' });
    expect(validate(loadPhaseSchema('build', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });

  // User reading the result sees it is backed by repo files, not ledger-checked evidence.
  // Rule: D15, evidenceTrust is "repo-file" until the recorder hash chain exists.
  it('marks the evidence as repo-file', () => {
    record(STARTED_AT, [
      [10, 'red'],
      [20, 'green'],
    ]);
    expect(result(assembleBuild(ctx())).evidenceTrust).toBe('repo-file');
  });

  // User who only ever ran passing tests is told they never saw a failing test first.
  // Rule: AC-003.3, green with no red fails with no_red.
  it('fails with no_red when only green runs were recorded', () => {
    record(STARTED_AT, [[10, 'green']]);
    expect(errorOf(assembleBuild(ctx()))).toBe('no_red');
  });

  // User who ran no tests at all is told so.
  // Rule: AC-003.3, no test-run events for this build fails with no_test_runs.
  it('fails with no_test_runs when there is no event log', () => {
    expect(errorOf(assembleBuild(ctx()))).toBe('no_test_runs');
  });

  // User whose tests still fail at the end is told the build is not green.
  // Rule: AC-003.3, a last result of red fails with not_green.
  it('fails with not_green when the last run was red', () => {
    record(STARTED_AT, [
      [10, 'red'],
      [20, 'green'],
      [30, 'red'],
    ]);
    expect(errorOf(assembleBuild(ctx()))).toBe('not_green');
  });

  // User cannot pass this build on the strength of a red seen in an earlier build.
  // Rule: AC-003.3, only events at or after this build's startedAt count.
  it('ignores an earlier build’s events', () => {
    record(EARLIER_BUILD, [[10, 'red']]);
    record(STARTED_AT, [[10, 'green']]);
    expect(errorOf(assembleBuild(ctx()))).toBe('no_red');
  });

  // User with a huge event log never gets a false "no red" because the red was beyond the read cap.
  // Rule: F4, a capped read that never reached the build start is unverified/events_truncated, never no_red.
  it('never reports no_red when the log is larger than the cap', () => {
    const lines = [JSON.stringify(testRun(at(STARTED_AT, 1), 'red'))];
    const green = JSON.stringify(testRun(at(STARTED_AT, 2), 'green'));
    // Real recorder lines are about 95 bytes, so 220k of them make about 20 MB.
    for (let i = 0; i < 220_000; i++) lines.push(green);
    fs.mkdirSync(path.dirname(eventsFile()), { recursive: true });
    fs.writeFileSync(eventsFile(), lines.join('\n') + '\n');
    expect(fs.statSync(eventsFile()).size).toBeGreaterThan(2 * CAP);

    const o = assembleBuild(ctx());
    expect(o.ok).toBe(true);
    const r = result(o);
    if (r.verification === 'unverified') {
      expect(r.verificationError).toEqual({ check: 'build-events', errorClass: 'events_truncated' });
    } else {
      expect(r.testRuns).toMatchObject({ sawRed: true, lastResult: 'green' });
    }
    expect(validate(loadPhaseSchema('build', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });

  // User's session is not stalled reading a huge log: the bytes read stay bounded.
  // Rule: F4, at most the 8 MB cap plus one 64 KB chunk is read.
  it('reads at most the cap plus one chunk', () => {
    const line = JSON.stringify(testRun(at(STARTED_AT, 2), 'green'));
    fs.mkdirSync(path.dirname(eventsFile()), { recursive: true });
    fs.writeFileSync(eventsFile(), (line + '\n').repeat(220_000));
    let bytes = 0;
    assembleBuild(ctx(), {
      readChunk: (fd, buf, offset, length, position) => {
        const n = fs.readSync(fd, buf, offset, length, position);
        bytes += n;
        return n;
      },
    });
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(CAP + CHUNK);
  });

  // User cannot point the plugin at another file by planting a symlink as the event log.
  // Rule: the log is opened with O_NOFOLLOW and must be a regular file, else unsafe_path.
  it('refuses a symlinked events.ndjson with unsafe_path', () => {
    const real = path.join(repo, 'elsewhere.ndjson');
    fs.writeFileSync(real, JSON.stringify(testRun(at(STARTED_AT, 1), 'red')) + '\n');
    fs.mkdirSync(path.dirname(eventsFile()), { recursive: true });
    fs.symlinkSync(real, eventsFile());
    expect(errorOf(assembleBuild(ctx()))).toBe('unsafe_path');
  });

  // User cannot point the plugin at evidence outside the repo by planting a symlinked .oss/tool-gates folder.
  // Rule: path problems are refused; a symlinked tool-gates folder gives unsafe_path.
  it('refuses a symlinked .oss/tool-gates folder with unsafe_path', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-build-outside-'));
    try {
      fs.writeFileSync(
        path.join(outside, 'events.ndjson'),
        [testRun(at(STARTED_AT, 1), 'red'), testRun(at(STARTED_AT, 2), 'green')].map((e) => JSON.stringify(e)).join('\n') + '\n',
      );
      fs.mkdirSync(path.join(repo, '.oss'));
      fs.symlinkSync(outside, path.join(repo, '.oss', 'tool-gates'));
      expect(errorOf(assembleBuild(ctx()))).toBe('unsafe_path');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // User cannot point the plugin at evidence outside the repo by planting a symlinked .oss folder.
  // Rule: path problems are refused; a symlinked .oss folder gives unsafe_path.
  it('refuses a symlinked .oss folder with unsafe_path', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-build-outside-'));
    try {
      fs.mkdirSync(path.join(outside, 'tool-gates'));
      fs.writeFileSync(
        path.join(outside, 'tool-gates', 'events.ndjson'),
        [testRun(at(STARTED_AT, 1), 'red'), testRun(at(STARTED_AT, 2), 'green')].map((e) => JSON.stringify(e)).join('\n') + '\n',
      );
      fs.symlinkSync(outside, path.join(repo, '.oss'));
      expect(errorOf(assembleBuild(ctx()))).toBe('unsafe_path');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // User's build notes are kept as redacted, model-sourced text.
  // Rule: AC-002.1, optional notes come from notes.txt with sources.notes = "model", secrets redacted.
  it('adds redacted model notes from notes.txt', () => {
    record(STARTED_AT, [
      [10, 'red'],
      [20, 'green'],
    ]);
    const key = 'sk-ant-api03-' + 'Ab1'.repeat(30);
    fs.writeFileSync(path.join(valueDir, 'notes.txt'), `used ${key} here`);
    const r = result(assembleBuild(ctx()));
    expect(r.sources).toEqual({ testRuns: 'code', evidenceTrust: 'code', notes: 'model' });
    expect(String(r.notes)).not.toContain(key);
    expect(validate(loadPhaseSchema('build', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });
});
