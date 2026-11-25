/**
 * @behavior The gate decides a command whose path holds a glob with many stars in a few milliseconds of CPU
 *   time, however many stars it has: `~/.oss/` + 25 or 100 adjacent `*` + `z/x.sh` is read as quickly as a plain
 *   path (it took about 220 ms per path part with 25 stars, and 100 stars never finished). Hook folders written
 *   as a glob are read the way the shell expands them, in any case: `[[:alpha:]]ooks` can be `hooks`, so a hook
 *   run with a variable it chose is refused. Any set counts as any one character (ship fix round 14, R14-1, as on
 *   the Sprint D base), so `[x]ooks` and `[!h]ooks` are read as a hooks folder too.
 * @business-rule gate-gaps-r3 Task 12 (R-257 gate round 5 pick "Glob stall, fix in this PR"; Task 12 picks:
 *   reuse R-257's linear matcher, read sets as the shell does, case stays insensitive).
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo, timed on CPU time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];
/** CPU budget for one whole gate decision: a plain call takes 1-6 ms; 25 adjacent stars took about 220 ms before. */
const CPU_BUDGET_MS = 20;
const HOOK_SCRIPT = /OSS hook script/;

let root: string;
let repo: string;
let home: string;

/** This process's CPU time in milliseconds: the bound counts work, not machine load or sleep. */
function cpuMs(): number {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'gate-gaps-r3-t12',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent, agent_id: 'a1b2c3d4' }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform, clock: cpuMs },
  );
}

/** The decision and the CPU time it took. */
async function timed(command: string, agent: string | null, platform: NodeJS.Platform): Promise<{ result: GateResult; ms: number }> {
  const start = cpuMs();
  const result = await call(command, agent, platform);
  return { result, ms: cpuMs() - start };
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-t12-hook-glob-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  // warm the gate's modules once, so the first timed row doesn't pay for loading them
  for (const platform of PLATFORMS) await call('BASH_ENV=/tmp/x ~/.oss/h*/x.sh', null, platform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const stars = (n: number): string => '*'.repeat(n);

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each([
      ['25 adjacent stars under ~/.oss', `BASH_ENV=/tmp/x ~/.oss/${stars(25)}z/x.sh`],
      ['25 adjacent stars in a folder known only at run time', `cd "$D"; X=1 ${stars(25)}z/x.sh`],
      ['100 adjacent stars under ~/.oss', `BASH_ENV=/tmp/x ~/.oss/${stars(100)}z/x.sh`],
      ['100 adjacent stars in a folder known only at run time', `cd "$D"; X=1 ${stars(100)}z/x.sh`],
    ])('decides a path with %s within the CPU budget, and it is not a hook path', async (_label, command) => {
      const { result, ms } = await timed(command, agent, platform);
      expect(ms, command).toBeLessThan(CPU_BUDGET_MS);
      expect(result.exitCode, command).toBe(0);
      expect(result.stderr, command).not.toMatch(HOOK_SCRIPT);
    });

    it.each([
      'BASH_ENV=/tmp/x ~/.oss/[[:alpha:]]ooks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.oss/[[:LOWER:]]OOKS/oss-log.sh',
      'cd "$D"; X=1 [[:alpha:]]ooks/x.sh',
    ])('refuses a hook folder written with a character class, run with a variable it chose: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(HOOK_SCRIPT);
    });

    it.each([
      'BASH_ENV=/tmp/x ~/.oss/[x]ooks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.oss/[!h]ooks/oss-log.sh',
      'cd "$D"; X=1 [x]ooks/x.sh',
      'cd "$D"; X=1 [!h]ooks/x.sh',
    ])('reads any set as possibly the hooks folder, as the base did (R14-1): %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(HOOK_SCRIPT);
    });

    // a class form split over two expansions: the gate can't read it, so it stays refused (round 8 word bound)
    it('refuses a class form split over two expansions in a folder known only at run time', async () => {
      const command = 'cd "$D"; X=1 ${X+[[:}alpha${X+:]]}ooks/x.sh';
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(HOOK_SCRIPT);
    });

    it.each(['BASH_ENV=/tmp/x ~/.oss/[h]OOKS/oss-log.sh', 'BASH_ENV=/tmp/x ~/.oss/[!x]ooks/oss-log.sh'])(
      'still reads a set that can be `h` as the hooks folder, in any case: %s',
      async (command) => {
        const result = await call(command, agent, platform);
        expect(result.exitCode, command).toBe(2);
        expect(result.stderr, command).toMatch(HOOK_SCRIPT);
      },
    );
  });
});
