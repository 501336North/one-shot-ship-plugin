/**
 * @behavior The main agent and builders can't run an OSS hook script with a HOME, PATH or other variable they
 *   chose by hiding the `env NAME=value <hook>` prefix in a variable that the shell splits into words (`$c`,
 *   `${c}`, zsh's `$=c`, `${=c}`, `${(z)c}`, `${(s: :)c}`, an array), wherever the program word sits (after
 *   `command`, `exec`, `nohup`, `nice`, `timeout`, `time`, `caffeinate`, `xargs` or `env`), however the variable
 *   is set (`export`, `declare`, `local`, `readonly`, `typeset`, `read c <<<`), or by spelling the hook path or the
 *   variable name in pieces. A program word read from a file or through indirection (`$(cat f)`, `$(<f)`,
 *   `read c <f; $c`, `${!x}`) is refused too. A program kept in a variable with a plain value (`c=ls; $c -la`),
 *   other command output (`$(which node)`), an environment or loop variable, and a plain hook call stay allowed.
 * @business-rule gate-gaps-r3 Task 2 (R-266, MEDIUM security, finding #1): a hook call can't hide behind word
 *   splitting; owner re-pick Q1 "Narrow it, card the rest" (2026-11-19).
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hook-word-split-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
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
        session_id: 'hook-word-split',
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

/** A hook call with a changed HOME, as one string. */
const SPLIT = 'env HOME=/tmp/x $HOME/.oss/hooks/oss-log.sh';
const C = `c="${SPLIT}"; `;
const A = 'a=(env HOME=/x ~/.oss/hooks/oss-log.sh); ';

const REFUSED = [
  // the finding and its plain forms
  `${C}$c init build`,
  'c="$HOME/.oss/hooks/oss-log.sh"; HOME=/x $c',
  `${C}\${c} init build`,
  `${C}cd src && $c init build`,
  `${A}"\${a[@]}" init build`,
  'X="PATH=/x ~/.oss/hooks/oss-log.sh"; env $X',
  // zsh's split forms and unquoted arrays
  `${C}\${=c} init build`,
  `${C}$=c init build`,
  `${C}\${(z)c} init build`,
  `${C}\${(s: :)c} init build`,
  `${A}$a init build`,
  `${A}$a[@] init build`,
  `${A}\${a[*]} init build`,
  // each wrapper before the program word
  `${C}command $c init build`,
  `${C}exec $c init build`,
  `${C}nohup $c init build`,
  `${C}nice -n 5 $c init build`,
  `${C}timeout 5 $c init build`,
  `${C}time $c init build`,
  `${C}caffeinate $c init build`,
  `${C}echo init | xargs $c`,
  `${C}env $c init build`,
  // each way to set the variable
  `export ${C}$c init build`,
  `declare ${C}$c init build`,
  `local ${C}$c init build`,
  `readonly ${C}$c init build`,
  `typeset ${C}$c init build`,
  `read c <<< "${SPLIT}"; $c init build`,
  // a hook path or a variable name spelled in pieces
  'p=.oss/ho; q=oks; c="env HOME=/x $HOME/$p$q/oss-log.sh"; $c init build',
  'c="env "HO""ME"=/x $HOME/.oss/hooks/oss-log.sh"; $c init build',
  // the split done by another program
  "echo 'env HOME=/x ~/.oss/hooks/oss-log.sh init build' | xargs",
  "echo 'env HOME=/x ~/.oss/hooks/oss-log.sh init build' | sh",
  `${C}sh -c "$c init build"`,
  `${C}eval $c init build`,
  // Q1: a program word whose value the gate can't read
  'c=$(cat /tmp/f); $c init build',
  '$(cat /tmp/f) init build',
  '$(</tmp/f) init build',
  'read c </tmp/f; $c init build',
  'read c < /tmp/f; $c init build',
  '${!x} init build',
  // Q1 narrowed: a value with a piece the gate can't fill in, whose filled parts still form an `env NAME=` prefix
  'c="env HOME=/x $(pwd)/.oss/hooks/oss-log.sh"; $c init build',
];

const ALLOWED = [
  'c=ls; $c -la',
  '"$EDITOR" file',
  'cmd=npm; $cmd test',
  '~/.oss/hooks/oss-log.sh init build',
  'f="src/hooks/a.ts"; cat $f',
  // Q1 narrowed (owner re-pick 2026-11-19): other command output, environment and loop variables stay allowed
  '$(which node) -v',
  '`which node` -v',
  'NODE=$(command -v node); $NODE -v',
  '$EDITOR file',
  '$PWD/node_modules/.bin/vitest run',
  'd=$(pwd); $d/node_modules/.bin/tsc',
  "$SHELL -c 'echo hi'",
  'for f in a b; do $f; done',
  // the served build.md #8 shape: a dev command read from package.json, run split
  'DEV_CMD=$(node -e "console.log(1)"); $DEV_CMD & DEV_PID=$!; kill $DEV_PID',
  // text after `env` that sets nothing is not a hook-call variable
  'WHY="run env HOME tests" ~/.oss/hooks/oss-log.sh init build',
];

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it.each(REFUSED)('refuses a hook call hidden behind word splitting, or a program word it cannot read: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ALLOWED)('allows a program kept in a plain or quoted variable, and a plain hook call: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});
