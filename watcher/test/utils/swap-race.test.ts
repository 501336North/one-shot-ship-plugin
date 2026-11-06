/**
 * The two reads that were already guarded by a check of the path, now closed against a swap (Task 70e round 2)
 *
 * @behavior sessionProjectDir (lstat says: the user's own regular file) and the spec monitor's search of test files
 *           (readdir says: a regular file) read through the hang-safe reader, so a file swapped for a FIFO right
 *           after that check is handled as missing instead of blocking the read.
 * @business-rule A check of the path and a later read of it are two different files when a writer swaps them in
 *           between. Each case runs in a child process under a hard time limit, with an fs that does the swap.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

let work: string;
beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-swap-race-')));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

// An fs where SWAP_TARGET is a regular file for each lstat of it (and in each readdir of its folder) and a FIFO
// right after: the writer always wins the race between the check and the read.
const SHIM = `
  import * as real from 'node:fs';
  export * from 'node:fs';
  const target = process.env.SWAP_TARGET;
  const put = (from) => { real.rmSync(target, { force: true }); real.linkSync(from, target); };
  export function lstatSync(p, o) {
    if (globalThis.swapOn !== true || p !== target) return real.lstatSync(p, o);
    put(target + '.file');
    const st = real.lstatSync(p, o);
    put(target + '.fifo');
    return st;
  }
  export const promises = { ...real.promises, readdir: async (dir, o) => {
    if (globalThis.swapOn === true && dir === real.realpathSync(target + '/..')) put(target + '.file');
    const entries = await real.promises.readdir(dir, o);
    if (globalThis.swapOn === true && dir === real.realpathSync(target + '/..')) put(target + '.fifo');
    return entries;
  } };
  export default { ...real, lstatSync, promises };
`;

/** A home with SWAP_TARGET (relative) ready to swap between `text` and a FIFO; returns HOME and the shim. */
function swapHome(target: string, text: string): { home: string; shim: string; at: string } {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  const at = path.join(home, target);
  fs.mkdirSync(path.dirname(at), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${at}.file`, text);
  execFileSync('mkfifo', [`${at}.fifo`]);
  fs.writeFileSync(at, text);
  const shim = path.join(home, 'fs-shim.mjs');
  fs.writeFileSync(shim, SHIM);
  return { home, shim, at };
}

describe('reads guarded by a check of the path, swapped for a FIFO after it (Task 70e round 2)', () => {
  it('sessionProjectDir: the session pointer swapped for a FIFO is no project, without hanging', () => {
    const { home, shim, at } = swapHome('.oss/sessions/s1/project', '');
    fs.mkdirSync(path.join(home, 'proj', '.oss'), { recursive: true });
    fs.writeFileSync(`${at}.file`, `${path.join(home, 'proj')}\n`);
    fs.writeFileSync(at, `${path.join(home, 'proj')}\n`);
    const run = runInChild(
      `
      import { sessionProjectDir } from './utils/project-dir.js';
      const env = { HOME: process.env.HOME, CLAUDE_CODE_SESSION_ID: 's1' };
      const before = sessionProjectDir(env);
      globalThis.swapOn = true;
      console.log(JSON.stringify([before === null ? null : 'project', sessionProjectDir(env)]));
      `,
      { home, fsShim: shim, env: { SWAP_TARGET: at } },
    );

    expect(run.hung, 'the read hung').toBe(false);
    expect(run.stdout.trim(), run.stderr).toBe(JSON.stringify(['project', null]));
  }, TEST_LIMIT_MS);

  it('the spec monitor skips a test file swapped for a FIFO, as if it were not there, without hanging', () => {
    const { home, shim, at } = swapHome('proj/tests/a.test.ts', '// @criteria SC-001');
    const run = runInChild(
      `
      import { SpecMonitor } from './monitors/spec-monitor.js';
      const m = new SpecMonitor({}, { basePath: process.env.HOME + '/proj' });
      const spec = { feature: 'f', components: { marker: 'components', items: [], raw: '' },
        criteria: { marker: 'criteria', items: [{ id: 'SC-001', status: 'unchecked', description: 'd' }], raw: '' },
        behaviors: { marker: 'behaviors', items: [], raw: '' } };
      const covered = (await m.detectCriteriaDrift(spec, [process.env.HOME + '/proj/tests'])).length;
      globalThis.swapOn = true;
      const swapped = (await m.detectCriteriaDrift(spec, [process.env.HOME + '/proj/tests'])).length;
      console.log(JSON.stringify([covered, swapped]));
      `,
      { home, fsShim: shim, env: { SWAP_TARGET: at } },
    );

    expect(run.hung, 'the read hung').toBe(false);
    expect(run.stdout.trim(), run.stderr).toBe(JSON.stringify([0, 1]));
  }, TEST_LIMIT_MS);
});
