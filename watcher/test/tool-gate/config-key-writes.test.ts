/**
 * @behavior The main agent and builders can't write an OSS setting (any key in the `oss` section, in
 *   any case): not with `git config` in any write form (plain, `--add`, `--replace-all`, `--unset`,
 *   `--unset-all`, `--rename-section`, `--remove-section`, the `set` / `unset` / `rename-section` /
 *   `remove-section` subcommands, with `--file` / `--global` / `--system` / `--local` / `--worktree`),
 *   nor with `-c`, `--config-env`, `GIT_CONFIG_KEY_n` or `GIT_CONFIG_PARAMETERS`. Reading OSS settings
 *   stays allowed. And a key refused through `git -c` is refused through a `git config` write too
 *   (`protocol.allow` included), because both read one key list. Everyday `git config` writes stay allowed.
 * @business-rule gate-gaps-r3 Task 8 (R-266): owner picks "Refuse oss.* keys" (round 4: writes refused,
 *   reads allowed, everyday keys untouched) and Task 4's protocol.* pick "Fix in this PR" (one list for
 *   `-c` and `git config`). Refusal reasons are fixed text and don't echo values.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and a scratch repo, on
 *   darwin and linux.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { RUN_ANY_KEYS } from '../../src/tool-gate/rules/push-setup.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-config-key-writes-')));
const home = path.join(root, 'home');
const repo = path.join(root, 'repo');

beforeAll(() => {
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'config-key-writes',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform },
  );
}

const OSS_CONFIG_WRITES = [
  'git config oss.shipBase wip',
  'git config OSS.SHIPBASE x',
  'git config Oss.ShipBase x',
  'git config oss.feature.base x',
  'git config --add oss.shipBase x',
  'git config --replace-all oss.shipBase x',
  'git config --unset oss.shipBase',
  'git config --unset-all oss.shipBase',
  'git config --rename-section oss old',
  'git config --remove-section oss',
  'git config --rename-section old oss',
  'git config set oss.shipBase x',
  'git config unset oss.shipBase',
  'git config rename-section oss old',
  'git config remove-section OSS',
  'git config --file f oss.shipBase x',
  'git config -f f oss.shipBase x',
  'git config --global oss.shipBase x',
  'git config --system oss.shipBase x',
  'git config --local oss.shipBase x',
  'git config --worktree oss.shipBase x',
  'git config set --global oss.shipBase x',
  'git config --global --unset oss.shipBase',
];

const OSS_CARRIED = [
  'git -c oss.shipBase=wip status',
  'git -c OSS.shipBase=wip log',
  'git -c oss.shipBase status',
  'git --config-env=oss.shipBase=V status',
  'git --config-env oss.shipBase=V status',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=oss.shipBase GIT_CONFIG_VALUE_0=x git status',
  'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=OSS.shipBase GIT_CONFIG_VALUE_0=x; git log',
  `GIT_CONFIG_PARAMETERS="'oss.shipBase'='x'" git status`,
];

// Task 4's protocol.* pick: every key refused through `-c` is refused through `git config` too
const ONE_LIST_CONFIG_WRITES = [
  'git config protocol.allow always',
  'git config PROTOCOL.ALLOW always',
  'git config protocol.ext.allow always',
  'git config --global protocol.allow always',
  'git config set protocol.allow always',
  'git config --add protocol.ext.allow always',
  'git config --remove-section protocol',
];

/** One concrete key for each pattern of the run-any-keys list (`*` filled in). */
const RUN_ANY_EXAMPLES = RUN_ANY_KEYS.map((pattern) => pattern.replaceAll('*', 'x'));

const ALLOWED = [
  'git config user.email a@b.c',
  'git config user.name x',
  'git config pull.rebase true',
  'git config init.defaultBranch main',
  'git config core.autocrlf input',
  'git config --global user.email a@b.c',
  'git config --get oss.shipBase',
  'git config --get-all oss.shipBase',
  'git config --get-regexp oss',
  'git config --list',
  'git config -l',
  'git config get oss.shipBase',
  'git config list',
  'git config oss.shipBase',
  'git config --global --get oss.shipBase',
  'git config --get protocol.allow',
  'git -c user.email=a@b.c status',
  'git -c color.ui=never log',
  // the served /oss:ship step reads the remote's URL
  'o=$(command git config --get-all remote.origin.url) && echo "$o"',
];

describe.each(PLATFORMS)('config key writes (gate-gaps-r3 Task 8) on %s', (platform) => {
  describe.each(AGENTS)('%s', (_label, agent) => {
    async function refused(command: string): Promise<string> {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
      return result.stderr;
    }

    it.each(OSS_CONFIG_WRITES)('should refuse a git config write to an OSS setting: %s', async (command) => {
      expect(await refused(command), command).toMatch(/OSS setting/);
    });

    it.each(OSS_CARRIED)('should refuse an OSS setting carried by -c, --config-env or a GIT_CONFIG variable: %s', async (command) => {
      await refused(command);
    });

    it.each(ONE_LIST_CONFIG_WRITES)('should refuse a git config write of a key that -c is refused for: %s', async (command) => {
      await refused(command);
    });

    it.each(ALLOWED)('should still allow everyday config writes and every config read: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});

describe('config key writes (gate-gaps-r3 Task 8): one key list for -c and git config', () => {
  it.each(RUN_ANY_EXAMPLES)('should refuse a key through git config whenever -c is refused for it: %s', async (key) => {
    const carried = await call(`git -c ${key}=v status`, null, 'linux');
    expect(carried.exitCode, key).toBe(2);
    const written = await call(`git config ${key} v`, null, 'linux');
    expect(written.exitCode, key).toBe(2);
    expect(written.stderr, key).toMatch(/^Refused/);
  });

  it('should keep the OSS section on the list -c reads', () => {
    expect(RUN_ANY_KEYS).toContain('oss.*');
  });
});

describe('config key writes (gate-gaps-r3 Task 8): the refusal does not repeat the value it was given', () => {
  it.each([
    'git config oss.shipBase VALUE-8c1',
    'git config set --global oss.shipBase VALUE-8c1',
    'git -c oss.shipBase=VALUE-8c1 status',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=oss.shipBase GIT_CONFIG_VALUE_0=VALUE-8c1 git status',
    'git config protocol.allow VALUE-8c1',
    'git config --add protocol.ext.allow VALUE-8c1',
  ])('should refuse without echoing the value: %s', async (command) => {
    const result = await call(command, null, 'linux');
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).not.toContain('VALUE-8c1');
  });
});
