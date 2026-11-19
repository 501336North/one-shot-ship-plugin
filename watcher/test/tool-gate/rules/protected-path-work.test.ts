/**
 * @behavior Checking the paths a long command names (`rm -f` of 1000 files, `git add` of 1500, `sed`
 *   with 1000 `-e`) takes work that grows slowly with the number of paths, so such a command is
 *   decided well inside the gate's time limit even on a loaded machine, instead of being refused as
 *   too complex to check in time.
 * @business-rule R-266 round 10, PERF MEDIUM-1: an everyday command must not be refused for its length.
 * @boundary runToolGate (gate.ts) for the main agent and a builder. Work is counted, not timed: the
 *   gate's clock is read once per 256 steps of work.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate } from '../../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let repo: string;

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r10-work-')));
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const files = (n: number): string => Array.from({ length: n }, (_, i) => `src/file${i}.txt`).join(' ');
const COMMANDS: Array<[string, string]> = [
  ['rm -f of 1000 files', `rm -f ${files(1000)}`],
  ['git add of 1500 files', `git add ${files(1500)}`],
  ['sed -i with 1000 -e', `sed -i ${Array.from({ length: 1000 }, (_, i) => `-e s/a${i}/b/`).join(' ')} src/a.txt`],
  // R-266 round 11, PERF LOW-1: after a cd known only as a pattern, each target was matched in full
  ['rm -f of 1000 files after cd sr*', `cd sr* && rm -f ${Array.from({ length: 1000 }, (_, i) => `file${i}.txt`).join(' ')}`],
  ['rm -f of 1000 files after a CDPATH cd', `CDPATH=/tmp cd src && rm -f ${Array.from({ length: 1000 }, (_, i) => `file${i}.txt`).join(' ')}`],
];

async function work(command: string, agent: string | null): Promise<{ exitCode: number; clockReads: number }> {
  let clockReads = 0;
  const result = await runToolGate(
      {
        mode: 'pre',
        input: JSON.stringify({ session_id: 'r10-work', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(agent === null ? {} : { agent_type: agent }) }),
        env: { HOME: process.env.HOME ?? '', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      },
      { clock: () => { clockReads++; return 0; } },
    );
  return { exitCode: result.exitCode, clockReads };
}

describe('the work to check a long command\'s paths', () => {
  for (const agent of [null, 'oss:typescript-pro']) {
    it.each(COMMANDS)(`stays small for %s (${agent ?? 'main agent'})`, async (_name, command) => {
      const { exitCode, clockReads } = await work(command, agent);
      expect(exitCode).toBe(0);
      // before round 10: about 24,000 clock reads (6 million steps); round 11 (CR LOW-C) counts only
      // the work, not how it is done (path.relative calls were an implementation detail)
      // work grows with the protected list; owner picked this bound on 2026-11-19 (gate-gaps-r3 Task 4)
      expect(clockReads).toBeLessThan(3000);
    });
  }
});
