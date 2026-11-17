/**
 * @behavior A test's cleanup only ever deletes inside the test run's own temp HOME (test/setup.ts makes it,
 *   named oss-test-home-*). If HOME is the developer's real home (setup did not run, or ran in another
 *   order), cleanup deletes nothing and says why, so a failing setup can't wipe ~/dev or ~/.ssh.
 * @business-rule Tests never touch the developer's real files (R-266 round 18, SEC LOW-2).
 * @boundary removeInScratchHome (test/helpers/scratch-home.ts) on real scratch folders under os.tmpdir().
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeInScratchHome } from './scratch-home.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function folder(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'dev', 'repo'), { recursive: true });
  return dir;
}

describe('removeInScratchHome', () => {
  it('removes a folder inside the test run\'s temp HOME', () => {
    const home = folder('oss-test-home-');
    removeInScratchHome(home, 'dev');
    expect(fs.existsSync(path.join(home, 'dev'))).toBe(false);
  });

  it('refuses, and deletes nothing, when HOME is not the test run\'s temp HOME (a real home)', () => {
    const home = folder('not-a-test-home-');
    expect(() => removeInScratchHome(home, 'dev')).toThrow(/temp HOME/);
    expect(fs.existsSync(path.join(home, 'dev', 'repo'))).toBe(true);
  });

  it('refuses an empty HOME', () => {
    expect(() => removeInScratchHome('', 'dev')).toThrow(/temp HOME/);
  });

  it('refuses a path that climbs out of the temp HOME, and deletes nothing', () => {
    const home = folder('oss-test-home-');
    const outside = folder('outside-');
    expect(() => removeInScratchHome(home, '..', path.basename(outside))).toThrow(/inside/);
    expect(fs.existsSync(path.join(outside, 'dev', 'repo'))).toBe(true);
  });

  it('refuses to remove the temp HOME itself (setup.ts owns it)', () => {
    const home = folder('oss-test-home-');
    expect(() => removeInScratchHome(home)).toThrow(/inside/);
    expect(fs.existsSync(home)).toBe(true);
  });
});
