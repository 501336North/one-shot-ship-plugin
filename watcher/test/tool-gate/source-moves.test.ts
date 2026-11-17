/**
 * @behavior The main agent and builders can't hide a write to a protected file behind a sourced
 *   script: after `. ./x.sh` or `source some/file`, which may change the folder, the gate no longer
 *   trusts the folder it knew, so a relative write that could land on a protected file is refused.
 *   OSS's own hook files (`~/.oss/hooks/…`, `$CLAUDE_PLUGIN_ROOT/hooks/…`) are trusted, so served
 *   commands like `. ~/.oss/hooks/oss-api-curl.sh` keep working.
 * @business-rule R-266 round 11: sourcing any file makes the folder unknown afterwards, except OSS's
 *   own hook files. Round 13 (CR L-d): the plugin's hook files count as OSS's own only when the plugin
 *   folder is under ~/.claude/plugins (or another protected path); a plugin folder anywhere else is not.
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
/** The plugin as Claude Code installs it, under the scratch home's ~/.claude/plugins (round 13, CR L-d). */
let installed: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r11-source-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  // a script that moves the shell into the protected folder when sourced
  fs.writeFileSync(path.join(repo, 'mv.sh'), 'cd .claude\n');
  fs.writeFileSync(path.join(repo, 'src', 'mv.sh'), 'cd ../.claude\n');
  // a plugin folder inside the repo the agent writes: its hook files are the agent's to change
  fs.mkdirSync(path.join(repo, 'vendor', 'oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'vendor', 'oss', 'hooks', 'oss-value.sh'), 'cd .claude\n');
  fs.mkdirSync(path.join(repo, 'vendor', 'oss', 'config'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), path.join(repo, 'vendor', 'oss', 'config', 'tool-gates.json'));
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  installed = path.join(home, '.claude', 'plugins', 'cache', 'oss');
  fs.mkdirSync(path.join(installed, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(installed, 'hooks', 'oss-value.sh'), 'true\n');
  fs.mkdirSync(path.join(installed, 'config'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), path.join(installed, 'config', 'tool-gates.json'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, pluginRoot = installed): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r11-source-moves',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: command.replaceAll('<home>', home).replaceAll('<plugin>', pluginRoot) },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
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
    '. ./mv.sh; echo x > settings.json',
    'source ./mv.sh; echo x > settings.json',
    'source src/mv.sh && echo x > settings.local.json',
    '. mv.sh; cp /dev/null settings.json',
    'if true; then . ./mv.sh; fi; echo x > settings.json',
    '{ . ./mv.sh; }; echo x > settings.json',
    '. ./mv.sh; cd src; echo x > settings.json',
    `. ${'$HOME'}/.oss/hooks/../../mv.sh; echo x > settings.json`,
    '. "$X"; echo x > settings.json',
    'builtin source ./mv.sh; echo x > settings.json',
    'command . ./mv.sh; echo x > settings.json',
    // any relative write after a folder the gate can't follow could be a protected file (`~/.claude/plugins/…`)
    '. ./mv.sh; echo x > out.js',
  ])('refuses a write that could land on a protected file after sourcing a file: %s', (command) => refused(command, agent));

  it.each([
    '. ./mv.sh; npx vitest run test/a.test.ts',
    'echo x > settings.json; . ./mv.sh',
    '(. ./mv.sh); echo x > settings.json',
    '. ~/.oss/hooks/oss-api-curl.sh; echo x > settings.json',
    'source ~/.oss/hooks/oss-api-curl.sh || exit 1; echo x > settings.json',
    '. <home>/.oss/hooks/oss-api-curl.sh; echo x > settings.json',
    '. "$CLAUDE_PLUGIN_ROOT/hooks/oss-value.sh"; echo x > settings.json',
    '. "${CLAUDE_PLUGIN_ROOT}/hooks/oss-value.sh"; echo x > settings.json',
    '. <plugin>/hooks/oss-value.sh; echo x > settings.json',
  ])('allows a write that stays clear of protected files, or OSS hook files: %s', (command) => allowed(command, agent));
});

// round 12, CR L1: a plugin folder inside a repo the session writes is not OSS's own, so sourcing its hooks moves the shell
describe.each(AGENTS)('%s, with the plugin folder inside the repo', (_who, agent) => {
  it.each([
    '. "$CLAUDE_PLUGIN_ROOT/hooks/oss-value.sh"; echo x > settings.json',
    '. "${CLAUDE_PLUGIN_ROOT}/hooks/oss-value.sh"; echo x > settings.json',
    '. <repo>/vendor/oss/hooks/oss-value.sh; echo x > settings.json',
  ])('refuses a write after sourcing its hook file: %s', async (command) => {
    const result = await call(command.replaceAll('<repo>', repo), agent, path.join(repo, 'vendor', 'oss'));
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused/);
  });

  it('still trusts ~/.oss/hooks', async () => {
    const result = await call('. <home>/.oss/hooks/oss-api-curl.sh; echo x > settings.json', agent, path.join(repo, 'vendor', 'oss'));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});

// round 13, CR L-d: a plugin folder outside ~/.claude/plugins (here the plugin's own checkout) is not OSS's own
describe.each(AGENTS)('%s, with the plugin folder outside ~/.claude/plugins', (_who, agent) => {
  it.each([
    '. "$CLAUDE_PLUGIN_ROOT/hooks/oss-value.sh"; echo x > settings.json',
    '. "${CLAUDE_PLUGIN_ROOT}/hooks/oss-value.sh"; echo x > settings.json',
    '. <plugin>/hooks/oss-value.sh; echo x > settings.json',
  ])('refuses a write after sourcing its hook file: %s', async (command) => {
    const result = await call(command, agent, PLUGIN_ROOT);
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).toMatch(/^Refused/);
  });

  it('still trusts ~/.oss/hooks', async () => {
    const result = await call('. <home>/.oss/hooks/oss-api-curl.sh; echo x > settings.json', agent, PLUGIN_ROOT);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});
