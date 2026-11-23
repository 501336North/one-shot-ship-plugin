/**
 * @behavior In a repo whose ignore rules already cover the OSS state lines, the gate asks git
 *   (`git check-ignore`) once per process, not on every state write: a second write in the same repo
 *   starts no git process. Nothing is added to `info/exclude` either time.
 * @business-rule gate-gaps-r3 ship round 1, S5 (owner pick "Fix perf + flaky"): the local exclude step
 *   must not slow every gate call in repos that ignore `.oss/` already.
 * @boundary excludeOssState with real scratch repos; git's process start is counted at node:child_process.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const checkIgnoreRuns = vi.hoisted(() => ({ count: 0 }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const spawnSync = ((command: string, args?: readonly string[], options?: object) => {
    if (args?.includes('check-ignore')) checkIgnoreRuns.count++;
    return real.spawnSync(command, args ?? [], options ?? {});
  }) as typeof real.spawnSync;
  return { ...real, default: { ...real, spawnSync }, spawnSync };
});

const { execFileSync } = await import('node:child_process');
const { excludeOssState } = await import('../../src/tool-gate/local-exclude.js');

let root: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-state-exclude-once-')));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('the local exclude step in a repo that already ignores the OSS state (ship round 1, S5)', () => {
  it('asks git once, so a second state write starts no check-ignore', () => {
    const repo = path.join(root, 'ignored');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
    fs.writeFileSync(path.join(repo, '.gitignore'), '.oss/\n');
    const exclude = path.join(repo, '.git', 'info', 'exclude');
    const before = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';

    excludeOssState(repo);
    const first = checkIgnoreRuns.count;
    excludeOssState(repo);

    expect(first).toBe(1);
    expect(checkIgnoreRuns.count).toBe(1);
    expect(fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '').toBe(before);
  });
});
