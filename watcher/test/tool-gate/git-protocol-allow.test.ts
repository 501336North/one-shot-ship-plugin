/**
 * @behavior The main agent and builders can't let git use a protocol that runs a command or reads this machine
 *   (`ext::`, `file://`): `GIT_ALLOW_PROTOCOL` set for a call, alone, through `env` or exported, and any
 *   `protocol.<name>.allow` key set through `git config`, `-c` or `GIT_CONFIG_KEY_n`, are refused. Everyday fetches,
 *   `-c protocol.version=2`, reading a protocol key, and `-c protocol.file.allow` on `git submodule` stay allowed. The find-glob matcher keeps working on a glob
 *   with a very large set of positions (a plain loop finds the lowest, not an argument spread).
 * @business-rule gate-gaps-r3 ship round 1, S4 (owner pick "Fix 1 and 2, card 3"; follow-up pick "Allow on submodule only").
 * @boundary runToolGate (the gate as the hook calls it) with a scratch repo whose origin is a real host, on darwin
 *   and linux; the glob matcher directly, since the gate refuses a word that long before it reaches the matcher.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';
import { couldMatch, globTokens } from '../../src/tool-gate/rules/verdict-capture-call.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-git-protocol-allow-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/x.git'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'git-protocol-allow',
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
  "GIT_ALLOW_PROTOCOL=ext git ls-remote 'ext::sh -c true'",
  'export GIT_ALLOW_PROTOCOL=ext',
  "export GIT_ALLOW_PROTOCOL=ext:https; git fetch 'ext::sh -c true'",
  "GIT_ALLOW_PROTOCOL=ext; git ls-remote 'ext::sh -c true'",
  "env GIT_ALLOW_PROTOCOL=ext git ls-remote 'ext::sh -c true'",
  'git config protocol.file.allow always',
  'git config --global protocol.ssh.allow always',
  'git -c protocol.file.allow=always fetch origin',
  'git -c protocol.file.allow=always fetch /tmp/x',
  'git -c protocol.file.allow=always clone /tmp/x y',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always git fetch origin',
];

/** Ship fix round 2, R2-2 ("Blunt: refuse any mention"): any command whose text names GIT_ALLOW_PROTOCOL. */
const NAMES_ALLOW_PROTOCOL = [
  'set -a; printf -v GIT_ALLOW_PROTOCOL ext; git submodule update --init',
  'set -a; read GIT_ALLOW_PROTOCOL <<< ext; git submodule update --init',
  'private -x GIT_ALLOW_PROTOCOL=ext; git submodule update --init',
  'set -a; : ${GIT_ALLOW_PROTOCOL:=ext}; git submodule update --init',
  'printf -v GIT_ALLOW_PROTOCOL ext; export GIT_ALLOW_PROTOCOL; git fetch origin',
  "env -S 'GIT_ALLOW_PROTOCOL=ext git fetch origin'",
];

/** Ship fix round 3, R3-1: the name split by quotes or built from an expansion, which the text check can't see. */
const SPLIT_ALLOW_PROTOCOL = [
  'export GIT_ALLOW_PROT""OCOL=ext; git fetch origin',
  "env GIT_ALLOW_PROT''OCOL=ext git fetch origin",
  'export GIT_ALLOW_PROT\\OCOL=ext; git fetch origin',
  "export $'GIT_ALLOW_PROTO\\x43OL=ext'; git fetch origin",
  'x=PROTOCOL; typeset -x "GIT_ALLOW_${x}"=ext; git fetch origin',
  "export GIT_ALLOW_PROT''OCOL=ext; git clone 'ext::sh -c touch% /tmp/pwn' x",
  'x=PROTOCOL; export GIT_ALLOW_$x=ext; git fetch origin',
  'printf -v "GIT_ALLOW_PROT""OCOL" ext; export GIT_ALLOW_PROT""OCOL; git fetch origin',
  'declare -x GIT_ALLOW_PROT""OCOL=ext; git fetch origin',
  "export 'GIT_ALLOW_PROTO'COL=ext; git fetch",
  "x=1 GIT_ALLOW_PROTO''COL=ext git fetch",
];

const ALLOWED = [
  'echo protocol',
  'git fetch origin',
  'git ls-remote origin',
  'git -c protocol.version=2 fetch origin',
  'git config --get protocol.file.allow',
  // S4 follow-up pick "Allow on submodule only": a local-path submodule needs the file protocol
  'git -c protocol.file.allow=always submodule add ../lib lib',
  'git -c protocol.file.allow=always submodule update',
];

describe.each(PLATFORMS)('git protocols that run commands (ship round 1, S4) on %s', (platform) => {
  describe.each(AGENTS)('%s', (_label, agent) => {
    it.each(REFUSED)('refuses allowing a protocol by variable or config key: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(NAMES_ALLOW_PROTOCOL)('refuses any command that names GIT_ALLOW_PROTOCOL: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(SPLIT_ALLOW_PROTOCOL)('refuses GIT_ALLOW_PROTOCOL set under a split or built name: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    });

    it.each(ALLOWED)('allows everyday fetches and reading protocol settings: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});

describe('the find-glob matcher on a glob with a very large set of positions (ship round 1, S4)', () => {
  it('decides without throwing, where spreading the positions as arguments throws', () => {
    const tokens = globTokens('*'.repeat(500_000));
    expect(couldMatch(tokens, ['workflow-state', '.json'], false)).toBe(true);
  });
});
