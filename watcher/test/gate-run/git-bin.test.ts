/**
 * @behavior The review check runs git from one fixed, checked place, never from PATH: on macOS the real
 *   developer git (xcode-select's folder, with a clean environment, so no agent-writable xcrun cache is
 *   used), on Linux /usr/bin/git or /bin/git. A program is only run when it and every link it goes
 *   through are owned by the user or root and none lies in a temp folder.
 * @business-rule A review agent can write temp folders and put programs on PATH; the check that judges it
 *   must not run anything it could have placed (security CRITICAL-1, INFO-1).
 * @boundary gitBinary / checkedProgram (watcher/src/gate-run/git-bin.ts), real files
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkedProgram, gitBinary } from '../../src/gate-run/git-bin.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-git-bin-')));
  tempDirs.push(dir);
  return dir;
}

describe('the git the review check runs (security CRITICAL-1)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('is an absolute, checked program outside any temp folder, whatever PATH says', () => {
    const git = gitBinary();

    expect(path.isAbsolute(git)).toBe(true);
    expect(checkedProgram(git)).toBe(true);
    expect(git).not.toMatch(/^(\/private)?\/(tmp|var\/folders)\//);
    if (process.platform === 'darwin') expect(git).not.toBe('/usr/bin/git');
  });

  it('refuses a program in a temp folder', () => {
    const file = path.join(tempDir(), 'git');
    fs.writeFileSync(file, '#!/bin/sh\n');
    fs.chmodSync(file, 0o755);

    expect(checkedProgram(file)).toBe(false);
  });

  it('refuses a link in a temp folder, even to a good program', () => {
    const link = path.join(tempDir(), 'git');
    fs.symlinkSync(gitBinary(), link);

    expect(checkedProgram(link)).toBe(false);
  });

  it('refuses a path that reaches a temp folder through ..', () => {
    expect(checkedProgram(`/usr/bin/../..${fs.realpathSync(os.tmpdir())}/nothing/git`)).toBe(false);
  });

  it('refuses a relative path, a folder and a missing file', () => {
    expect(checkedProgram('git')).toBe(false);
    expect(checkedProgram('/usr/bin')).toBe(false);
    expect(checkedProgram('/nonexistent/git')).toBe(false);
  });
});
