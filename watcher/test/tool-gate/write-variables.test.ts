/**
 * @behavior The main agent and builders may write through a variable only where the gate can tell
 *   the write can't land on a protected path: a variable the same command sets to a plain value, the
 *   repo's top folder or a new temp file or folder is followed (when only harmless commands stand
 *   between the set and the use), one the command doesn't set is read from the environment the gate
 *   sees, and any other variable is unknown. A write whose path holds an unknown part is refused when
 *   what follows that part could end a protected path, or when nothing follows it.
 * @business-rule R-266 round 12, D-R12-1 "Follow or refuse" (user pick 2026-11-15): pen-test CRITICAL-1
 *   (`A=.git; echo x > "$A/config"`), CR M3 (`D=$(echo .oss) && echo x > "$D/tool-gates.json"`),
 *   SEC HIGH-A and CR H1.
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r12-writevar-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, extraEnv: Record<string, string> = {}): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r12-write-variables',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home, ...extraEnv },
    },
    { platform: 'linux' },
  );
}

async function allowed(command: string, agent: string | null, env: Record<string, string> = {}): Promise<void> {
  const result = await call(command, agent, env);
  expect(result.stderr, command).toBe('');
  expect(result.exitCode, command).toBe(0);
}

async function refused(command: string, agent: string | null, env: Record<string, string> = {}): Promise<void> {
  const result = await call(command, agent, env);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
}

/** Variables the shell maintains itself: never followed, never read from the environment (D-R12-1 item 2). */
const SHELL_MAINTAINED = [
  '_', 'DIRSTACK', 'dirstack', 'PIPESTATUS', 'pipestatus', 'OLDPWD', 'PWD', 'HISTCMD', 'ERRNO', 'COLUMNS', 'LINES', 'SHLVL',
  'GROUPS', 'FUNCNAME', 'EPOCHSECONDS', 'EPOCHREALTIME', 'SRANDOM', 'RANDOM', 'COMP_WORDS', 'COMP_LINE', 'ZSH_VERSION',
  'ZSH_SUBSHELL', 'MBEGIN', 'MEND', 'mbegin', 'mend', 'TRY_BLOCK_ERROR', 'TRY_BLOCK_INTERRUPT', 'path', 'fpath', 'psvar',
  'cdpath', 'CDPATH', 'REPLY',
];

