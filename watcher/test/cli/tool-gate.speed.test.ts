/**
 * @behavior The gate answers fast enough to sit in front of every agent tool call: its own
 *           decision well under 100 ms, and the whole hook (Node start-up included) well under
 *           a third of a second.
 * @business-rule DESIGN.md speed target: under 100 ms per call, tested with a generous margin.
 *           Under a loaded full-suite run a single slow call is noise, so the in-process check
 *           asserts the median of 20 calls under 100 ms and every call under 1 s (flakiness law).
 * @boundary runToolGate in-process, and `node dist/cli/tool-gate.cjs pre` as a subprocess.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BUNDLE = path.join(PLUGIN_ROOT, 'watcher', 'dist', 'cli', 'tool-gate.cjs');

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** A throwaway git repo on a feature branch with one empty commit. */
function makeRepo(): string {
  const repo = tempDir('oss-tool-gate-speed-');
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Tool Gate Test']);
  git(repo, ['config', 'user.email', 'tool-gate-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  git(repo, ['checkout', '-q', '-b', 'feat/speed']);
  return repo;
}

function preBash(repo: string, command: string): string {
  return JSON.stringify({
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

describe('tool-gate speed', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('should decide a Bash call in under 100 ms in-process (max of 20 calls)', async () => {
    const repo = makeRepo();
    const req = {
      mode: 'pre' as const,
      input: preBash(repo, 'git push origin feat/speed'),
      env: { HOME: process.env.HOME!, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    };
    const warmUp = await runToolGate(req);
    expect(warmUp.exitCode).toBe(0);

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const result = await runToolGate(req);
      times.push(performance.now() - start);
      expect(result.exitCode).toBe(0);
    }
    console.log(`tool-gate in-process: median ${median(times).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`);
    expect(median(times)).toBeLessThan(100);
    expect(Math.max(...times)).toBeLessThan(1000);
  }, 60000);

  it('should answer end-to-end through node tool-gate.cjs with a median under 300 ms over 10 spawns', () => {
    const repo = makeRepo();
    const home = tempDir('oss-tool-gate-speed-home-');
    const input = preBash(repo, 'git status');
    const env = { PATH: process.env.PATH, HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };

    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const result = spawnSync(process.execPath, [BUNDLE, 'pre'], {
        cwd: repo,
        env,
        input,
        encoding: 'utf8',
        timeout: 10000,
      });
      times.push(performance.now() - start);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('');
    }
    console.log(`tool-gate end-to-end: median ${median(times).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`);
    expect(median(times)).toBeLessThan(300);
  }, 60000);
});
