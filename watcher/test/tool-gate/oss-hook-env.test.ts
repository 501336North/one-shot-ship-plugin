/**
 * @behavior No agent can run one of OSS's own hook scripts (`~/.oss/hooks/*`) with a HOME or PATH it
 *   chose: a `HOME=` / `PATH=` prefix, an `env` wrapper, or an `export HOME` / `export PATH` earlier in
 *   the same command is refused; the plain call still runs.
 * @business-rule R-266 round 12, SEC LOW-A (gate side): the hooks find their files and tools through
 *   HOME and PATH, so an agent that moves them could make a hook write or run something else.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { HOOK_CALL_VARIABLES } from '../../src/tool-gate/rules/oss-hook-env.js';
import { heredocBodyOf, tokenize, type Token } from '../../src/tool-gate/tokenize.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [
  ['the main agent', null],
  ['a builder', 'oss:typescript-pro'],
  ['a review agent', 'oss:code-reviewer'],
];

let root: string;
let repo: string;
let home: string;
let plugin: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r12-hookenv-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  // a plugin checkout: a folder with .claude-plugin/plugin.json (hook-env-refs Task 7)
  plugin = path.join(root, 'some-plugin');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'hooks'));
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"some-plugin"}');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, cwd: string = repo): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r12-hook-env',
        cwd,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent, agent_id: 'a1b2c3d4' }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux' },
  );
}

const HOOK = '~/.oss/hooks/ensure-decrypt-cli.sh --long-step';

describe.each(AGENTS)('%s', (_who, agent) => {
  it.each([
    `HOME=/tmp/elsewhere ${HOOK}`,
    `PATH=/tmp/bin:/usr/bin ${HOOK}`,
    `env PATH=/tmp/bin ${HOOK}`,
    `env ${HOOK}`,
    `env -i ${HOOK}`,
    `export HOME=/tmp/elsewhere; ${HOOK}`,
    `export PATH=/tmp/bin:/usr/bin && ${HOOK}`,
    `PATH=/tmp/bin; ${HOOK}`,
    `HOME=/tmp/elsewhere bash ${HOOK}`,
    'PATH=/tmp/bin bash "$HOME/.oss/hooks/ensure-decrypt-cli.sh" --long-step',
  ])('refuses a hook script run with a HOME or PATH it chose: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    // a review agent may not set HOME or PATH at all (gate-agent-write), which refuses some of these first
    expect(result.stderr, command).toMatch(agent === 'oss:code-reviewer' ? /^Refused/ : /^Refused.*HOME or PATH/);
  });

  // hook-env-refs Task 1: OSS hook scripts in the plugin cache, a --plugin-dir copy or checkout, and $CLAUDE_PLUGIN_ROOT
  it.each([
    'HOME=/tmp/elsewhere ~/.claude/plugins/cache/one-shot-ship-plugin/oss/2.2.2/hooks/oss-log.sh phase build RED start',
    'HOME=/tmp/elsewhere /Users/someone/.claude/plugins/cache/my-market/oss/2.1.3/hooks/check-updates.sh',
    'HOME=/tmp/elsewhere /tmp/oss-dev-copy/hooks/oss-log.sh phase build RED start',
    'HOME=/tmp/elsewhere ./hooks/oss-heads-up.sh',
    'HOME=/tmp/elsewhere "$CLAUDE_PLUGIN_ROOT/hooks/check-updates.sh"',
    'HOME=/tmp/elsewhere "${CLAUDE_PLUGIN_ROOT}/hooks/check-updates.sh"',
  ])('refuses an OSS hook script wherever it lives, run with a HOME it chose: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(agent === 'oss:code-reviewer' ? /^Refused/ : /^Refused.*HOME or PATH/);
  });

  it.each([
    'HOME=/tmp/elsewhere ./hooks/pre-commit.sh',
    'HOME=/tmp/elsewhere scripts/hooks/lint.sh',
    'HOME=/tmp/elsewhere /tmp/other-plugin/hooks/check.sh',
  ])('leaves a script that is not an OSS hook to the other rules: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.stderr, command).not.toMatch(/OSS hook script/);
  });

  it('runs the hook script as it is', async () => {
    const result = await call(HOOK, agent);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  // round 13, CR L-a: decided from the words the shell reads, brace expansion included
  it.each([
    `export {PATH,ZZ}=/tmp/bin; ${HOOK}`,
    `export {ZZ,HOME}=/tmp/elsewhere; ${HOOK}`,
    `{HOME,X}=/tmp/elsewhere; ${HOOK}`,
    `path=(/tmp/bin $path); ${HOOK}`,
    `read HOME < /tmp/x; ${HOOK}`,
    `: \${HOME:=/tmp/elsewhere}; ${HOOK}`,
    `bash -c 'export HOME=/tmp/elsewhere; ${HOOK}'`,
  ])('refuses a hook script after a HOME or PATH set in any form: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused/);
  });

  it.each([
    '~/.oss/hooks/oss-statusline-settings.sh # see HOME docs',
    'echo "see HOME and PATH docs"; ~/.oss/hooks/oss-statusline-settings.sh',
    '~/.oss/hooks/oss-statusline-settings.sh --home-dir-note HOMEBREW_PREFIX',
  ])('runs a hook script when HOME or PATH only shows up in text: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.stderr, command).not.toMatch(/HOME or PATH/);
    // a review agent may run only its listed hook scripts (gate-agent-write), so only the others run it
    if (agent !== 'oss:code-reviewer') expect(result.exitCode, command).toBe(0);
  });
});

// hook-env-refs Task 2: a hook call may set only the variables OSS's served commands set on one
/** Builtins that set the variables their operands name. */
const SETTERS = new Set(['declare', 'typeset', 'export', 'local', 'readonly', 'read', 'integer', 'float', 'let', 'env']);
/** Words that may start a simple command before its assignments. */
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '{', '!', 'time']);
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SERVED_HOOK = /\/\.oss\/hooks\/[^/\s"']|\/\.claude\/plugins\/cache\/[^/]+\/oss\/[^/]+\/hooks\/|hooks\/oss-[^/\s"']*\.sh|\$\{?CLAUDE_PLUGIN_ROOT\}?\/hooks\//;

/** The variable names one simple command sets: its assignments, and the operands of a setter, `for` or `printf -v`. */
function namesSetBy(words: string[]): string[] {
  let at = 0;
  while (RESERVED.has(words[at])) at++;
  const names: string[] = [];
  while (at < words.length && ASSIGNMENT.test(words[at])) names.push(words[at++]);
  while (words[at] === 'builtin' || words[at] === 'command') at++;
  const [program, ...args] = words.slice(at);
  if (program === 'for' || program === 'select') names.push(args[0] ?? '');
  else if (program === 'printf' || program === 'print') args.forEach((a, i) => a === '-v' && names.push(args[i + 1] ?? ''));
  else if (program !== undefined && SETTERS.has(program)) names.push(...args.filter((a) => !a.startsWith('-')));
  return names.map((n) => n.split(/[=[+]/)[0]).filter((n) => NAME.test(n));
}

function collectNames(tokens: Token[], into: Set<string>): void {
  let words: string[] = [];
  const end = (): void => {
    for (const name of namesSetBy(words)) into.add(name);
    words = [];
  };
  for (const token of tokens) {
    if (token.kind === 'op') end();
    else if (token.kind === 'word') words.push(token.value);
    if (token.kind !== 'op') token.scripts?.forEach((script) => collectNames(script, into));
    const body = token.kind === 'redirect' ? heredocBodyOf(token) : undefined;
    if (body !== undefined) collectNames(tokenize(body).tokens, into);
  }
  end();
}

/** Every variable a served block sets when the block runs an OSS hook script. */
function servedHookVariables(): Set<string> {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(PLUGIN_ROOT, 'watcher/test/fixtures/served-command-blocks.json'), 'utf8'),
  ) as { files: Record<string, string[]> };
  const served = new Set<string>();
  for (const block of Object.values(fixture.files).flat()) {
    if (SERVED_HOOK.test(block)) collectNames(tokenize(block).tokens, served);
  }
  return served;
}

