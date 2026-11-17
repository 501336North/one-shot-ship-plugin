/**
 * @behavior A command can't hide where it writes from the gate: after `eval`, an alias, a function
 *   that moves the shell, a reassigned HOME, or a `cd` inside a piped group (which the shell runs
 *   apart, or in zsh in the current shell), the folder is unknown; a write target built by a command
 *   substitution is an unknown path. Either way a write that could land on a protected file is
 *   refused, for the main agent and builders. Plain commands stay allowed.
 * @business-rule R-266 round 11, SEC MEDIUM-1 (more ways to move cwd or hide a write target).
 * @boundary runToolGate (the gate as the hook calls it).
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

let root: string;
let repo: string;
/** A scratch home: never the real ~/.claude or ~/.oss (round 12, CR L2). */
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r11-movers-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, '.oss', 'tool-gates'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r11-movers',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux' },
  );
}

describe.each(AGENTS)('%s', (_who, agent) => {
  // each one lands in `.oss/tool-gates` when it runs and writes `.oss/tool-gates/x.json`
  it.each([
    "eval 'cd .oss/tool-gates'; echo x > x.json",
    'eval "cd .oss/tool-gates" && echo x > x.json',
    "cd /tmp && eval 'cd -' && echo x > .oss/tool-gates/x.json",
    "shopt -s expand_aliases\nalias go='cd .oss/tool-gates'\ngo; echo x > x.json",
    "alias go='cd .oss/tool-gates'\ngo\necho x > x.json",
    'f() { cd .oss/tool-gates; }; f; echo x > x.json',
    'function f { cd .oss/tool-gates; }; cd /tmp; f; echo x > x.json',
    'HOME=.oss; cd; echo x > tool-gates/x.json',
    'export HOME=.oss/tool-gates && cd ~ && echo x > x.json',
    // a cd in a group the shell runs apart: the gate must not think it moved
    '{ cd /tmp; } | cat; echo x > .oss/tool-gates/x.json',
    'while :; do cd /tmp; break; done | cat; echo x > .oss/tool-gates/x.json',
    'if cd /tmp; then :; fi | cat; echo x > .oss/tool-gates/x.json',
    '{ cd /tmp; } & echo x > .oss/tool-gates/x.json',
    // zsh runs the last element of a pipeline in the current shell
    'true | cd .oss/tool-gates && echo x > x.json',
    'true | { cd .oss/tool-gates; } ; echo x > x.json',
    // a write target built by a command substitution
    // round 12, D-R12-1: what follows the substitution must be able to end a protected path
    'echo x > "$(printf .oss)/tool-gates.json"',
    'echo x > "`printf .oss`/tool-gates.json"',
    'touch "$(printf .git)/config"',
    'echo x > "$(printf .oss/tool-gates/x.json)"',
    'cp "$Y" "$(printf .oss/tool-gates/x.json)"',
    'rm -f "$i" "$(printf .oss/tool-gates.json)"',
    'dd if=/dev/zero of="$(printf .oss/tool-gates.json)" count=1',
  ])('refuses %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused/);
  });

  it.each([
    'eval "echo hi"',
    'f() { echo hi; }; f; echo x > src/out.js',
    '{ cd src; } && echo x > out.js',
    'cd src | cat; echo x > src/out.js',
    'echo x > "$(mktemp)"',
    'echo x > "$(git rev-parse --show-toplevel)/src/out.js"',
    'git log --oneline | head -5 > "$TMPDIR/log.txt"',
    'i=$(mktemp) && cp "$(git rev-parse --git-path index)" "$i"',
  ])('allows %s', async (command) => {
    const result = await call(command, agent);
    expect(result.stderr, command).toBe('');
    expect(result.exitCode, command).toBe(0);
  });
});
