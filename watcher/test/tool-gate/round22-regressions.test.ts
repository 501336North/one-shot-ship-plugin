/**
 * @behavior The main agent's and builders' Bash calls (zsh on macOS, bash elsewhere): a script that makes a scratch
 *   file or folder with `mktemp "${TMPDIR:-/tmp}/x.XXXXXX"` (and then `cd`s into it or writes to it) runs, as it did
 *   before round 21; a mktemp whose template or folder could name a protected path stays refused.
 * @business-rule R-266 round 22 (PLAN Phase 8): fix only ordinary commands that round 21 newly refuses.
 *   Task 18 (CR LOW-1 round 21): a mktemp template already judged as inside the temp folder (`${TMPDIR:-/tmp}/…`,
 *   with no `..` after the temp head) is a temp write, not a write the gate cannot read.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and repo, on darwin (zsh) and linux (bash).
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

let root: string;
let repo: string;
let home: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r22-regressions-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'run'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
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
        session_id: 'r22-regressions',
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

/** Enough `..` parts (`../..`, no slash at the end) to climb from the real temp folder, and a folder mktemp may add, up to `/`. */
function climb(): string {
  return Array.from({ length: fs.realpathSync(os.tmpdir()).split('/').filter(Boolean).length + 2 }, () => '..').join('/');
}

/**
 * Exactly as many `..` parts as the real temp folder is deep (the code review's form): from the temp folder they reach
 * `/`, so an absolute path after them is that path; from the scratch repo, two folders deeper, they stop short of `/`.
 */
