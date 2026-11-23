/**
 * @behavior The main agent and builders can't forge a remote-tracking ref or a replace ref through a remote the
 *   gate can't see as a real one. Refused: a default-looking fetch or pull mapping (`+main:refs/remotes/y/main`)
 *   for a name that is not a remote in the repo's git config (a symlink or bare clone made in the same call);
 *   `git remote set-head <remote> <branch>`; a remote pointed at localhost, 127.x or ::1 over http(s), git://
 *   or ssh (`remote add`, `set-url`, `-c remote.<name>.url=`, an insteadOf base); and a fetch or pull refspec,
 *   `--refmap` or `-c remote.<name>.fetch` that writes under refs/replace/. Everyday fetch, pull, push, the
 *   default mapping of a configured remote, `set-head -a` / `-d`, and a remote on a real host stay allowed.
 * @business-rule gate-gaps-r3 ship round 1, S3 (owner pick "Fix all four"): the ship base is read from
 *   refs/remotes/, and refs/replace/ changes which commits git shows.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and a scratch repo whose
 *   origin is a real host, on darwin and linux.
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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-remote-forge-configured-')));
  repo = path.join(root, 'repo');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  execFileSync('git', ['checkout', '-q', '-b', 'feat/x'], { cwd: repo });
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
        session_id: 'remote-forge-configured',
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

const UNCONFIGURED_DEFAULT = [
  'ln -s . y && git fetch y +main:refs/remotes/y/main',
  'ln -s . y && git fetch y feat/x:refs/remotes/y/feat/x',
  'git clone -q --bare . x && git fetch x main:refs/remotes/x/main',
  'ln -s . y && git pull y main:refs/remotes/y/main',
  'git fetch nowhere main:refs/remotes/nowhere/main',
];

const SET_HEAD = ['git remote set-head origin feat/x', 'git remote set-head origin main', 'git remote -v set-head origin feat/x'];

const LOOPBACK_URLS = [
  'git remote add x http://127.0.0.1:8000/x.git',
  'git remote add x https://localhost/x.git',
  'git remote add x git://localhost/x',
  "git remote add x 'http://[::1]/x.git'",
  'git remote add x ssh://localhost/x',
  'git remote add x ssh://git@127.0.0.2:22/x',
  'git remote add x localhost:/abs/repo',
  'git remote add x git@localhost:x.git',
  'git remote set-url origin http://127.0.0.1:8000/x.git',
  'git -c remote.origin.url=http://127.0.0.1:8000/x.git fetch',
  'git -c url.http://localhost:8000/.insteadOf=https://github.com/ fetch origin',
];

const REPLACE_DESTINATIONS = [
  'git fetch origin x:refs/replace/abc',
  'git fetch origin feat/x:refs/replace/0123456789012345678901234567890123456789',
  "git fetch origin 'refs/heads/r/*:refs/replace/*'",
  'git fetch origin x:REFS/REPLACE/abc',
  'git pull origin feat/x:refs/replace/0123456789012345678901234567890123456789',
  "git fetch --refmap='refs/heads/*:refs/replace/*' origin",
  "git -c remote.origin.fetch='refs/heads/*:refs/replace/*' fetch origin",
];

const ALLOWED = [
  'git fetch origin',
  'git pull --rebase',
  'git push -u origin feat/x',
  'git remote add up https://github.com/a/b.git && git fetch up',
  'git fetch origin main:refs/remotes/origin/main',
  'git fetch origin +main:refs/remotes/origin/main',
  'git remote set-head origin -a',
  'git remote set-head origin --auto',
  'git remote set-head origin -d',
  'git remote set-head origin --delete',
  'git remote add fork git@github.com:a/b.git',
];

describe.each(PLATFORMS)('remotes the gate can see (ship round 1, S3) on %s', (platform) => {
  describe.each(AGENTS)('%s', (_label, agent) => {
    async function refused(command: string): Promise<void> {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    }

    it.each(UNCONFIGURED_DEFAULT)('refuses a default-looking mapping for a name that is not a configured remote: %s', refused);
    it.each(SET_HEAD)('refuses pointing a remote HEAD at a branch: %s', refused);
    it.each(LOOPBACK_URLS)('refuses a remote on localhost, 127.x or ::1: %s', refused);
    it.each(REPLACE_DESTINATIONS)('refuses a fetch or pull that writes a replace ref: %s', refused);

    it.each(ALLOWED)('allows everyday fetch, pull, push and remotes on real hosts: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});
