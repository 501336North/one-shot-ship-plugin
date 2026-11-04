/**
 * The log tail never opens a device, a FIFO or a folder at workflow.log (Task 80, security N4)
 *
 * @behavior While the watcher tails a project's .oss/workflow.log, something other than a regular file appearing
 *           there (a link to a device, a FIFO, a folder) is stat'ed and passed over: it is never opened, nothing is
 *           reported and the tail keeps running. A regular log appearing there is still read and reported.
 * @business-rule A repo can commit workflow.log as a link. The shared hang-safe reader's rule (utils/regular-file)
 *           is that a device is never opened: opening some devices has side effects (a serial port raises DTR).
 *           Each case runs in a child process under a hard time limit, with an fs that counts opens of the log.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

let work: string;
beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-log-tail-special-')));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

// An fs that counts, for TAIL_TARGET only, every open (`opened`) and every look at the path (`touched`).
const SHIM = `
  import * as real from 'node:fs';
  export * from 'node:fs';
  const target = process.env.TAIL_TARGET;
  globalThis.opened = 0;
  globalThis.touched = 0;
  const look = (p) => { if (p === target) globalThis.touched++; };
  const open = (p) => { if (p === target) globalThis.opened++; };
  export function openSync(p, ...a) { open(p); return real.openSync(p, ...a); }
  export function readFileSync(p, ...a) { open(p); return real.readFileSync(p, ...a); }
  export function existsSync(p) { look(p); return real.existsSync(p); }
  export function statSync(p, ...a) { look(p); return real.statSync(p, ...a); }
  export function lstatSync(p, ...a) { look(p); return real.lstatSync(p, ...a); }
  export const promises = { ...real.promises, open: async (p, ...a) => { open(p); return real.promises.open(p, ...a); } };
  export default { ...real, openSync, readFileSync, existsSync, statSync, lstatSync, promises };
`;

// The tail starts with no log, then PLACE makes what stands at the log. The case waits until the tail has looked at
// the path at least twice more (or, for a real log, has reported its entry), so a poll after the swap always ran.
const CODE = `
  import * as real from 'node:fs';
  import { execFileSync } from 'node:child_process';
  import { LogReader } from './logger/log-reader.js';
  const at = process.env.TAIL_TARGET;
  const r = new LogReader(process.env.HOME + '/.oss');
  const seen = [];
  r.startTailing((e) => seen.push(e.event));
  const place = {
    zero: () => real.symlinkSync('/dev/zero', at),
    null: () => real.symlinkSync('/dev/null', at),
    fifo: () => execFileSync('mkfifo', [at]),
    folder: () => real.mkdirSync(at),
    log: () => real.writeFileSync(at, JSON.stringify({ ts: 't', cmd: 'build', event: 'START', data: {} }) + '\\n'),
  };
  place[process.env.PLACE]();
  const from = globalThis.touched;
  const done = process.env.PLACE === 'log' ? () => seen.length > 0 : () => globalThis.touched >= from + 4;
  while (!done()) await new Promise((ok) => setTimeout(ok, 5));
  r.stopTailing();
  console.log(JSON.stringify({ opened: globalThis.opened, seen }));
`;

function tail(place: string): { opened: number; seen: string[] } {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  fs.mkdirSync(path.join(home, '.oss'));
  const shim = path.join(home, 'fs-shim.mjs');
  fs.writeFileSync(shim, SHIM);
  const run = runInChild(CODE, {
    home,
    fsShim: shim,
    env: { TAIL_TARGET: path.join(home, '.oss', 'workflow.log'), PLACE: place },
  });
  expect(run.hung, `${place}: the tail hung or never polled`).toBe(false);
  expect(run.status, `${place}: ${run.stderr}`).toBe(0);
  return JSON.parse(run.stdout.trim()) as { opened: number; seen: string[] };
}

describe('LogReader tail: only a regular workflow.log is ever opened (Task 80)', () => {
  it.each([
    ['a link to /dev/zero', 'zero'],
    ['a link to /dev/null', 'null'],
    ['a FIFO', 'fifo'],
    ['a folder', 'folder'],
  ])('%s at workflow.log is passed over without being opened', (_name, place) => {
    expect(tail(place)).toEqual({ opened: 0, seen: [] });
  }, TEST_LIMIT_MS);

  it('a regular workflow.log that appears is still read and its entry reported', () => {
    const result = tail('log');

    expect(result.seen).toEqual(['START']);
    expect(result.opened).toBeGreaterThan(0);
  }, TEST_LIMIT_MS);
});
