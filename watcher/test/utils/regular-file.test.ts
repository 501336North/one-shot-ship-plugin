/**
 * The shared hang-safe reader (Task 70e)
 *
 * @behavior readRegularFileSync / readRegularFile read a file only when the open file is a regular file: it is
 *           opened non-blocking (a FIFO never blocks the open) and checked with fstat on that open file (so it
 *           cannot be swapped after the check). A FIFO, a device, a folder or a missing file throws ENOENT, so
 *           every caller treats it as missing; a link to a regular file is read. With an owner, a file someone
 *           else owns is refused the same way.
 * @business-rule The watcher runs on customers' Macs and reads files a user or a repo can write; a FIFO there
 *           must never hang it. Each read runs in a child process under a hard time limit.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

let work: string;
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-regular-file-'));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

/** Read `file` with both readers in a child; each gives { text } or { code } (the error code). */
function readBoth(file: string, owner?: number): { sync: unknown; async: unknown } {
  const run = runInChild(
    `
    import { readRegularFileSync, readRegularFile } from './utils/regular-file.js';
    const file = process.env.READ_FILE;
    const owner = process.env.READ_OWNER ? Number(process.env.READ_OWNER) : undefined;
    const as = (e) => ({ code: e.code });
    let sync;
    try { sync = { text: readRegularFileSync(file, owner) }; } catch (e) { sync = as(e); }
    let async;
    try { async = { text: await readRegularFile(file) }; } catch (e) { async = as(e); }
    console.log(JSON.stringify({ sync, async }));
    `,
    { home: work, env: { READ_FILE: file, ...(owner === undefined ? {} : { READ_OWNER: String(owner) }) } },
  );
  expect(run.hung, 'the read hung').toBe(false);
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { sync: unknown; async: unknown };
}

function newDir(): string {
  return fs.mkdtempSync(path.join(work, 'd-'));
}

describe('readRegularFileSync / readRegularFile (Task 70e)', () => {
  it.each([
    ['a FIFO', (dir: string) => {
      execFileSync('mkfifo', [path.join(dir, 'f')]);
      return path.join(dir, 'f');
    }],
    ['a link to a FIFO', (dir: string) => {
      execFileSync('mkfifo', [path.join(dir, 'fifo')]);
      fs.symlinkSync(path.join(dir, 'fifo'), path.join(dir, 'f'));
      return path.join(dir, 'f');
    }],
    ['a device', () => '/dev/null'],
    ['a folder', (dir: string) => dir],
    ['a missing file', (dir: string) => path.join(dir, 'none')],
  ])('treats %s as missing (ENOENT), without hanging', (_what, make) => {
    const file = make(newDir());

    expect(readBoth(file)).toEqual({ sync: { code: 'ENOENT' }, async: { code: 'ENOENT' } });
  }, TEST_LIMIT_MS);

  it('never opens a device, even through a link (Task 70e round 2): refused from a stat of the path', () => {
    const dir = newDir();
    fs.symlinkSync('/dev/null', path.join(dir, 'dev'));
    // an fs that records every open, so the test sees whether the device was opened at all
    const shim = path.join(dir, 'fs-shim.mjs');
    fs.writeFileSync(shim, `
      import * as real from 'node:fs';
      export * from 'node:fs';
      globalThis.opened = [];
      export function openSync(p, ...rest) { globalThis.opened.push(String(p)); return real.openSync(p, ...rest); }
      export const promises = { ...real.promises,
        open: (p, ...rest) => { globalThis.opened.push(String(p)); return real.promises.open(p, ...rest); } };
      export default { ...real, openSync, promises };
    `);
    const run = runInChild(
      `
      import { readRegularFileSync, readRegularFile } from './utils/regular-file.js';
      const codes = [];
      for (const f of ['/dev/null', process.env.HOME + '/dev']) {
        try { readRegularFileSync(f); codes.push('read'); } catch (e) { codes.push(e.code); }
        try { await readRegularFile(f); codes.push('read'); } catch (e) { codes.push(e.code); }
      }
      console.log(JSON.stringify({ codes, opened: globalThis.opened }));
      `,
      { home: dir, fsShim: shim },
    );

    expect(run.hung, 'the read hung').toBe(false);
    expect(JSON.parse(run.stdout || 'null'), run.stderr).toEqual({ codes: ['ENOENT', 'ENOENT', 'ENOENT', 'ENOENT'], opened: [] });
  }, TEST_LIMIT_MS);

  it('a FIFO swapped in after the stat of the path is refused on the open file, without hanging', () => {
    const dir = newDir();
    const at = path.join(dir, 'f');
    fs.writeFileSync(`${at}.file`, 'hello');
    execFileSync('mkfifo', [`${at}.fifo`]);
    fs.writeFileSync(at, 'hello');
    // an fs where each stat of the path sees a regular file and the path is a FIFO right after
    const shim = path.join(dir, 'fs-shim.mjs');
    fs.writeFileSync(shim, `
      import * as real from 'node:fs';
      export * from 'node:fs';
      const target = process.env.SWAP_TARGET;
      const put = (from) => { real.rmSync(target, { force: true }); real.linkSync(from, target); };
      export function statSync(p, ...rest) {
        if (p !== target) return real.statSync(p, ...rest);
        put(target + '.file');
        const st = real.statSync(p, ...rest);
        put(target + '.fifo');
        return st;
      }
      export const promises = { ...real.promises, stat: async (p, ...rest) => {
        if (p !== target) return real.promises.stat(p, ...rest);
        put(target + '.file');
        const st = await real.promises.stat(p, ...rest);
        put(target + '.fifo');
        return st;
      } };
      export default { ...real, statSync, promises };
    `);
    const run = runInChild(
      `
      import { readRegularFileSync, readRegularFile } from './utils/regular-file.js';
      const codes = [];
      try { readRegularFileSync(process.env.SWAP_TARGET); codes.push('read'); } catch (e) { codes.push(e.code); }
      try { await readRegularFile(process.env.SWAP_TARGET); codes.push('read'); } catch (e) { codes.push(e.code); }
      console.log(JSON.stringify(codes));
      `,
      { home: dir, fsShim: shim, env: { SWAP_TARGET: at } },
    );

    expect(run.hung, 'the read hung').toBe(false);
    expect(run.stdout.trim(), run.stderr).toBe(JSON.stringify(['ENOENT', 'ENOENT']));
  }, TEST_LIMIT_MS);

  it('reads a regular file, and a link to one', () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, 'real'), 'hello');
    fs.symlinkSync('real', path.join(dir, 'link'));

    expect(readBoth(path.join(dir, 'real'))).toEqual({ sync: { text: 'hello' }, async: { text: 'hello' } });
    expect(readBoth(path.join(dir, 'link'))).toEqual({ sync: { text: 'hello' }, async: { text: 'hello' } });
  }, TEST_LIMIT_MS);

  it('with an owner, reads the owner\'s file and refuses anyone else\'s', () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, 'mine'), 'hello');
    const uid = fs.statSync(path.join(dir, 'mine')).uid;

    expect(readBoth(path.join(dir, 'mine'), uid).sync).toEqual({ text: 'hello' });
    expect(readBoth(path.join(dir, 'mine'), uid + 1).sync).toEqual({ code: 'ENOENT' });
  }, TEST_LIMIT_MS);
});
