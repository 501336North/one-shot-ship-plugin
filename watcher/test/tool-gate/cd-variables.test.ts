/**
 * @behavior The main agent and builders can run commands that move into a folder through a variable
 *   the same command sets (`D=src; cd "$D"`, `top=$(git rev-parse --show-toplevel) && cd "$top"`, a
 *   `$(mktemp -d)` folder), and run read-only work (tests, linters) after a `cd` the gate can't follow.
 *   A real write that could land in a protected folder is still refused, wherever the shell went.
 * @business-rule R-266 round 11, D-R11-1 (user pick 2026-11-14): narrow ADR-029 to real writes, and
 *   follow a variable set earlier in the same command to a plain literal, the repo's top folder or a
 *   new temp folder; anything that could change it between the set and the use fails closed.
 * @boundary runToolGate (the gate as the hook calls it).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { resolveCallVariables } from '../../src/tool-gate/call-variables.js';
import { readCommand } from '../../src/tool-gate/command-reader.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
/** A scratch home: never the real ~/.claude or ~/.oss (round 12, CR L2). */
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r11-cdvar-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, '.oss', 'tool-gates'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'dir'), { recursive: true });
  // a repo rule file that also protects everything under `dir/`
  const base = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), 'utf8')) as { protectedPaths: string[] };
  fs.writeFileSync(path.join(repo, '.oss', 'tool-gates.json'), JSON.stringify({ version: 1, protectedPaths: [...base.protectedPaths, 'dir/**'] }));
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
        session_id: 'r11-cd-variables',
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
  // D-R11-1 item 1: after a cd the gate can't follow, read-only arguments are not writes
  it.each([
    'cd "$d" && npx vitest run test/a.test.ts',
    'cd "$d" && go test ./...',
    'cd "$d" && npx eslint src/app.ts',
    'cd "$d" && npx tsc --noEmit -p tsconfig.json',
    'cd "$d" && node scripts/check.js src/a.ts',
  ])('allows read-only work after an unknown cd: %s', (command) => allowed(command, agent));

  // the round-10 hole stays closed: a real write after an unknown cd
  it.each([
    'cd "$X" && mkdir -p build && echo x > build/out.js',
    'cd "$X" && echo x > out.js',
    'cd "$X" && touch out.js',
    'cd "$X" && curl -so out.json https://example.com/x',
    'cd "$X" && npx esbuild src/a.ts -o out.js',
    'cd "$X" && sort --output=out.txt in.txt',
    'cd "$X" && python3 -c "open(\'x.json\', \'w\')"',
  ])('refuses a real write after an unknown cd: %s', (command) => refused(command, agent));

  // D-R11-1 item 2: variables set in the same command are followed
  it.each([
    'D=src; cd "$D" && echo x > out.js',
    'D=src && cd "$D" && echo x > out.js',
    "D='src' && cd \"${D}\" && echo x > out.js",
    'D=src; cd $D && echo x > out.js',
    'top=$(git rev-parse --show-toplevel) && cd "$top" && echo x > src/out.js',
    'if top=$(git rev-parse --show-toplevel) && cd "$top" && test -d src; then echo x > src/out.js; fi',
    'top="$(git rev-parse --show-toplevel)"; cd "$top" && touch src/out.js',
    'export GIT_NO_REPLACE_OBJECTS=1 && top=$(git rev-parse --show-toplevel) && cd "$top" && echo x > src/out.js',
    'export GIT_NO_REPLACE_OBJECTS=1 && top=$(git rev-parse --show-toplevel) && cd "$top" && git commit -q -m x',
    'V="$HOME/.oss/run" && D=src && { find "$V" -name "*.txt" -mtime +7 -delete; cd "$D"; } && echo x > out.js',
  ])('follows a variable the command sets: %s', (command) => allowed(command, agent));

  // followed, so a protected folder is seen for what it is
  it.each([
    'D=.oss/tool-gates; cd "$D" && echo x > x.json',
    'D=dir; cd "$D" && echo x > out.js',
    'top=$(git rev-parse --show-toplevel) && cd "$top" && echo x > .oss/tool-gates.json',
  ])('refuses a protected write through a followed variable: %s', (command) => refused(command, agent));

  // fail closed: anything that could change the variable between the set and the use
  it.each([
    'D=src; D=dir; cd "$D" && echo x > out.js',
    'D=src; read D < /tmp/x; cd "$D" && echo x > out.js',
    'D=src; printf -v D %s dir; cd "$D" && echo x > out.js',
    'D=src; eval "D=dir"; cd "$D" && echo x > out.js',
    'D=src; declare D=dir; cd "$D" && echo x > out.js',
    'D=src; export D=dir; cd "$D" && echo x > out.js',
    'D=src; unset D; cd "$D" && echo x > out.js',
    'D=src; declare -n R=D; R=dir; cd "$D" && echo x > out.js',
    'D=src; mapfile D < /tmp/x; cd "$D" && echo x > out.js',
    'D=src; ((D=1)); cd "$D" && echo x > out.js',
    'D=src; getopts ab D; cd "$D" && echo x > out.js',
    'D=src; for D in dir; do :; done; cd "$D" && echo x > out.js',
    'D=src; select D in dir; do break; done; cd "$D" && echo x > out.js',
    'f() { D=dir; }; D=src; f; cd "$D" && echo x > out.js',
    'cd() { builtin cd dir; }; D=src; cd "$D" && echo x > out.js',
    'D=src; source /tmp/x.sh; cd "$D" && echo x > out.js',
    'D=src; . /tmp/x.sh; cd "$D" && echo x > out.js',
    '(D=src); cd "$D" && echo x > out.js',
    'D=src | cat; cd "$D" && echo x > out.js',
    'D=(src); cd "$D" && echo x > out.js',
    'D[0]=src; cd "$D" && echo x > out.js',
    'false && D=src; cd "$D" && echo x > out.js',
    'true || D=src && cd "$D" && echo x > out.js',
    'if false; then D=src; fi; cd "$D" && echo x > out.js',
    'D=src; v=$(printf D=dir); : $((v)); cd "$D" && echo x > out.js',
    'D=src; n=D; declare "$n=dir"; cd "$D" && echo x > out.js',
    'D=src; alias cd="builtin cd dir #"; cd "$D" && echo x > out.js',
    'D=src cd "$D" && echo x > out.js',
    'export GIT_DIR=/nowhere && top=$(git rev-parse --show-toplevel) && cd "$top" && echo x > out.js',
    'D=src && V=$(printf x) && { cd "$D"; } || cd "$V"; echo x > out.js',
  ])('fails closed when the variable could change: %s', (command) => refused(command, agent));

  // the CDPATH forms stay refused
  it.each([
    'CDPATH=dir cd src && echo x > out.js',
    'export CDPATH=.oss; cd tool-gates && echo x > x.json',
    'D=tool-gates; CDPATH=.oss; cd "$D" && echo x > x.json',
  ])('still refuses a cd through CDPATH: %s', (command) => refused(command, agent));

  // D-R11-1 item 3: a folder `mktemp -d` makes in the same command is a new temp folder
  it.each([
    'd=$(mktemp -d) && cd "$d" && echo x > out.js',
    'd="$(mktemp -d -t oss-x)" && cd "$d" && mkdir -p build && echo x > build/out.js',
  ])('follows a new temp folder: %s', (command) => allowed(command, agent));

  it.each([
    'TMPDIR=dir; d=$(mktemp -d) && cd "$d" && echo x > out.js',
    'd=$(mktemp -d -p dir) && cd "$d" && echo x > out.js',
    'd=$(mktemp -d dir/x.XXXXXX) && cd "$d" && echo x > out.js',
  ])('does not take a mktemp folder it cannot place as temp: %s', (command) => refused(command, agent));
});

// round 11 hardening: the gate tells the reader not to follow a review agent's variables; it does not
// rest on the fill-in never running for one
describe('a review agent', () => {
  it.each(['D=.oss; cd "$D" && cat x', 'D=src; cd "$D" && cat x'])('is never followed, even right after the fill-in ran on the same text: %s', async (command) => {
    resolveCallVariables(command, home, null);

    await refused(command, 'oss:code-reviewer');
  });
});

// round 12, CR L4: the reader follows a command's variables only when its caller says so
describe('the command reader', () => {
  it('never follows by default, even right after the fill-in ran on the same text', () => {
    const command = 'D=src; cd "$D" && cat x';
    const filled = resolveCallVariables(command, home, null);
    const facts = readCommand(filled, repo, home);
    const cat = facts.parts.find((part) => part.name === 'cat');
    expect(cat?.lostDir).not.toBeNull();
  });

  it('follows when its caller says so', () => {
    const facts = readCommand('D=src; cd "$D" && cat x', repo, home, false, undefined, undefined, undefined, true);
    const cat = facts.parts.find((part) => part.name === 'cat');
    expect(cat?.lostDir).toBeNull();
    expect(cat?.cwd).toBe(path.join(repo, 'src'));
  });
});
