/**
 * @behavior The main agent and builders can't run an OSS hook script with a variable they chose by keeping only
 *   the program in a variable and writing the rest after it (`c=env; $c BASH_ENV=… <hook>`, `"$c"`, `"$@"` after
 *   `set --`), by hiding the call in a default (`${c:-env HOME=… <hook>}`), by splitting it across two variables
 *   (`$c $d`), or by keeping it where the gate can't read the value (an array element, a heredoc `read`,
 *   `mapfile` / `readarray`) on a line that names a hook path. A program kept in a variable with a plain value,
 *   a default with a plain program, and an unreadable value on a line with no hook path stay allowed.
 * @business-rule gate-gaps-r3 ship round 1, S2 (owner pick "Blunt fix in this PR"): a program word that is an
 *   expansion is judged as its value plus the rest of the part's words.
 * @boundary runToolGate (the gate as the hook calls it), in a scratch plugin checkout with a scratch home, on darwin and linux.
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hook-split-values-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
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
        session_id: 'hook-split-values',
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

const REFUSED = [
  // the program in a variable, the rest written after it
  'c=env; $c BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; "$c" BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'set -- env BASH_ENV=/tmp/x ./hooks/oss-log.sh; "$@"',
  'set -- env BASH_ENV=/tmp/x ./hooks/oss-log.sh; $*',
  // a default counts as the value
  '${c:-env HOME=/x ~/.oss/hooks/oss-log.sh} init',
  '${c:=env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh} init',
  '${c:-env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh} init',
  // split across two variables
  'c=env; d="HOME=/x $HOME/.oss/hooks/oss-log.sh"; $c $d init',
  'c=env; d="BASH_ENV=/x $HOME/.oss/hooks/oss-log.sh"; $c $d init',
  // a value the gate can't read, on a line that names a hook path
  'a[0]=env; a[1]=BASH_ENV=/x; a[2]=~/.oss/hooks/oss-log.sh; "${a[@]}" init',
  "read -r c <<'EOF'\nenv BASH_ENV=/x /h/.oss/hooks/oss-log.sh\nEOF\n$c init",
  'mapfile -t a <<< "env BASH_ENV=/x $HOME/.oss/hooks/oss-log.sh"; ${a[0]} init',
  'readarray -t a <<< "env BASH_ENV=/x $HOME/.oss/hooks/oss-log.sh"; ${a[0]} init',
];

/** Ship fix round 2, R2-4: any other `${…}` operator on the program word is unreadable, refused on a line naming a hook path. */
const OTHER_OPERATORS = [
  'c=1; HOME=/tmp/x ${c:+~/.oss/hooks/oss-log.sh}',
  'c=1; HOME=/tmp/x ${c:+~/.oss}/hooks/oss-log.sh',
  'c=env; ${c%%z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'x=1; ${x:+env} BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'c=env; ${c/q/} BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'c=env; ${c+env} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c%z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c#} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c##z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c//q/} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c:0} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c:?} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c^} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c,} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=ENV; ${(L)c} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  // ship fix round 3, R3-4: a default or a suffix removal followed by a rest is read, and judged as a path
  'HOME=/x "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/oss-log.sh"',
  'BASH_ENV=/tmp/x ${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh',
  'c=1; HOME=/tmp/x ${c:-~/.oss}/hooks/oss-log.sh',
  'c=~/.oss/; HOME=/tmp/x ${c%/}/hooks/oss-log.sh',
  'c=envz; ${c%z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=env; ${c%%*z} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  // ship fix round 4, R4-1 ("Exact served shapes only"): any other default or suffix form is unreadable again
  '${q%x}env BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=envz; x=z; ${c%$x} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=envz; ${c%"z"} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'c=envz; ${c%(z)} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  'd=env; ${c:-$d} BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c:-}$(echo env) BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${c-}/usr/bin/env BASH_ENV=/tmp/x ./hooks/oss-log.sh init',
  '${q%x}env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh init',
  'HOME=/x ${CLAUDE_PLUGIN_ROOT%/}/hooks/oss-log.sh',
  'BASH_ENV=/tmp/x "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/oss-log.sh"',
];

/** Already refused by the path-mention rule (`set` names a hook path): kept as guards. */
const REFUSED_ANY = ['set -- env BASH_ENV=/tmp/x ~/.oss/hooks/oss-log.sh; "$@"'];

const ALLOWED = [
  'c=ls; $c -la',
  'cmd=npm; $cmd test',
  '${EDITOR:-vi} notes.txt',
  'a[0]=ls; ${a[0]} -la',
  // R2-4: a default stays a readable value
  '"${CC:-cc}" -o x x.c',
  '${PAGER:-less} README.md',
  // a plain `${name}` is no operator: the plugin's own hook call stays allowed
  '"${CLAUDE_PLUGIN_ROOT}/hooks/oss-log.sh" init',
  '${CLAUDE_PLUGIN_ROOT}/hooks/oss-log.sh init',
  // R3-4 (owner pick "Allow it again"): the served plugin-root forms with a default or a trailing-slash trim
  '"${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/check-updates.sh"',
  '${CLAUDE_PLUGIN_ROOT%/}/hooks/check-updates.sh',
  '"${CLAUDE_PLUGIN_ROOT%/}/hooks/check-updates.sh"',
  '${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}/hooks/check-updates.sh',
];

/** Lines another rule may refuse; the hook-call rule must not. */
const NOT_HOOK = ['NODE_ENV=test node "$SCRIPT"'];

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each(REFUSED)('refuses a hook call whose program is a value split with the words after it: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/OSS hook script/);
    });

    it.each(OTHER_OPERATORS)('refuses a hook line whose program word uses an expansion operator the gate does not read: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(REFUSED_ANY)('refuses a hook call run through the positional parameters: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ALLOWED)('allows a program kept in a variable with a plain value: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });

    it.each(NOT_HOOK)('leaves a plain program with a variable operand to the other rules: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).not.toMatch(/OSS hook script/);
    });
  });
});
