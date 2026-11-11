/**
 * @behavior The tool gate finds where a path really lands on disk, following symlinks, also
 *   for a file that doesn't exist yet (the agent is about to create it). A symlink whose target
 *   doesn't exist yet resolves to that target, because writing through it creates the target.
 *   It never fails: a path it can't resolve comes back as given.
 * @business-rule US-006 edge case: a symlink into a protected path is resolved before matching,
 *   so a link can't hide a protected file from the gate.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realPathResolver } from '../../src/tool-gate/path-resolver.js';

const dirs: string[] = [];

/** A fresh temp dir, as given (on macOS it sits under /var, a symlink to /private/var). */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-path-resolver-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('real path resolver', () => {
  it('should follow a symlinked folder to an existing file', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real'));
    fs.writeFileSync(path.join(dir, 'real', 'a.json'), '{}');
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
    expect(realPathResolver.realpath(path.join(dir, 'link', 'a.json'))).toBe(
      path.join(fs.realpathSync(dir), 'real', 'a.json'),
    );
  });

  it('should follow a symlinked folder to a file that does not exist yet', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real'));
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
    expect(realPathResolver.realpath(path.join(dir, 'link', 'new', 'b.json'))).toBe(
      path.join(fs.realpathSync(dir), 'real', 'new', 'b.json'),
    );
  });

  it('should follow a symlink whose target does not exist yet to that target', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real'));
    fs.symlinkSync(path.join(dir, 'real', 'settings.json'), path.join(dir, 'dangling.json'));
    expect(realPathResolver.realpath(path.join(dir, 'dangling.json'))).toBe(
      path.join(fs.realpathSync(dir), 'real', 'settings.json'),
    );
  });

  it('should return the path as given for a symlink loop', () => {
    const dir = tempDir();
    fs.symlinkSync(path.join(dir, 'b'), path.join(dir, 'a'));
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'));
    const looped = path.join(dir, 'a', 'x.json');
    expect(realPathResolver.realpath(looped)).toBe(looped);
  });
});

describe('real path resolver: .. after a symlink', () => {
  // The disk resolves `link/..` as the parent of where `link` points, not of where it sits.
  it('should climb from where a symlinked folder points, to an existing file', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'real', 'a.json'), '{}');
    fs.symlinkSync(path.join(dir, 'real', 'inner'), path.join(dir, 'link'));
    expect(realPathResolver.realpath(`${dir}/link/../a.json`)).toBe(path.join(fs.realpathSync(dir), 'real', 'a.json'));
  });

  it('should climb from where a symlinked folder points, to a file that does not exist yet', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real', 'inner'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'real', 'inner'), path.join(dir, 'link'));
    expect(realPathResolver.realpath(`${dir}/link/../new.json`)).toBe(path.join(fs.realpathSync(dir), 'real', 'new.json'));
  });

  it('should climb a relative symlink the same way', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real', 'inner'), { recursive: true });
    fs.symlinkSync('real/inner', path.join(dir, 'link'));
    expect(realPathResolver.realpath(`${dir}/link/../b.json`)).toBe(path.join(fs.realpathSync(dir), 'real', 'b.json'));
  });

  it('should climb an ordinary folder as before, whether or not it exists', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'sub'));
    const real = fs.realpathSync(dir);
    expect(realPathResolver.realpath(`${dir}/sub/../a.json`)).toBe(path.join(real, 'a.json'));
    expect(realPathResolver.realpath(`${dir}/missing/../a.json`)).toBe(path.join(real, 'a.json'));
  });

  it('should still follow a symlink reached by climbing back out of a missing folder', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'real'));
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
    expect(realPathResolver.realpath(`${dir}/missing/deeper/../../link/a.json`)).toBe(path.join(fs.realpathSync(dir), 'real', 'a.json'));
  });

  it('should resolve a path 20000 folders deep that does not exist within 1 s', () => {
    const dir = tempDir();
    const deep = `${dir}/${'a/'.repeat(20_000)}x`;
    const started = performance.now();
    const resolved = realPathResolver.realpath(deep);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(resolved.endsWith(`${'a/'.repeat(3)}x`)).toBe(true);
  });
});
