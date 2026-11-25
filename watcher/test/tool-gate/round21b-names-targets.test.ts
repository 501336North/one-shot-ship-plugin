/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere): a Homebrew GNU-named `gfind`
 *   or `gxargs` is judged as the `find` or `xargs` it is; a tar folder given as a long option (`--cd ..`, `--dir=..`,
 *   any prefix of `--directory`) is checked as `-C` is; a `mktemp` value or folder (GNU long options, an attached
 *   `-p`, a `-t` prefix holding `/`) is judged as the path mktemp makes; and a trap that reads thousands of names
 *   while the command mentions IFS is decided well inside the time limit.
 * @business-rule R-266 round 21 Part B: PERF MEDIUM-1 (one pass over the trap script), SEC HIGH-2 (`gfind`,
 *   `gxargs`), SEC MEDIUM-1 (tar long-option prefixes), CR LOW-1 (mktemp GNU long options), CR L-b / L-c and
 *   SEC INFO-1 (every mktemp value and folder judged).
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo, on darwin (zsh) and linux (bash).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateDeps, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r21b-names-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'run'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, platform: NodeJS.Platform, clock?: GateDeps['clock']): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'r21b-names',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform, clock },
  );
}

async function allowed(command: string, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(command, agent, platform);
  expect(result.stderr, command).toBe('');
  expect(result.exitCode, command).toBe(0);
}

async function refuse(command: string, agent: string | null, platform: NodeJS.Platform): Promise<void> {
  const result = await call(command, agent, platform);
  expect(result.exitCode, command).toBe(2);
  expect(result.stderr, command).toMatch(/^Refused/);
}

