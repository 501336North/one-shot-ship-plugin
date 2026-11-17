/**
 * @behavior Round 16 (part A), CR I-2: the mount table read inside a review call's decision (taken
 *   when the review agents' list only says "review agent" once the decision has started, e.g. a repo's
 *   .oss/tool-gates.json that changed mid-call) is timed on the same clock as the rest of the call, so
 *   a read past its 1.2 s cap counts as unreadable there too and voids the run.
 * @business-rule R-266: a review whose code may have been swapped, or that can't be checked, is void.
 * @boundary runToolGate (gate.ts) with a review-agent hook input; the mount table (an OS boundary) and
 *   the clock are swapped through the `mounts` and `clock` seams. HOME is the test run's temp home.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateRequest } from '../../../src/tool-gate/gate.js';
import { removeInScratchHome } from '../../helpers/scratch-home.js';
import type { MountEntry } from '../../../src/tool-gate/mounts.js';
import { hasMark } from '../../../src/gate-run/run-store.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const AGENT = 'oss:r16-repo-reviewer';
const SESSION = `r16a-${process.pid}`;
let root: string;
let userTemp: string;

function request(repo: string, agentId: string): GateRequest {
  return {
    mode: 'post',
    input: JSON.stringify({
      session_id: SESSION,
      cwd: repo,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { stdout: '' },
      agent_type: AGENT,
      agent_id: agentId,
    }),
    env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
    hookEnv: { PATH: '/usr/bin:/bin', HOME },
    bundleRoot: PLUGIN_ROOT,
  };
}

beforeAll(() => {
  if (!path.basename(HOME).startsWith('oss-test-home-')) throw new Error("expected the test run's temp HOME");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r16a-')));
  userTemp = path.join(root, 'T');
  fs.mkdirSync(userTemp, { mode: 0o700 });
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  // Only ever inside the test run's temp HOME: if setup failed and HOME is the real home, this throws and deletes nothing.
  removeInScratchHome(HOME, 'dev');
  removeInScratchHome(HOME, '.oss');
});

describe('CR I-2: the in-decision mount table read uses the call clock', () => {
  it('a re-read past its cap, by the call clock, voids the run', async () => {
    const repo = path.join(HOME, 'dev', 'r16-clock');
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    const base = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), 'utf8')) as { gateAgents: string[] };
    expect(base.gateAgents).not.toContain('r16-repo-reviewer');
    let now = 0;
    let first = true;
    // the repo's list gains the agent once the decision has started (its first look at the clock)
    const clock = (): number => {
      if (first) {
        first = false;
        fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.oss', 'tool-gates.json'), JSON.stringify({ version: 1, gateAgents: [...base.gateAgents, 'r16-repo-reviewer'] }));
      }
      return now;
    };
    const slow = (): MountEntry[] => {
      now += 1300;
      return [{ device: 'disk1', at: '/' }];
    };
    const result = await runToolGate(request(fs.realpathSync(repo), 'agent-r16-clock'), { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] }, mounts: slow, clock });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("couldn't read the mount table after your call");
    expect(hasMark(HOME, SESSION, 'agent-r16-clock', 'tamper')).toBe(true);
  });
});
