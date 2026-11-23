/**
 * @behavior The main agent and builders can't run an OSS hook script after setting a variable it reads
 *   (BASH_ENV, NODE_OPTIONS, GIT_DIR, TMPDIR …) with one of zsh's other binding builtins: `private` (its
 *   names, `-x` / `-gx` exports and `-n` namerefs), `vared`, `getln`, `zparseopts -A/-a <name>` and `getopts`
 *   with a written-out name, on their own, in a `zsh -c` script, or before a plugin-cache hook. The same
 *   builtins on a line that runs no hook stay allowed.
 * @business-rule gate-gaps-r3 ship round 1, S1 (HIGH, pen test finding 1): an exported `BASH_ENV` or
 *   `NODE_OPTIONS` runs the agent's code inside OSS's own hook; every way to set a variable counts.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo, on darwin (zsh) and linux (bash).
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

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hook-zsh-setters-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  // a plugin checkout: its `hooks/` scripts are OSS hooks
  fs.mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), '{"name":"oss"}\n');
  fs.mkdirSync(path.join(repo, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'hook-zsh-setters',
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

const H = '~/.oss/hooks/oss-log.sh';

const REFUSED = [
  // the pen test's exact probes
  `private -x BASH_ENV=/tmp/x; ${H}`,
  `private -x NODE_OPTIONS=--require=/tmp/x; ${H}`,
  `private -gx GIT_DIR=/tmp/x; ${H}`,
  `private -x GIT_DIR=/tmp/x; ${H}`,
  `private -x TMPDIR=/tmp/x; ${H}`,
  `private -x BASH_ENV=/tmp/x && ${H}`,
  `private -x BASH_ENV=/tmp/x\n${H}`,
  'private -x BASH_ENV=/tmp/x; ~/.claude/plugins/cache/oss/oss/0.9/hooks/oss-log.sh',
  `zsh -c 'private -x BASH_ENV=/tmp/x; ${H}'`,
  `vared TMPDIR; ${H}`,
  `zparseopts -A TMPDIR; ${H}`,
  `zparseopts -A BASH_ENV -D -- -x:; ${H}`,
  `zparseopts -a GIT_DIR; ${H}`,
  // a private name, nameref and written-out getopts name
  `private BASH_ENV; ${H}`,
  `private -n r=BASH_ENV; ${H}`,
  `getopts ab TMPDIR; ${H}`,
  // after fix round pick "Add getln to S1": `getln` binds a name from the buffer stack (`print -z` fills it)
  `getln TMPDIR; ${H}`,
  `getln TMPDIR < /dev/null; ${H}`,
  'getln BASH_ENV; ./hooks/oss-log.sh',
  // ship fix round 2, R2-3: a spec word's `=name` and an attached `-a<name>` / `-A<name>` set that name too
  `zparseopts -D p:=path; ${H}`,
  'zparseopts -D v:=BASH_ENV; ./hooks/oss-log.sh',
  'set -- -v /tmp/evil; zparseopts -D v:=path; ./hooks/oss-log.sh',
  'zparseopts v=PATH; ./hooks/oss-log.sh',
  `zparseopts -D v+:=BASH_ENV; ${H}`,
  `zparseopts -apath x; ${H}`,
  `zparseopts -ABASH_ENV x; ${H}`,
];

const ALLOWED = ['private -x FOO=bar', 'vared x', 'zparseopts -A opts -- -v', 'getln x', 'zparseopts -D -E v=verbose'];

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each(REFUSED)('refuses a hook call after a zsh builtin binds a variable it reads: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/OSS hook script/);
    });

    it.each(ALLOWED)('allows the same builtins on a line that runs no hook: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});
