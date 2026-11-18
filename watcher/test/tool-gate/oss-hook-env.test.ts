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

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [
  ['the main agent', null],
  ['a builder', 'oss:typescript-pro'],
  ['a review agent', 'oss:code-reviewer'],
];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r12-hookenv-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.mkdirSync(repo);
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
        session_id: 'r12-hook-env',
        cwd: repo,
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
