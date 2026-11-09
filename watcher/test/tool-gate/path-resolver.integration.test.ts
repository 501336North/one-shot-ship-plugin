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
