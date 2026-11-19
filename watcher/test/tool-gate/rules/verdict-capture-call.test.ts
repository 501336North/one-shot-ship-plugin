/**
 * @behavior Only Claude Code's own SubagentStart/SubagentStop hook runs the verdict capture. The main agent and
 *   builders cannot run it themselves through Bash: any call naming `oss-verdict-capture.sh` or
 *   `verdict-capture.cjs` is refused, however it is spelled (a path, `~`, `$HOME`, the plugin cache, a plugin
 *   checkout, `node <path>`, `bash <path>`, through `env`, `command` or `exec`, a variable, or a glob). Other OSS
 *   hooks still run, and a test file about the capture can still be run.
 * @business-rule R-257 D41 (user pick, ship gate round 3, "Capture lockdown: gate refusal plus transcript"; security
 *   M2): a model that runs the capture CLI with hand-made hook input could mint captured review verdicts.
 * @boundary runToolGate (the gate as the hook calls it), with the plugin's real config/tool-gates.json.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../../src/tool-gate/gate.js';
import { namesVerdictCapture } from '../../../src/tool-gate/rules/verdict-capture-call.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let repo: string;
/** A scratch home: never the real ~/.oss. */
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r257-capture-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
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
        session_id: 'r257-capture',
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

const REFUSED: Array<[string, () => string]> = [
  ['the ~/.oss/hooks copy', () => '~/.oss/hooks/oss-verdict-capture.sh < in.json'],
  ['the $HOME copy, through bash', () => 'bash "$HOME/.oss/hooks/oss-verdict-capture.sh" start < in.json'],
  ['an absolute home path', () => `/bin/bash ${home}/.oss/hooks/oss-verdict-capture.sh < in.json`],
  ['the plugin cache', () => '~/.claude/plugins/cache/oss/oss/2.1.4/hooks/oss-verdict-capture.sh < in.json'],
  ['a plugin checkout', () => `${PLUGIN_ROOT}/hooks/oss-verdict-capture.sh < in.json`],
  ['$CLAUDE_PLUGIN_ROOT as written', () => '"$CLAUDE_PLUGIN_ROOT/hooks/oss-verdict-capture.sh" < in.json'],
  ['node on the bundle', () => `node ${PLUGIN_ROOT}/watcher/dist/cli/verdict-capture.cjs start in.json`],
  ['node on a relative bundle path', () => 'cd watcher && node dist/cli/verdict-capture.cjs in.json'],
  ['through env', () => 'env node ~/.oss/watcher/dist/cli/verdict-capture.cjs in.json'],
  ['through command', () => 'command ~/.oss/hooks/oss-verdict-capture.sh < in.json'],
  ['through exec', () => 'exec ~/.oss/hooks/oss-verdict-capture.sh < in.json'],
  ['in any case', () => '~/.oss/hooks/OSS-Verdict-Capture.SH < in.json'],
  ['from a variable', () => 'v=~/.oss/hooks/oss-verdict-capture.sh; bash "$v" < in.json'],
  ['in a bash -c script', () => "bash -c '~/.oss/hooks/oss-verdict-capture.sh < in.json'"],
  ['through a glob', () => 'bash ~/.oss/hooks/oss-verdict-c*.sh < in.json'],
  ['through a glob on the bundle', () => 'node ~/.oss/watcher/dist/cli/verdict-*.cjs in.json'],
  // D44: the tsc output of the same CLI.
  ['node on the tsc output', () => 'node watcher/dist/cli/verdict-capture.js start in.json'],
  ['the ~ tsc output', () => 'node ~/.oss/watcher/dist/cli/verdict-capture.js in.json'],
  ['the $HOME tsc output', () => 'node "$HOME/.oss/watcher/dist/cli/verdict-capture.js" in.json'],
  ['through a glob on the tsc output', () => 'node ~/.oss/watcher/dist/cli/verdict-*.js in.json'],
  // Code-review L1 (round 7, D51): a set with `]` first, and class, equivalence and collating forms in a set.
  ['a set with ] first', () => 'bash ~/.oss/hooks/oss-verdict-captur[]e].sh < in.json'],
  ['a POSIX class in a set', () => 'bash ~/.oss/hooks/oss-verdict-captur[[:alpha:]].sh < in.json'],
  ['an equivalence class in a set', () => 'bash ~/.oss/hooks/oss-verdict-captur[[=e=]].sh < in.json'],
  ['a collating symbol in a set', () => 'bash ~/.oss/hooks/oss-verdict-captur[[.e.]].sh < in.json'],
  // Perf I3 (round 7, D51): a set in the extension, outside a hooks or cli folder.
  ['a set before the extension letters', () => 'node ./verdict-capture.[c]js in.json'],
  ['a set inside the extension', () => 'node ./verdict-capture.c[j]s in.json'],
  ['a set inside the .sh extension', () => 'bash ./oss-verdict-capture.[s]h < in.json'],
];

