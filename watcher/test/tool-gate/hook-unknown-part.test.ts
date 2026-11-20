/**
 * @behavior No agent can run an OSS hook script with a variable it chose by writing part of the hook path as an
 *   expansion the gate can't fill in: `~/.oss/${X+[[:}alpha${X+:]]}ooks/oss-log.sh`, `~/.oss/${X:-hooks}/oss-log.sh`,
 *   `~/.oss/h${X}oks/oss-log.sh` and the like could all be `~/.oss/hooks/oss-log.sh` when the command runs, so a call
 *   that also sets a variable is refused. Only paths under `~/.oss` or the plugin cache count: the same hook path with
 *   no variable set, and a script elsewhere (`./scripts/${NAME}.sh`) run with one, stay allowed.
 * @business-rule gate-gaps-r3 Task 12b (owner "Task 12b pick", security, "Fix in this PR"): in the hook-call rule, a
 *   path part the gate can't resolve counts as "could be anything", like a `*`.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo, on darwin and linux.
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
const HOOK_SCRIPT = /OSS hook script/;

let root: string;
let repo: string;
let home: string;

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'gate-gaps-r3-t12b',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent, agent_id: 'a1b2c3d4' }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform },
  );
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-t12b-unknown-part-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each([
      'BASH_ENV=/tmp/x ~/.oss/${X+[[:}alpha${X+:]]}ooks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.oss/${X:-hooks}/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.oss/${X-hooks}/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.oss/${X:+hooks}/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.oss/h${X}oks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.oss/$X/oss-log.sh',
      'BASH_ENV=/tmp/x bash ~/.oss/${X:-hooks}/oss-log.sh',
      'BASH_ENV=/tmp/x ~/.claude/plugins/cache/${M:-m/oss/1.0.0/hooks}/oss-log.sh',
      'cd "$D"; X=1 ${X+[[:}alpha${X+:]]}ooks/x.sh',
    ])('refuses a hook path with a part it can\'t fill in, run with a variable it chose: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(HOOK_SCRIPT);
    });

    it.each([
      '~/.oss/${X+[[:}alpha${X+:]]}ooks/oss-log.sh',
      'BASH_ENV=/tmp/x ./scripts/${NAME}.sh',
      'NODE_ENV=test node "$SCRIPT"',
      'X=1 bash "$DIR/$NAME"',
      '~/.oss/hooks/oss-log.sh init build',
    ])('leaves a call that sets no variable, or runs a path outside ~/.oss and the plugin, to the other rules: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).not.toMatch(HOOK_SCRIPT);
    });
  });
});
