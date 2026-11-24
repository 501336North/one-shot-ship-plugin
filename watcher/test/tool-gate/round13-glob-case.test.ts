/**
 * @behavior The main agent and builders can't run an OSS hook script with a HOME, PATH or other variable they chose
 *   by writing a folder of its path as a set whose range spans the two letter cases (`~/.oss/h[Z-p]oks/oss-log.sh`,
 *   `./h[Z-o]oks/oss-log.sh` in a plugin checkout). The shell matches such a set as written, so `[Z-p]` holds `o`.
 *   Everyday class globs (`ls [A-Z]*.md`, `./build-[0-9].sh`) stay allowed.
 * @business-rule gate-gaps-r3 ship fix round 13, R13-1 (owner pick "Round 13: all three"): the hook-path glob reading
 *   lowercased the pattern before reading ranges, so `[Z-p]` became the empty `[z-p]` and the hook call was allowed.
 *   A set is now tested with each letter in both cases against the pattern as written.
 *   R13-2: the same reading for the verdict capture, so `bash ~/.oss/hooks/oss-verdict-captur[Z-f].sh` and a find
 *   name test that could pick the capture (`-name 'verdict-captur[Z-f].cjs'`) are refused.
 *   R13-3: a hook line whose quoted word holds thousands of `export` or `env` pieces is read in one pass, so the
 *   gate answers in well under a second with the same verdict (the piece check was quadratic: 2000 pieces took 3 s).
 * @boundary runToolGate (the gate as the hook calls it), in a scratch plugin checkout with a scratch home.
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-round13-glob-case-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  // a plugin checkout: its `hooks/` scripts are OSS hooks
  fs.mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), '{"name":"oss"}\n');
  fs.mkdirSync(path.join(repo, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
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
        session_id: 'round13-glob-case',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'darwin' },
  );
}

/** Hook calls with a chosen variable, a folder written as a set whose range spans both letter cases. */
const HOOK_CASE_RANGE_REFUSED = [
  'HOME=/x ~/.oss/h[Z-p]oks/oss-log.sh x',
  'env -i ~/.oss/h[Z-p]oks/oss-log.sh x',
  'PATH=/tmp/evil:$PATH ~/.oss/h[Z-p]oks/oss-log.sh x',
  'export PATH=/tmp/evil:$PATH; ~/.oss/h[Z-p]oks/oss-log.sh x',
  'OSS_API=http://evil ~/.oss/h[Z-p]oks/oss-notify.sh x',
  'HOME=/x ~/.oss/h[T-o]oks/oss-log.sh x',
  'HOME=/x bash ~/.oss/h[Z-p]oks/oss-log.sh x',
  'HOME=/x $HOME/.oss/h[Z-p]oks/oss-log.sh x',
  'HOME=/x /Users/nobody/.oss/h[Z-p]oks/oss-log.sh x',
  'HOME=/x ~/.oss/h[Z-p]oks/ensure-decrypt-cli.sh',
  "sh -c 'HOME=/x ~/.oss/h[Z-p]oks/oss-log.sh x'",
  'FOO=1 ~/.oss/h[Z-p]oks/oss-log.sh x',
  'FOO=1 ~/.oss/ho[Z-p]ks/oss-log.sh x',
  'FOO=1 h[Z-o]oks/oss-log.sh x',
  'FOO=1 ./h[Z-o]oks/oss-log.sh x',
];

/** The verdict capture named through a set whose range spans both letter cases. */
const CAPTURE_CASE_RANGE_REFUSED = [
  'bash ~/.oss/hooks/oss-verdict-captur[Z-f].sh',
  'node watcher/dist/cli/verdict-captur[Z-f].cjs',
  'node watcher/dist/cli/verdict-c[Z-b]pture.cjs',
  "find watcher/dist/cli -name 'verdict-captur[Z-f].cjs' -exec node {} \\;",
  "find . -path '*/cli/verdict-captur[Z-f].cjs' -exec node {} \\;",
];

/** Everyday class globs: no hook path. */
const EVERYDAY_CLASS_GLOBS = ['ls [A-Z]*.md', './build-[0-9].sh', 'cat src/[A-Z]*.ts', 'ls docs/[a-z]*.md'];

describe.each(AGENTS)('%s', (_name, agent) => {
  it.each(HOOK_CASE_RANGE_REFUSED)('refuses a hook call whose folder is a set spanning both letter cases: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  it.each(CAPTURE_CASE_RANGE_REFUSED)('refuses a verdict capture call named through a set spanning both letter cases: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  it.each(EVERYDAY_CLASS_GLOBS)('allows an everyday class glob: %s', async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode).toBe(0);
  });
});

/** Hook lines with one quoted word of many `export` or `env` pieces, and the verdict each keeps. */
const MANY_PIECES: Array<[string, string, number]> = [
  ['2,000 export pieces on a hook line', `~/.oss/hooks/oss-log.sh "${Array(2000).fill('export').join(' ')}"`, 2],
  ['14,000 export pieces on a hook line', `~/.oss/hooks/oss-log.sh "${Array(14_000).fill('export').join(' ')}"`, 2],
  ['2,000 env pieces on a hook line', `~/.oss/hooks/oss-log.sh "${Array(2000).fill('env').join(' ')}"`, 2],
  ['14,000 env pieces on a hook line', `~/.oss/hooks/oss-log.sh "${Array(14_000).fill('env').join(' ')}"`, 2],
  ['2,000 export pieces before a hook path', `echo "${Array(2000).fill('export').join(' ')}" ~/.oss/hooks/oss-log.sh`, 0],
  ['14,000 export pieces before a hook path', `echo "${Array(14_000).fill('export').join(' ')}" ~/.oss/hooks/oss-log.sh`, 2],
];

describe('a hook line with many export or env pieces', () => {
  it.each(MANY_PIECES)('answers %s in under 1 s with the same verdict', async (_name, command, exitCode) => {
    await call('true', null);
    const started = performance.now();
    const result = await call(command, null);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.exitCode).toBe(exitCode);
  });
});