/** This process's CPU time in milliseconds (user + system): the work done, whatever else the machine runs. */
function cpuMs(): number {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

const HOME_D = 'D=$(cd ~ && pwd); ';
const TRAP_TMP = "trap 'rm -rf \"$tmp\"' EXIT; ";

/** `IFS=/; trap 'rm -rf $v0 … $v4px' EXIT; echo v0,…,v4px`: about 6,100 names the trap reads unquoted. */
function manyNamesWithIfs(): string {
  const names = Array.from({ length: 6100 }, (_, i) => `v${i.toString(36)}`);
  return `IFS=/; trap 'rm -rf ${names.map((n) => `$${n}`).join(' ')}' EXIT; echo ${names.join(',')}`;
}

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    it('PERF MEDIUM-1: decides a trap reading ~6,100 names, with IFS mentioned, well inside the time limit (a bound, not a tight timing)', async () => {
      // The gate's 1 s decision deadline and this bound run on this process's CPU time, not the wall
      // clock, so other work on the machine can't trip them; a decision that does too much work still does.
      const started = cpuMs();
      const result = await call(manyNamesWithIfs(), agent, platform, cpuMs);
      const took = cpuMs() - started;
      // refused as too complex, as before, but not by running out of time (the decision deadline)
      expect(result.exitCode).toBe(2);
      expect(result.stderr).not.toContain('took too long');
      expect(took).toBeLessThan(1500);
    });

    it.each([
      'gfind . -delete',
      'gfind . -exec rm -rf {} +',
      "gfind .git/hooks -name pre-commit -exec sh -c 'echo x > {}' +",
      'gfind .oss -delete',
      'gfind . -fprint .oss/x',
      'gxargs rm -rf .oss < list',
    ])('SEC HIGH-2: refuses a GNU-named find or xargs as it refuses the plain one: %s', (command) => refuse(command, agent, platform));

    it.each([
      ['gfind . -delete', 'find . -delete'],
      ['gfind . -exec rm -rf {} +', 'find . -exec rm -rf {} +'],
      ["gfind .git/hooks -name pre-commit -exec sh -c 'echo x > {}' +", "find .git/hooks -name pre-commit -exec sh -c 'echo x > {}' +"],
      ['gxargs rm -rf < list', 'xargs rm -rf < list'],
      ['gxargs rm -rf .oss < list', 'xargs rm -rf .oss < list'],
      ['gfind build -delete', 'find build -delete'],
    ])('SEC HIGH-2: gives %s the verdict of %s', async (gnu, plain) => {
      const asGnu = await call(gnu, agent, platform);
      const asPlain = await call(plain, agent, platform);
      expect(asGnu.exitCode, gnu).toBe(asPlain.exitCode);
    });

    it.each([
      "gfind . -name '*.ts'",
      'gfind src -type f -print',
      'find build -delete',
      'gfind build -delete',
      'gxargs -0 echo < list',
    ])('SEC HIGH-2: keeps allowing an ordinary find or xargs: %s', (command) => allowed(command, agent, platform));

    it.each([
      'cd sub && tar -xf ../t.tar --cd ..',
      'cd sub && tar -xf ../t.tar --dir ..',
      'cd sub && tar -xf ../t.tar --dir=..',
      'mkdir -p sub && cd sub && tar -xf ../t.tar --cd ..',
      'cd sub && bsdtar -xf ../t.tar --cd=..',
      'cd sub && gtar -xf ../t.tar --di ..',
      'tar -xf t.tar --direc=.oss',
      `${HOME_D}tar -xf t.tar --cd "$D"/.claude`,
      `${HOME_D}tar -xf t.tar --dire="$D"/.claude`,
    ])('SEC MEDIUM-1: refuses a tar folder given as `--cd` or a prefix of `--directory`: %s', (command) =>
      refuse(command, agent, platform));

    it.each([
      'tar -xf t.tar --directory=build',
      'tar -xf t.tar --directory build',
      'tar -xf t.tar --dir=build',
      'tar -xf t.tar --cd build',
      'tar -C build -xf t.tar',
      'tar -xf t.tar -Cbuild',
      'tar -xf t.tar -C "$OUT"',
    ])('SEC MEDIUM-1: keeps allowing an ordinary tar folder: %s', (command) => allowed(command, agent, platform));

    it.each([
      `${TRAP_TMP}tmp=$(mktemp --directory); npm test`,
      `${TRAP_TMP}tmp=$(mktemp -d --tmpdir x.XXXX); npm test`,
      `${TRAP_TMP}tmp=$(mktemp --tmpdir=/var/tmp -d); npm test`,
      "trap 'rm -f \"$f\"' EXIT; f=$(mktemp --suffix=.json); npm test",
      "trap 'rm -f \"$f\"' EXIT; f=$(mktemp --quiet); npm test",
      `${TRAP_TMP}tmp=$(mktemp --dry-run); npm test`,
      'mktemp -d',
      'mktemp -dt x',
      'mktemp -p /var/tmp',
      'tmp=$(mktemp -d -t build)',
      'mktemp -p .',
      'mktemp x.XXXX',
      'mktemp -d -p "$OUT"',
      'f=$(mktemp -p src); date > "$f"',
    ])('CR LOW-1: allows mktemp with GNU long options and ordinary folders: %s', (command) => allowed(command, agent, platform));

    it.each([
      `${TRAP_TMP}tmp=$(mktemp --tmpdir=.oss/tool-gates -d)`,
      `${TRAP_TMP}tmp=$(mktemp --directory --tmpdir=$HOME/.claude/plugins)`,
      "trap 'rm -f \"$f\"' EXIT; f=$(mktemp -u --suffix=.json .oss/tool-gates)",
      `${TRAP_TMP}tmp=$(mktemp --bogus)`,
    ])('CR LOW-1: still refuses a long-option mktemp value that could be protected or unread: %s', (command) =>
      refuse(command, agent, platform));

    it.each([
      'F=$(mktemp -u -p.oss tool-gates.json); rm -f "$F"',
      'F=$(mktemp -u -p .oss tool-gates.json); rm -f "$F"',
      "trap 'cp -R x \"$F\"' EXIT; F=$(mktemp -d -t ../../.claude/plugins/p)",
      'mktemp -dp~/.claude/plugins',
      'mktemp -qp .git/hooks',
      `${HOME_D}mktemp -d -p "$D"/.claude`,
      'mktemp -dp ~/.claude/plugins',
    ])('CR L-b / L-c / SEC INFO-1: refuses a mktemp value or folder that could be protected: %s', (command) =>
      refuse(command, agent, platform));
  });
});