function exactClimb(): string {
  return Array.from({ length: fs.realpathSync(os.tmpdir()).split('/').filter(Boolean).length }, () => '..').join('/');
}

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    describe('Task 18: mktemp with a ${TMPDIR:-/tmp} template', () => {
      it.each([
        'tmp=$(mktemp "${TMPDIR:-/tmp}/x.XXXXXX")',
        'tmp=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") && cd "$tmp"',
        'tmp=$(mktemp "${TMPDIR:-/tmp}/x.XXXXXX"); echo hi > "$tmp"',
      ])('allows a scratch file or folder made in the temp folder, as before round 21: %s', (command) =>
        allowed(command, agent, platform));

      it.each([
        'mktemp -p .oss x',
        "trap 'cp -R x \"$F\"' EXIT; F=$(mktemp -d -t ../../.claude/plugins/p)",
        'mktemp .git/hooks/pre-commit',
        'mktemp "${TMPDIR:-/tmp}/../../../../../../../../..$PWD/.oss/p.XXXXXX"',
      ])('keeps refusing a mktemp whose template or folder could be protected: %s', (command) =>
        refuse(command, agent, platform));
    });

    describe('Task 21: mktemp temp-folder template with /', () => {
      // R-266 round 22, Task 21 (CR MEDIUM-1 / SEC LOW-1 round 21): a template holding `/` under the temp folder
      // (`--tmpdir`, `-p "$TMPDIR"`) can climb out of it to any path, so the path mktemp makes is unknown and refused.
      it.each<[string, () => string]>([
        ['-u --tmpdir to the repo rule file, then written', () => `F=$(mktemp -u --tmpdir ${climb()}${repo}/.oss/tool-gates.json); echo x > "$F"`],
        ['-u -p "$TMPDIR" to the repo rule file, then written', () => `F=$(mktemp -u -p "$TMPDIR" ${climb()}${repo}/.oss/tool-gates.json); echo x > "$F"`],
        ['-d --tmpdir to the plugins folder', () => `mktemp -d --tmpdir ${climb()}${home}/.claude/plugins/p.XXX`],
        ['a trap copying into a --tmpdir folder under .oss', () => `trap 'cp -R src/. "$F"' EXIT; F=$(mktemp -d --tmpdir ../../x/.oss/p.XXX)`],
        ['--tmpdir to the pre-commit hook through $PWD', () => `mktemp --tmpdir "${climb()}/..$PWD/.git/hooks/pre-commit"`],
      ])('refuses a temp-folder template that climbs out with / (the first three are already refused by the path-mention rule, kept as pins): %s', (_label, command) => refuse(command(), agent, platform));

      it.each<[string, () => string, (template: string) => string]>([
        ['-u --tmpdir to the repo rule file, then written', () => `${exactClimb()}${repo}/.oss/tool-gates.json`, (t) => `F=$(mktemp -u --tmpdir ${t}); echo x > "$F"`],
        ['-u -p "$TMPDIR" to the repo rule file, then written', () => `${exactClimb()}${repo}/.oss/tool-gates.json`, (t) => `F=$(mktemp -u -p "$TMPDIR" ${t}); echo x > "$F"`],
        ['-d --tmpdir to the plugins folder', () => `${exactClimb()}${home}/.claude/plugins/p.XXX`, (t) => `mktemp -d --tmpdir ${t}`],
      ])('refuses a temp-folder template climbing exactly the temp folder depth, which the path-mention rule does not see: %s', async (_label, template, command) => {
        // the row exercises the temp-folder reading: read from the command's folder, the template names nothing protected
        const fromCwd = path.resolve(repo, template());
        expect(fromCwd.startsWith(`${repo}/`) || fromCwd.startsWith(`${home}/`)).toBe(false);
        // read from the temp folder, it is the protected path itself
        expect(path.resolve(fs.realpathSync(os.tmpdir()), template()).startsWith(`${root}/`)).toBe(true);
        await refuse(command(template()), agent, platform);
      });

      it.each([
        'mktemp --tmpdir x.XXXX',
        'mktemp -p "$TMPDIR" x.XXXX',
        'mktemp -d --tmpdir x.XXXX',
        'mktemp -d',
        'mktemp',
        'mktemp -t x',
      ])('keeps allowing a plain name in the temp folder: %s', (command) => allowed(command, agent, platform));
    });

    describe('Task 20 reverted: the folder rule judges every write below a folder holding protected files (ADR-067)', () => {
      // R-266 round 22, Task 22 (ADR-067): the one-shot security review of Task 20 (D-R22-2) found that skipping the
      // folder rule for a single-file `rm` also skipped the `rm` part's redirect targets, so Task 20 is reverted and
      // every row here holds its round-21 verdict. Each target exists as a plain file, so a disk check cannot pass it.
      beforeAll(() => {
        for (const folder of [['modules', 'sub', 'hooks'], ['modules', 'sub', 'refs', 'heads'], ['worktrees', 'foo'], ['rebase-merge']]) {
          fs.mkdirSync(path.join(repo, '.git', ...folder), { recursive: true });
        }
        for (const file of [
          ['modules', 'sub', 'index.lock'],
          ['modules', 'sub', 'HEAD'],
          ['modules', 'sub', 'hooks', 'pre-commit'],
          ['modules', 'sub', 'refs', 'heads', 'main'],
          ['worktrees', 'foo', 'index.lock'],
        ]) {
          fs.writeFileSync(path.join(repo, '.git', ...file), '');
        }
      });

      it.each([
        'rm -f .git/worktrees/foo/index.lock',
      ])('keeps allowing deleting a stale lock file in a worktree git folder, as at round 21: %s', (command) =>
        allowed(command, agent, platform));

      it.each([
        // accepted over-refusal, ADR-067; OS write-sandbox card
        'rm -f .git/modules/sub/index.lock',
        'rm .git/modules/sub/index.lock',
      ])('refuses deleting a lock file inside a submodule git folder, as at round 21: %s', (command) =>
        refuse(command, agent, platform));

      it.each([
        // the security review's redirect commands: an `rm` part's redirect target is a write like any other
        'touch "echo PWNED"; rm -v "echo PWNED" >> .git/modules/sub/hooks/pre-commit',
        'rm -f x > .git/modules/sub/HEAD',
        'rm nofile 2> .git/modules/sub/HEAD',
        // a submodule's hook, HEAD or branch file, deleted one at a time
        'rm -f .git/modules/sub/hooks/pre-commit',
        'rm -f .git/modules/sub/HEAD',
        'rm -f .git/modules/sub/refs/heads/main',
      ])('refuses an rm or its redirect that writes a file inside a submodule git folder: %s', (command) =>
        refuse(command, agent, platform));

      it.each([
        'rm -rf .git/hooks',
        'rm -rf .git/modules/sub',
        'rm -rf .git/worktrees/foo',
        'find .git/hooks -delete',
        'mv .git/hooks x',
        'rm -f .git/hooks/pre-commit',
        // a folder named itself (a link there is deleted by rm without -r), or a protected file below one
        'rm -f .git/hooks',
        'rm .git/hooks',
        'rm -f .git/refs',
        'rm -f .git/modules/sub',
        'unlink .git/hooks',
        'rm -f .git/refs/heads/main',
        // after a cd, the name is looked up in the folder the command runs in
        'cd .git && rm -f hooks',
        'cd .git/modules && rm -f sub',
      ])('keeps refusing a whole-folder write to a folder holding protected files, or a protected file itself: %s', (command) =>
        refuse(command, agent, platform));

      it.each([
        'rm -f .git/index.lock',
        'rm -rf .git/rebase-merge',
        'mkdir -p .git/hooks',
        'ls .git/hooks',
      ])('keeps allowing ordinary git housekeeping and reads: %s', (command) => allowed(command, agent, platform));
    });

    describe('Task 19: quoted or expanded assignment values before arr=(', () => {
      // R-266 round 22, Task 19 (CR LOW-2 round 21): zsh reads `A=… arr=(…)` as assignments whenever the earlier
      // word's `name=` part is written plainly, whatever its value; a quoted, escaped or braced name is a command word.
      it.each([
        'A="x y" arr=(a b)',
        'A=$HOME arr=(a)',
        'A=$(pwd) arr=(a)',
      ])('allows an array after an assignment whose value is quoted or expanded, as before round 21: %s', (command) =>
        allowed(command, agent, platform));

      const WRITE = ' x=(a|b\n#x) ; echo x > .oss/tool-gates.json';
      it.each([
        `\\typeset${WRITE}`,
        `'A=1'${WRITE}`,
        `A\\=1${WRITE}`,
        `{A=1,B=2}${WRITE}`,
        `{A=1}${WRITE}`,
      ])('keeps refusing `name=(` after a quoted, escaped or braced word (round 21a controls): %s', (command) =>
        refuse(command, agent, platform));
    });
  });
});