const SERVED_HOOK_VARIABLES = servedHookVariables();

const LOG_HOOK = '~/.oss/hooks/oss-log.sh write build x';

describe.each(AGENTS.slice(0, 2))('%s, setting a variable on a hook call', (_who, agent) => {
  it.each([
    `CLAUDE_PLUGIN_ROOT=/tmp/x ${LOG_HOOK}`,
    `BASH_ENV=./x.sh ${LOG_HOOK}`,
    `ENV=./x ${LOG_HOOK}`,
    `NODE_OPTIONS=--require=./x.js ${LOG_HOOK}`,
    `SHELLOPTS=xtrace PS4='$(id)' ${LOG_HOOK}`,
    `GIT_DIR=x ${LOG_HOOK}`,
    `DYLD_INSERT_LIBRARIES=x ${LOG_HOOK}`,
    `export NODE_OPTIONS=--require=./x.js; ${LOG_HOOK}`,
    `env BASH_ENV=x ${LOG_HOOK}`,
  ])('refuses a hook script run with a variable the served commands never set: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused.*OSS hook script.*variable.*not on the list/);
  });

  it.each([...SERVED_HOOK_VARIABLES].map((name) => `${name}=x ${LOG_HOOK}`))(
    'runs a hook script with a variable a served command sets on one: %s',
    async (command) => {
      const result = await call(command, agent);
      expect(result.stderr, command).not.toMatch(/OSS hook script/);
    },
  );

  // R-257 pen test: a hook script run through a shell, from the plugin cache, a --plugin-dir copy or $CLAUDE_PLUGIN_ROOT
  it.each([
    'HOME=/tmp/m bash ~/.claude/plugins/cache/my-market/oss/2.3.0/hooks/oss-notify.sh x',
    'HOME=/tmp/m sh ~/.claude/plugins/cache/my-market/oss/2.3.0/hooks/oss-notify.sh x',
    'PATH=/tmp/m sh /tmp/oss-dev-copy/hooks/oss-log.sh x',
    "export HOME=/tmp/m; bash -c '~/.claude/plugins/cache/my-market/oss/2.3.0/hooks/oss-notify.sh'",
    'HOME=/tmp/m bash "$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh"',
  ])('refuses a hook script run through a shell with a HOME or PATH it chose: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused.*OSS hook script/);
  });

  // hook-env-refs Task 6: variables set from other places (a sourced file, keyword words, a trap, exec -c)
  it.each([
    `. /tmp/e; ${LOG_HOOK}`,
    `source /tmp/e; ${LOG_HOOK}`,
    `builtin source /tmp/e; ${LOG_HOOK}`,
    `command . /tmp/e; ${LOG_HOOK}`,
    `set -a; . /tmp/e; ${LOG_HOOK}`,
    `${LOG_HOOK}; source /tmp/e`,
    `bash -c '. /tmp/e; ${LOG_HOOK}'`,
    `eval 'source /tmp/e'; ${LOG_HOOK}`,
    `${LOG_HOOK}; bash <<'EOF'\nsource /tmp/e\nEOF`,
    `bash -c 'set -k; ${LOG_HOOK} BASH_ENV=/tmp/x'`,
    `set -o keyword; ${LOG_HOOK} BASH_ENV=/tmp/x`,
    `set -T; ${LOG_HOOK}`,
    `set -o functrace; ${LOG_HOOK}`,
    `bash -c 'trap "export BASH_ENV=/tmp/x" DEBUG; ${LOG_HOOK}'`,
    `trap 'NODE_OPTIONS=--require=/tmp/x.js' DEBUG; ${LOG_HOOK}`,
    `exec -c ${LOG_HOOK}`,
    `. ~/.oss/hooks/../x; ${LOG_HOOK}`,
    `. ~/.oss/hooks/oss-*.sh; ${LOG_HOOK}`,
    `. "$H/oss-api-curl.sh"; ${LOG_HOOK}`,
    `. /tmp/oss/hooks/oss-api-curl.sh; ${LOG_HOOK}`,
    `CLAUDE_PLUGIN_ROOT=/tmp/m; . "$CLAUDE_PLUGIN_ROOT/hooks/oss-value.sh"`,
  ])('refuses a hook script run with variables from a file, keyword words, a trap or a cleared env: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused.*OSS hook script/);
  });

  it.each([LOG_HOOK, `. ~/.oss/hooks/oss-api-curl.sh; ${LOG_HOOK}`, `set -e; ${LOG_HOOK}`, `set -u; ${LOG_HOOK}`, `set -o pipefail; ${LOG_HOOK}`, `set -euo pipefail; ${LOG_HOOK}`])(
    'runs a hook script after shell options that set no variable, or after sourcing an OSS hook file: %s',
    async (command) => {
      const result = await call(command, agent);
      expect(result.stderr, command).not.toMatch(/OSS hook script/);
    },
  );

  it('leaves `source` alone in a command that runs no hook script', async () => {
    const result = await call('source /tmp/e; echo hi', agent);
    expect(result.stderr).not.toMatch(/OSS hook script/);
  });

  it('still lets a hook call unset a variable', async () => {
    const result = await call(`unset GIT_DIR NODE_OPTIONS; ${LOG_HOOK}`, agent);
    expect(result.stderr).not.toMatch(/OSS hook script/);
  });

  // hook-env-refs Task 9: variables exported without `source` (set -a, functions, indirect setters)
  it.each([
    `set -a; git() { /tmp/evil; }; ${LOG_HOOK}`,
    `set -o allexport; x=1; ${LOG_HOOK}`,
    `set -a; printf -vBASH_ENV /tmp/e; ${LOG_HOOK}`,
    `printf -v BASH_ENV /tmp/e; export BASH_ENV; ${LOG_HOOK}`,
    `git() { /tmp/evil; }; ${LOG_HOOK}`,
    `function git { /tmp/evil; }; ${LOG_HOOK}`,
    `mapfile BASH_ENV </tmp/e; export BASH_ENV; ${LOG_HOOK}`,
    `readarray BASH_ENV </tmp/e; export BASH_ENV; ${LOG_HOOK}`,
    `getopts a BASH_ENV; export BASH_ENV; ${LOG_HOOK}`,
  ])('refuses a hook script run after variables or functions reach its environment without source: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused.*OSS hook script/);
  });

  it.each([`n=3; ~/.oss/hooks/oss-log.sh checkpoint "$n"`, `for f in *.ts; do ~/.oss/hooks/oss-log.sh x "$f"; done`])(
    'runs a hook script after a plain variable that is never exported: %s',
    async (command) => {
      const result = await call(command, agent);
      expect(result.stderr, command).not.toMatch(/OSS hook script/);
    },
  );
});

