/**
 * @behavior No agent can run an OSS hook script with a variable it chose by writing the `.oss` or `.claude` folder
 *   itself as an expansion the gate can't fill in: `~/${X}/hooks/oss-log.sh`, `~/${X:-.oss}/hooks/oss-log.sh`,
 *   `$HOME/${X}/hooks/oss-log.sh`, `~/${X}/plugins/cache/…/hooks/oss-log.sh` and `~/${X}` could all be a hook under
 *   `~/.oss` or the plugin cache when the command runs, so a call that also sets a variable is refused. The same path
 *   with no variable set, and paths under `~` whose known parts rule out a hook (`~/${X}/bin/tool`,
 *   `~/projects/${APP}/server.js`, `~/scripts/${NAME}.sh`), stay allowed.
 * @business-rule gate-gaps-r3 Task 12c (owner "Task 12c pick", security, "Fix in this PR"): in the hook-call rule, a
 *   part the gate can't fill in may also be a dot folder, and any path under `~` with such a part is checked.
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
        session_id: 'gate-gaps-r3-t12c',
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-t12c-unknown-dot-')));
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
      'BASH_ENV=/tmp/x ~/${X}/hooks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/${X:-.oss}/hooks/oss-log.sh',
      'BASH_ENV=/tmp/x $HOME/${X}/hooks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/${X}/plugins/cache/m/oss/1.0.0/hooks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/${X}',
    ])('refuses a hook path whose dot folder it can\'t fill in, run with a variable it chose: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(HOOK_SCRIPT);
    });

    it.each([
      '~/${X}/hooks/oss-log.sh',
      'BASH_ENV=/tmp/x ~/${X}/bin/tool',
      'NODE_ENV=test node ~/projects/${APP}/server.js',
      'X=1 bash ~/scripts/${NAME}.sh',
      '~/.oss/hooks/oss-log.sh init build',
    ])('leaves a call that sets no variable, or a path under ~ that can\'t be a hook, to the other rules: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).not.toMatch(HOOK_SCRIPT);
    });
  });
});
