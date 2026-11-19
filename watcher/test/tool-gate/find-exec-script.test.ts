/**
 * @behavior The main agent and builders can't run a protected OSS script (the verdict capture, an OSS
 *   hook) by letting `find` pick it with a short glob and run it: `find … -name 'v*e.cjs' -exec node {} \;`,
 *   `-execdir`, `-ok`, `-okdir`, `{}` as the program itself, and the same picked file piped to an
 *   interpreter through `xargs` (`-print0 | xargs -0` too). Everyday `find` (grep, delete, a test run,
 *   counting lines through `xargs wc`) stays allowed, and the refusal never repeats the command's values.
 * @business-rule gate-gaps-r3 Task 10 (R-266, R-257 gate round 4, user pick D47): a `find` that runs `{}`
 *   as a program, or as an interpreter's script, under a -name / -iname / -path / -ipath / -wholename /
 *   -iwholename glob that could match a protected script name is refused. Task 10b (owner pick "Also require
 *   a start path that can reach them"): only when the find could reach those scripts: a start at or above
 *   the plugin folder or ~/.oss (`~`, `$HOME`, `/`, a `..` that climbs there), a start inside them, a start
 *   only known when it runs, `-L` / `-follow` / `-H`, or the default start when the cwd is inside them.
 * @boundary runToolGate (the gate as the hook calls it), with the plugin's real config/tool-gates.json,
 *   a scratch home and a scratch repo, on darwin and linux. Nothing is run for real.
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

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-find-exec-script-')));
/** A scratch home: never the real ~/.oss. */
const home = path.join(root, 'home');
const repo = path.join(root, 'repo');

beforeAll(() => {
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  for (const folder of ['src', 'scripts', 'dist']) fs.mkdirSync(path.join(repo, folder), { recursive: true });
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
        session_id: 'find-exec-script',
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

const DIST = '"$CLAUDE_PLUGIN_ROOT"/watcher/dist';

/** Each refused row, with values of its own that the refusal must not repeat. */
const REFUSED: Array<[string, string[]]> = [
  [`find ${DIST} -name 'v*e.cjs' -exec node {} start i1.json \\;`, ['v*e.cjs', 'i1.json']],
  [`find ${DIST} -name 'v*e.cjs' -execdir node {} \\;`, ['v*e.cjs']],
  [`find "$CLAUDE_PLUGIN_ROOT" -name 'o*g.sh' -exec {} \\;`, ['o*g.sh']],
  [`find ${DIST} -iname 'V*E.CJS' -exec node {} \\;`, ['V*E.CJS']],
  [`find ${DIST} -path '*/dist/*/v*' -exec node {} \\;`, ['*/dist/*/v*']],
  [`find "$CLAUDE_PLUGIN_ROOT" -name '*-l?g.sh' -ok sh {} \\;`, ['*-l?g.sh']],
  [`find ${DIST} -name 'v*e.cjs' | xargs node`, ['v*e.cjs']],
  [`find ${DIST} -name 'v*e.cjs' -print0 | xargs -0 node`, ['v*e.cjs']],
  // Task 10b: a start that can reach the protected scripts
  ["find -L scripts -name '*.sh' -exec bash {} \\;", []],
  ["find ~ -name 'v*e.cjs' -exec node {} \\;", ['v*e.cjs']],
  ['find "$DIR" -name \'v*e.cjs\' -exec node {} \\;', ['v*e.cjs']],
  ["find / -name '*.sh' -exec bash {} \\;", []],
  [`find '${PLUGIN_ROOT}/watcher/dist' -name 'v*e.cjs' -exec node {} \\;`, ['v*e.cjs']],
];

const ALLOWED: string[] = [
  "find src -name '*.ts' -exec grep -l x {} +",
  "find src -name '*.log' -delete",
  "find src -name '*.test.ts' -exec npx vitest run {} +",
  "find . -type f -name '*.md' | xargs wc -l",
  // Task 10b: a glob that could match, but from a start in the project that can't reach the protected scripts
  "find scripts -name '*.sh' -exec bash {} \\;",
  "find dist -name '*.js' -exec node --check {} \\;",
  "find src -name '*.sh' -exec sh {} \\;",
];

describe('gate-gaps-r3 Task 10: find -exec / xargs cannot run a protected script picked by a short glob', () => {
  for (const platform of PLATFORMS) {
    for (const [who, agent] of AGENTS) {
      it(`refuses find running a glob-picked protected script for ${who} on ${platform}`, async () => {
        const wrong: string[] = [];
        for (const [command] of REFUSED) {
          const result = await call(command, agent, platform);
          if (!(result.exitCode === 2 && /^Refused/.test(result.stderr))) wrong.push(command);
        }
        expect(wrong).toEqual([]);
      });

      it(`does not repeat the command's values in the refusal for ${who} on ${platform}`, async () => {
        const echoed: string[] = [];
        for (const [command, values] of REFUSED) {
          const result = await call(command, agent, platform);
          for (const value of values) if (result.stderr.includes(value)) echoed.push(`${command} -> ${value}`);
        }
        expect(echoed).toEqual([]);
      });

      it(`keeps everyday find and xargs allowed for ${who} on ${platform}`, async () => {
        const wrong: string[] = [];
        for (const command of ALLOWED) {
          const result = await call(command, agent, platform);
          if (result.exitCode !== 0) wrong.push(`${command}: ${result.stderr}`);
        }
        expect(wrong).toEqual([]);
      });
    }
  }
});