// hook-env-refs Task 7: a hook path written through a glob, in any case, or under any plugin's hooks folder
describe.each(AGENTS.slice(0, 2))('%s, a hook path through a glob, in any case, or of any plugin', (_who, agent) => {
  it.each([
    'BASH_ENV=/tmp/x bash ~/.oss/hook?/oss-log.sh',
    'BASH_ENV=/tmp/x ~/.oss/hoo*/oss-log.sh',
    'BASH_ENV=/tmp/x ~/.oss/hook[s]/oss-log.sh',
    'BASH_ENV=/tmp/x hooks/OSS-log.sh',
    'BASH_ENV=/tmp/x ~/.OSS/hooks/x',
    'BASH_ENV=/tmp/x ~/.claude/plugins/cache/my-market/other-plugin/1.0.0/hooks/check.sh',
  ])('refuses a hook script run with a variable the served commands never set: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused.*OSS hook script/);
  });

  it.each(['<checkout>/hooks/checkpoint.sh', './hooks/checkpoint.sh'])(
    'refuses any hook script of a plugin checkout run with a variable it chose: %s',
    async (hook) => {
      const command = `BASH_ENV=/tmp/x ${hook.replace('<checkout>', plugin)}`;
      const result = await call(command, agent, plugin);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused.*OSS hook script/);
    },
  );

  it.each(['BASH_ENV=/tmp/x ./hooks/pre-commit.sh', 'BASH_ENV=/tmp/x scripts/hooks/lint.sh'])(
    'leaves a hooks script of a repo that is not a plugin to the other rules: %s',
    async (command) => {
      const result = await call(command, agent);
      expect(result.stderr, command).not.toMatch(/OSS hook script/);
    },
  );
});

describe('the hook-call variable list', () => {
  it('is exactly the variables the served commands set in a block that runs an OSS hook script', () => {
    expect([...HOOK_CALL_VARIABLES].sort()).toEqual([...SERVED_HOOK_VARIABLES].sort());
  });

  it('never holds a variable that moves where a hook looks or what its shell and tools run', () => {
    const refused = /^(?:HOME|PATH|path|CLAUDE_PLUGIN_ROOT|BASH_ENV|ENV|NODE_OPTIONS|SHELLOPTS|BASHOPTS|PS4|GIT_.*|LD_.*|DYLD_.*)$/;
    expect([...HOOK_CALL_VARIABLES].filter((name) => refused.test(name))).toEqual([]);
  });
});