describe.each(AGENTS)('%s', (_who, agent) => {
  // pen-test CRITICAL-1 and CR M3: a write through a variable to a protected file
  it.each([
    'A=.git; echo x > "$A/config"',
    'A=.git; echo x > "${A}/config"',
    'A=.git; echo x > $A/config',
    'A=.git; printf x > "$A/config"',
    'A=.git; echo x | tee "$A/config"',
    'G=.git; cp /tmp/x "$G/config"',
    'D=.oss; echo x > "$D/tool-gates.json"',
    'C=.claude; echo x > "$C/settings.json"',
    'D=$(echo .oss) && echo x > "$D/tool-gates.json"',
    'A=$(echo .git); echo x > "$A/config"',
    'echo x > "$UNSET_IN_ENV/config"',
    'X=$(cat /tmp/x); echo x > "$X/.git/config"',
    'X=$(cat /tmp/x); echo x > "$X/config"',
    'X=$(cat /tmp/x); cp /tmp/y "$X/config"',
    'X=$(cat /tmp/x); echo x > "$X.json" && echo "$X"',
    'X=$(cat /tmp/x); ln -s /tmp/y "$X/config"',
  ])('refuses a write that could land on a protected path: %s', (command) => refused(command, agent));

  // the tail after the unknown part names no protected path
  it.each([
    'X=$(cat /tmp/x); echo x > "$X/notes.txt"',
    'X=$(cat /tmp/x); cp /tmp/y "$X/notes.txt"',
    'echo x > "$UNSET_IN_ENV/notes.txt"',
    // code review INFO-1: the tail check no longer matches every tail through `**/.git/refs/**`
    'echo x > "$(cat /tmp/x)/notes.txt"',
    'touch "$(cat /tmp/x)/build/out.js"',
  ])('allows a write whose known tail can not be protected: %s', (command) => allowed(command, agent));

  // a bare command substitution could be anything (a bare variable is held for the user's call: round 12 report)
  it.each([
    'echo x > "$(cat /tmp/x)"',
    'cp /tmp/y "$(cat /tmp/x)"',
  ])('refuses a write to a bare command substitution: %s', (command) => refused(command, agent));

  // followed: plain values, temp files and folders
  it.each([
    'F=src/out.txt; echo x > "$F"',
    'F=src/out.txt; git status; echo x > "$F"',
    'F=src/out.txt && mkdir -p src && echo x > "$F"',
    'f=$(mktemp) && echo x > "$f"',
    'f=$(mktemp -t oss-x) && echo x > "$f"',
    'd=$(mktemp -d) && echo x > "$d"/out.txt',
    'D=src; git status; cd "$D" && echo x > out.js',
  ])('follows a variable the command sets: %s', (command) => allowed(command, agent));

  // fail closed: anything but a known-harmless command between the set and the use (the cd is then unknown)
  it.each([
    'F=src; \\printf -v F %s .oss; cd "$F" && echo x > out.js',
    'F=src; "read" F < /tmp/x; cd "$F" && echo x > out.js',
    'F=src; pr\\intf -v F %s x; cd "$F" && echo x > out.js',
    "F=src; echo $'x'; cd \"$F\" && echo x > out.js",
    'F=src; printf -v F %s x; cd "$F" && echo x > out.js',
    'F=src; somebuiltin F; cd "$F" && echo x > out.js',
    'F=src; somebuiltin; cd "$F" && echo x > out.js',
    'F=src; eval true; cd "$F" && echo x > out.js',
    'F=src; (true); cd "$F" && echo x > out.js',
    'F=src; F=dir; cd "$F" && echo x > out.js',
    'F=src; : ${F:=x}; cd "$F" && echo x > out.js',
    'F=src; git status | read F; cd "$F" && echo x > out.js',
  ])('fails closed when something could set the variable between: %s', (command) => refused(command, agent));

  // the environment the gate sees
  it('reads a variable the command does not set from the environment', async () => {
    await allowed('cd "$OUT_DIR" && echo x > out.js', agent, { OUT_DIR: path.join(repo, 'src') });
    await refused('echo x > "$OUT_FILE"', agent, { OUT_FILE: path.join(repo, '.oss', 'tool-gates.json') });
    await refused('cd "$OUT_DIR" && echo x > out.js', agent);
    // something before the use could have set it
    await refused('somebuiltin; cd "$OUT_DIR" && echo x > out.js', agent, { OUT_DIR: path.join(repo, 'src') });
  });

  it.each(SHELL_MAINTAINED)('never follows or trusts the shell-maintained variable %s', async (name) => {
    await refused(`${name}=src; cd "$${name}" && echo x > out.js`, agent);
    await refused(`cd "$${name}" && echo x > out.js`, agent, { [name]: 'src' });
  });

  // round 12, CR M1: output options after a cd the gate can't follow, by name in any case, one dash or two
  it.each([
    'cd "$d" && npx vitest --outputFile=tool-gates.json run',
    'cd "$d" && go test -coverprofile=tool-gates.json ./...',
    'cd "$d" && go test -coverprofile tool-gates.json ./...',
    'cd "$d" && npx tsc -p . --outFile tool-gates.json',
    'cd "$d" && npx esbuild a.ts --outdir=hooks',
    'cd "$d" && npx esbuild a.ts --outdir hooks',
    'cd "$d" && npx prettier --write tool-gates.json',
    'cd "$d" && npx prettier --write src/a.ts tool-gates.json',
    'cd "$d" && npx eslint --fix src/a.ts tool-gates.json',
    // the options that make a tool write its files come from the settings file (reviewWriteOptions)
    'cd "$d" && ruff check --fix tool-gates.json',
    'cd "$d" && npx biome check --apply tool-gates.json',
    'cd "$d" && npx jest --junitxml=settings.json',
    'cd "$d" && pytest --junitxml settings.json',
    'cd "$d" && npx mocha --reporter-option output=x --report settings.json',
    // round 13, CR M1 leftovers: `_` and `-` ignored, any case
    'cd "$d" && npx tool --output_file tool-gates.json',
    'cd "$d" && npx tool --OUTPUT_FILE=tool-gates.json',
    'cd "$d" && npx tool --outputPath tool-gates.json',
    'cd "$d" && npx tool --report-dir hooks',
    'cd "$d" && npx vitest run --coverage-dir=hooks',
    'cd "$d" && npx tsc --declarationDir hooks',
    'cd "$d" && npx prettier -w tool-gates.json',
  ])('refuses an output option that could write a protected file after an unknown cd: %s', (command) => refused(command, agent));

  // any output file after a folder known by no pattern could be in a protected folder (round 10); a check writes nothing
  it.each([
    'cd "$d" && npx prettier --check src/a.ts',
    'cd "$d" && npx eslint src/a.ts',
  ])('allows read-only runs after an unknown cd: %s', (command) => allowed(command, agent));
});

// round 12, accepted limit (user pick 2026-11-16, "Allow, record as limit"): a bare variable the gate
// can't know, as a write target, stays allowed for the main agent and builders (OSS's own served
// blocks write that way); a bare `$(…)` stays refused, and a review agent is refused.
describe('accepted limit: a bare unknown variable as a write target', () => {
  const BARE = [
    'X=$(cat /tmp/x); rm "$X"',
    'X=$(cat /tmp/x); echo x > "$X"',
    'G="$HOME/.oss/run/$(git rev-parse --absolute-git-dir | cut -c1-16)"; chmod 700 "$G"',
  ];

  it.each(AGENTS.flatMap(([who, agent]) => BARE.map((command): [string, string | null, string] => [who, agent, command])))(
    'is allowed for %s: %s',
    (_who, agent, command) => allowed(command, agent),
  );

  it.each(BARE)('is refused for a review agent: %s', (command) => refused(command, 'oss:code-reviewer'));

  it.each(AGENTS)('a bare command substitution stays refused for %s', (_who, agent) => refused('rm "$(cat /tmp/x)"', agent));
});