describe.each(AGENTS)('D41: %s cannot run the verdict capture itself', (_who, agent) => {
  it.each(REFUSED)('%s is refused', async (_what, command) => {
    const result = await call(command(), agent);
    expect(result.exitCode, command()).toBe(2);
    expect(result.stderr, command()).toMatch(/^Refused.*verdict capture/s);
  });

  it.each([
    '~/.oss/hooks/oss-value.sh timeline gate',
    '~/.oss/hooks/oss-phase-result.sh assemble ship',
    'npx vitest run test/cli/verdict-capture.test.ts',
    'npx vitest run test/cli/verdict-capture.test.js',
    'npx vitest run test/cli/verdict-capture.cli.test.ts',
  ])('still runs %s', async (command) => {
    const result = await call(command, agent);
    expect(result.stderr, command).toBe('');
    expect(result.exitCode, command).toBe(0);
  });
});

/**
 * @behavior A glob with many `*` is decided at once, so the gate never stalls (and fails closed) on a long glob.
 *   Bracket sets match one character, with `!`/`^` negation and ranges, as the shell reads them.
 * @business-rule R-257 D47 (round 6, "the gate rule's linear wildcard matcher"; perf LOW): globRegex turned each `*`
 *   into `.*`, so twelve `*` and then `x` took seconds.
 */
describe('D47: the wildcard matcher is linear', () => {
  it.each([30, 200])('a segment of %i `*` then x is decided in well under 100 ms', (stars) => {
    const command = `bash ~/.oss/hooks/${'*'.repeat(stars)}x`;
    const start = performance.now();
    const named = namesVerdictCapture(command);
    const elapsed = performance.now() - start;
    expect(named).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });

  // Round 7: class and equivalence forms with no closing are read in one pass (a regex took about 30 s here).
  it.each([
    ['open class forms', `[${'[:a'.repeat(3000)}`],
    ['open equivalence forms', `[${'[='.repeat(3000)}`],
    ['open sets', '['.repeat(5000)],
    ['backslashes in an open set', `[${'\\'.repeat(5000)}`],
  ])('%s are decided in well under 100 ms', (_what, glob) => {
    const start = performance.now();
    const named = namesVerdictCapture(`bash ~/.oss/hooks/${glob}`);
    const elapsed = performance.now() - start;
    expect(named).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });

  it.each([
    ['many stars before the name', `bash ~/.oss/hooks/${'*'.repeat(200)}oss-verdict-capture.sh`, true],
    ['a range set', 'bash ~/.oss/hooks/oss-verdict-captur[a-z].sh', true],
    ['a negated set that excludes the letter', 'bash ~/.oss/hooks/oss-verdict-captur[!e].sh', false],
    ['a caret-negated set that excludes the letter', 'bash ~/.oss/hooks/oss-verdict-captur[^e].sh', false],
    ['a negated set that allows the letter', 'bash ~/.oss/hooks/oss-verdict-captur[!x].sh', true],
    ['a set without the letter', 'bash ~/.oss/hooks/oss-verdict-captur[xyz].sh', false],
    ['a ? for one character', 'bash ~/.oss/hooks/oss-verdict-captur?.sh', true],
    // Code-review L1 and perf I3 (round 7, D51).
    ['a set with ] first that holds the letter', 'bash ~/.oss/hooks/oss-verdict-captur[]e].sh', true],
    ['a set with ] first, without the letter', 'bash ~/.oss/hooks/oss-verdict-captur[]x].sh', false],
    ['a negated set with ] first that excludes the letter', 'bash ~/.oss/hooks/oss-verdict-captur[!]e].sh', false],
    ['a POSIX class, as any one character', 'bash ~/.oss/hooks/oss-verdict-captur[[:digit:]].sh', true],
    ['a set in the extension outside a hooks or cli folder', 'node ./verdict-capture.c[j]s', true],
    ['a bare extension glob outside a hooks or cli folder', 'node ./*.js', false],
    ['a set in a bare extension outside a hooks or cli folder', 'node ./*.[c]js', false],
  ])('%s: named is %s', (_what, command, named) => {
    expect(namesVerdictCapture(command)).toBe(named);
  });
});
