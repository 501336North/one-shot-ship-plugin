/**
 * Build result assembler (R-257 T4, AC-003.3, F4, D15).
 *
 * Reads this build's test runs from the R-253 recorder's `.oss/tool-gates/events.ndjson`. A test-run event carries
 * only its `ts`, so an event belongs to this build when its `ts` is at or after the build's `startedAt`. The log is
 * read backwards in 64 KB chunks and stops at the first event older than `startedAt`, or at an 8 MB cap; a capped
 * read gives an `unverified` result with `events_truncated`, never a wrong `no_red`.
 *
 * D42 (round 5, finding 1): the result stores its evidence cutoff, the assemble time, and only test runs at or before
 * it count, so a later run (ship's final tests) never makes a finished build look mismatched. A re-check passes the
 * stored cutoff; `null` re-checks a result written before the cutoff existed, with no cutoff (the old rule).
 */
import fs from 'node:fs';
import path from 'node:path';
import { baseFields, readValue, redactModelText, type AssembleContext, type AssembleOutcome } from './assemble-common.js';
import type { GateEvent, TestResult } from '../tool-gate/state-store.js';

const CHUNK = 64 * 1024;
const CAP = 8 * 1024 * 1024;

export type ReadChunk = (fd: number, buf: Buffer, offset: number, length: number, position: number) => number;

/** D42: undefined assembles now (cutoff = now); a string re-checks with that cutoff; null re-checks with none. */
export type BuildContext = AssembleContext & { evidenceCutoff?: string | null };

export interface AssembleBuildOptions {
  readChunk?: ReadChunk;
}

interface Scan {
  /** Test results of this build, newest first. */
  results: TestResult[];
  truncated: boolean;
}

/** Records a test result of this build; returns false at an event older than `start` (the scan stops). */
function take(line: string, start: number, cutoff: number, results: TestResult[]): boolean {
  let event: Partial<GateEvent>;
  try {
    event = JSON.parse(line) as Partial<GateEvent>;
  } catch {
    return true;
  }
  const ts = typeof event.ts === 'string' ? Date.parse(event.ts) : NaN;
  if (ts < start) return false;
  if (ts > cutoff) return true;
  if (event.kind === 'test-run' && (event.result === 'red' || event.result === 'green')) results.push(event.result);
  return true;
}

function scanBackwards(fd: number, size: number, start: number, cutoff: number, readChunk: ReadChunk): Scan {
  const results: TestResult[] = [];
  let position = size;
  let carry = Buffer.alloc(0);
  let read = 0;
  while (position > 0) {
    if (read >= CAP) return { results, truncated: true };
    const length = Math.min(CHUNK, position);
    position -= length;
    const chunk = Buffer.alloc(length);
    const n = readChunk(fd, chunk, 0, length, position);
    read += n;
    let buf = Buffer.concat([chunk.subarray(0, n), carry]);
    if (position > 0) {
      const nl = buf.indexOf(0x0a);
      if (nl === -1) {
        carry = buf;
        continue;
      }
      carry = buf.subarray(0, nl);
      buf = buf.subarray(nl + 1);
    }
    const lines = buf.toString('utf-8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] === '') continue;
      if (!take(lines[i], start, cutoff, results)) return { results, truncated: false };
    }
  }
  return { results, truncated: false };
}

export function assembleBuild(ctx: BuildContext, opts: AssembleBuildOptions = {}): AssembleOutcome {
  const cutoff = ctx.evidenceCutoff === undefined ? ctx.now().toISOString() : ctx.evidenceCutoff;
  for (const dir of [path.join(ctx.repo, '.oss'), path.join(ctx.repo, '.oss', 'tool-gates')]) {
    const st = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (st === undefined) return { ok: false, error: 'no_test_runs' };
    if (!st.isDirectory()) return { ok: false, error: 'unsafe_path' };
  }
  const file = path.join(ctx.repo, '.oss', 'tool-gates', 'events.ndjson');
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  let fd: number;
  try {
    fd = fs.openSync(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: 'no_test_runs' };
    return { ok: false, error: 'unsafe_path' };
  }
  let scan: Scan;
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, error: 'unsafe_path' };
    const end = cutoff === null ? Infinity : Date.parse(cutoff);
    scan = scanBackwards(fd, st.size, Date.parse(ctx.startedAt), end, opts.readChunk ?? fs.readSync);
  } finally {
    fs.closeSync(fd);
  }

  const { results, truncated } = scan;
  const sawRed = results.includes('red');
  const lastResult: TestResult = results[0] ?? 'red';
  if (!truncated) {
    if (results.length === 0) return { ok: false, error: 'no_test_runs' };
    if (lastResult === 'red') return { ok: false, error: 'not_green' };
    if (!sawRed) return { ok: false, error: 'no_red' };
  }

  const notes = readValue(ctx, 'notes.txt');
  const result: Record<string, unknown> = {
    ...baseFields(ctx, 'build'),
    sources: { testRuns: 'code', evidenceTrust: 'code', ...(notes === null ? {} : { notes: 'model' }) },
    testRuns: { sawRed, lastResult, count: results.length },
    evidenceTrust: 'repo-file',
    ...(cutoff === null ? {} : { evidenceCutoff: cutoff }),
    ...(notes === null ? {} : { notes: redactModelText(notes) }),
  };
  if (truncated) {
    result.verification = 'unverified';
    result.verificationError = { check: 'build-events', errorClass: 'events_truncated' };
  }
  return { ok: true, result };
}
