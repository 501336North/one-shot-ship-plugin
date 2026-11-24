/**
 * @behavior The main agent and builders cannot run an OSS hook script with a variable they chose, or run the verdict
 *   capture, by writing a part of its path as a bracket set of any kind: a negated set (`[!A-^]ooks`, `[^A-Z]ooks`,
 *   `[!H]ooks`), a range across the letter cases (`h[Z-p]oks`), a set with `]` or a backslash (`[h\]]ooks`),
 *   or a set of a letter outside ASCII (`[ß]ooks`). Everyday class globs (`ls [A-Z]*.md`, `ls [!A-Z]*.md`,
 *   `./build-[0-9].sh`) and `[ … ]` tests stay allowed.
 * @business-rule gate-gaps-r3 ship fix round 14, R14-1 (owner pick "Round 14: blunt any-set"): in the hook-path and
 *   verdict-capture matchers any `[…]` set counts as one character of any kind, as on the Sprint D base 5424a129.
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-round14-any-set-')));
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
        session_id: 'round14-any-set',
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

/** Hook calls with a chosen variable, a part of the hook path written as a set of any kind. */
const HOOK_ANY_SET_REFUSED = [
  "HOME=/x ~/.oss/[!H-_]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[^H-_]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[!A-_]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[!H]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[^H]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[!h]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/h[!O-_]oks/oss-log.sh x",
  "HOME=/x ~/.oss/h[Z-a]oks/oss-log.sh x",
  "HOME=/x ~/.oss/[!A-^]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[^A-^]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[!A-a]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/[^A-Z]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/h[!A-^]oks/oss-log.sh x",
  "HOME=/x ~/.oss/hoo[!A-^]s/oss-log.sh x",
  "HOME=/x ~/.oss/[Z-a]ooks/oss-log.sh x",
  "HOME=/x ~/.[!A-^]ss/[!A-^]ooks/oss-log.sh x",
  "env -i ~/.oss/[!A-^]ooks/oss-log.sh x",
  "PATH=/tmp/e:$PATH ~/.oss/[!A-^]ooks/oss-notify.sh x",
  "HOME=/x ~/.oss/[!A-^]ooks/ensure-decrypt-cli.sh",
  "HOME=/x bash ~/.oss/[!A-^]ooks/oss-log.sh",
  "FOO=1 ./[!A-^]ooks/oss-log.sh x",
  "FOO=1 [!A-^]ooks/oss-log.sh x",
  "HOME=/x ~/.claude/plugins/cache/x/y/[!A-^]ooks/oss-log.sh",
  "HOME=/x ~/.oss/[ß]ooks/oss-log.sh",
  "HOME=/x ~/.oss/[İ-K]ooks/oss-log.sh",
  "HOME=/x ~/.oss/[!A-^][!A-^][!A-^][!A-^][!A-^]/oss-log.sh",
  "HOME=/x ~/.oss/*[!A-^]/oss-log.sh",
  "HOME=/x ~/.oss/[!A-^]*/oss-log.sh",
  "HOME=/x ~/.oss/[!A-^]?oks/oss-log.sh",
  "HOME=/x ~/.oss/?[!A-^]oks/oss-log.sh",
  "HOME=/x ~/.oss/[!A-Z]ooks/oss-log.sh",
  "HOME=/x ~/.oss/[!G-I]ooks/oss-log.sh",
  "HOME=/x ~/.oss/[!E-a]ooks/oss-log.sh",
  "HOME=/x ~/.oss/[^H-^]ooks/oss-log.sh",
  "HOME=/x ~/.oss/[h\\]]ooks/oss-log.sh x",
  "HOME=/x ~/.oss/h[Z-p]oks/oss-log.sh x",
  "FOO=1 ./h[Z-o]oks/oss-log.sh x",
];

/** The verdict capture named through a set of any kind. */
const CAPTURE_ANY_SET_REFUSED = [
  "node x/verdict-captur[!E].cjs",
  "node x/verdict-captur[^A-Z].cjs",
  "node x/verdict-captur[!A-^].cjs",
  "node watcher/dist/cli/verdict-captur[!E-_].cjs",
  "node watcher/dist/cli/verdict-captur[!e].cjs",
  "node watcher/dist/cli/[!A-^]erdict-capture.cjs",
  "node watcher/dist/x/verdict-[!A-^]apture.cjs",
  "bash ~/.oss/hooks/oss-[!A-^]erdict-capture.sh",
  "bash ~/.oss/hooks/oss-verdict-captur[^E-_].sh",
  "bash x/oss-[!A-^]erdict-capture.sh",
  "bash ~/.oss/hooks/oss-verdict-captur[Z-f].sh",
  "node watcher/dist/cli/verdict-captur[Z-f].cjs",
  "find watcher/dist -name '[!A-^]erdict-capture.cjs' -exec node {} \\;",
  "find watcher/dist/cli -name 'verdict-captur[!E].cjs' -exec node {} \\;",
];

/** Everyday class globs and `[` tests: no hook or capture path. */
const EVERYDAY_SETS_ALLOWED = [
  "ls [A-Z]*.md",
  "./build-[0-9].sh",
  "ls [!A-Z]*.md",
  "cat src/[A-Z]*.ts",
  "ls docs/[a-z]*.md",
  "ls [^a-z]*",
  "ls src/[A-Z][a-z]*.tsx",
  "[ -f x ] && echo y",
  "[[ -n \"$x\" ]] && echo y",
  "if [ \"$a\" = \"B\" ]; then echo; fi",
  "grep -E \"[A-Z]+\" file",
  "rg \"[A-Za-z_]+\" src",
  "echo [Z-a]",
];

describe.each(AGENTS)("%s", (_name, agent) => {
  it.each(HOOK_ANY_SET_REFUSED)("refuses a hook call whose path holds a set of any kind: %s", async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  it.each(CAPTURE_ANY_SET_REFUSED)("refuses a verdict capture call named through a set of any kind: %s", async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  it.each(EVERYDAY_SETS_ALLOWED)("allows an everyday class glob or test: %s", async (command) => {
    const result = await call(command, agent);
    expect(result.exitCode).toBe(0);
  });
});
