/**
 * @behavior A command with many programs kept in variables (`c1=ls; $c1; c2=ls; $c2; …`) is checked by the
 *   hook-call rule with work that grows with the command, not with its square or cube: 50 such parts cost
 *   at most a few hundred looks at the gate's clock. A hook call hidden among them is still refused.
 * @business-rule gate-gaps-r3 ship round 1, S5 (owner pick "Fix perf + flaky"): hidden-program lines are
 *   scanned once per command, and the hook-variable check runs only when a hook path turns up.
 * @boundary runToolGate (the gate as the hook calls it) with a counting clock (GateDeps.clock): the gate looks
 *   at its clock once every 256 steps of work, so the count is a work count, not a time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Looks at the clock 50 hidden-program parts may take (5393 before the fix; 50 plain parts take 4). */
const MAX_CLOCK_READS = 200;

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hook-env-scan-once-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function counted(command: string): Promise<{ result: GateResult; reads: number }> {
  let reads = 0;
  const clock = (): number => {
    reads++;
    return performance.now();
  };
  const result = await runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({ session_id: 'hook-env-scan-once', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux', clock },
  );
  return { result, reads };
}

const hiddenParts = (n: number): string => Array.from({ length: n }, (_, i) => `c${i}=ls; $c${i}`).join('; ');

describe('the hook-call rule on many hidden programs (ship round 1, S5)', () => {
  it('checks 50 programs kept in variables with work that grows with the command', async () => {
    const { result, reads } = await counted(hiddenParts(50));
    expect(result.exitCode).toBe(0);
    expect(reads).toBeLessThanOrEqual(MAX_CLOCK_READS);
  });

  it('still refuses a hook call hidden among them', async () => {
    const { result } = await counted(`${hiddenParts(50)}; c=env; $c BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh`);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/OSS hook script/);
  });
});
