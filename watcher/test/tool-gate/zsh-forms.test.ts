/**
 * @behavior The main agent's and builders' Bash calls run in zsh on macOS, where `$X:h` is X's folder,
 *   `$X[…]` a slice of X, `$~X` / `$=X` / `$^X` / `$+X` X read another way, and `$dirstack[1]` a folder
 *   the shell keeps. A write target, or a `cd` target, written with one of these forms (or with
 *   `${X:…}` / `${X[…]}` in either shell) is a path the gate can't know: a write through it is refused
 *   whatever text follows, and a `cd` through it leaves the folder unknown. A target that is exactly
 *   one variable with a subscript (`"$X[1,-1]"`) is a bare variable, the accepted limit of ADR-036.
 * @business-rule R-266 round 13, CR H-1 (HIGH): `X=.oss/x; echo x > "$X:h/tool-gates.json"` wrote a
 *   protected file under zsh while the gate read a harmless `x:h` folder.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home.
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
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r13-zsh-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
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
        session_id: 'r13-zsh-forms',
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

async function allowed(command: string, agent: string | null): Promise<void> {
  const result = await call(command, agent);
  expect(result.stderr, command).toBe('');
  expect(result.exitCode, command).toBe(0);
}

async function refused(command: string, agent: string | null): Promise<void> {
  const result = await call(command, agent);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
}

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    // the brief's cases
    'X=$(echo .oss/x); echo x > "$X:h/tool-gates.json"',
    'pushd .oss; pushd ..; echo x > "$dirstack[1]/tool-gates.json"',
    'X=.oss/x; echo x > "$X:h/tool-gates.json"',
    'echo x > "${X:h}/tool-gates.json"',
    // a value the gate fills in before reading (`NAME="value"`) is not filled in before a modifier
    'X=".oss/x"; echo x > "$X:h/tool-gates.json"',
    // no text after a modifier is a known tail: X's folder could be anything
    'X=$(cat /tmp/x); echo x > "$X:h/notes.txt"',
    'X=$(cat /tmp/x); echo x > $X:h/notes.txt',
    'echo x > "${X:h}/notes.txt"',
    'echo x > "${X[1]}/notes.txt"',
    'X=$(cat /tmp/x); echo x > "$X[1]/notes.txt"',
    'X=$(cat /tmp/x); echo x > "$X:s/a/b/"',
    'X=$(cat /tmp/x); cp /tmp/y "$X:h/notes.txt"',
    // the home folder's parent, read as a literal `home:h` folder
    'echo x > "$HOME:h/home/.claude/settings.json"',
    'Y="$HOME:h/home"; cd "$Y" && echo x > .claude/settings.json',
    // zsh's other ways to read a variable: `$~X` globs, `$=X` splits, `$^X` distributes, `$+X` tests
    'X=.oss; echo x > $~X/tool-gates.json',
    'X=.oss; echo x > "$=X/tool-gates.json"',
    'X=.oss; echo x > "$^X/tool-gates.json"',
    // shell-maintained arrays, bare or not
    'pushd .oss; pushd ..; echo x > "$dirstack[1]"',
    'echo x > "$path[1]/x"',
    // a `cd` through a modifier leaves the folder unknown
    'cd "$HOME:h/home" && echo x > .claude/settings.json',
    'cd "$PWD:h" && echo x > repo/.oss/tool-gates.json',
  ])('refuses a write through a zsh modifier or subscript: %s', (command) => refused(command, agent));

  it.each([
    'F=src/out.txt; echo x > "$F"',
    'echo x > "${X}/notes.txt"',
    'X=$(cat /tmp/x); echo "$X:h" > src/out.txt',
  ])('still allows: %s', (command) => allowed(command, agent));

  // accepted limit (ADR-036): exactly one variable with a subscript is a bare variable
  it('allows a bare subscripted variable as a write target (accepted limit)', () => allowed('X=$(echo .git/config); echo x > "$X[1,-1]"', agent));
});
