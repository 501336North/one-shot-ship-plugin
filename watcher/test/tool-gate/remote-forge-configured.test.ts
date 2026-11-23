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

/** Ship fix round 2, R2-1: the host read the way the OS reads it (inet_aton / getaddrinfo numeric forms). */
const LOOPBACK_FORMS = [
  'git remote set-url origin http://127.1:8000/x.git',
  'git remote set-url origin http://0x7f.1/x.git',
  'git remote set-url origin http://2130706433/x.git',
  'git remote set-url origin http://0177.0.0.1/x.git',
  'git remote set-url origin http://[::ffff:127.0.0.1]/x.git',
  'git remote set-url origin http://[::ffff:7f00:1]/x.git',
  'git remote set-url origin http://0.0.0.0:8000/x.git',
  'git remote set-url origin http://0/x.git',
  'git remote set-url origin http://[0::1]/x.git',
  'git remote set-url origin http://[::]/x.git',
  'git remote set-url origin http://foo.localhost:8000/x.git',
  'git remote set-url origin http://FOO.LocalHost./x.git',
  'git remote set-url origin 127.1:x',
  'git remote set-url origin http://127.0.0.1%2e/x',
  'git -c url.http://127.1:8000/.insteadOf=https://github.com/ fetch origin',
  'git remote add y http://127.1/x && git fetch y',
];

/** Ship fix round 3, R3-3: userinfo read the way git and curl read it (authority ends at / ? #, last @ wins, brackets). */
const USERINFO_FORMS = [
  'git remote set-url origin http://u:p@127.0.0.1:8000/x.git',
  'git remote set-url origin http://a@b@127.0.0.1:8000/x.git',
  "git remote set-url origin 'ssh://[git@127.0.0.1]:22/x'",
  "git remote set-url origin 'ssh://[git@::1]:22/x'",
  "git remote set-url origin '[git@127.0.0.1]:x'",
  "git remote set-url origin '[git@::1]:x'",
  'git remote set-url origin http://127.0.0.1#@github.com/x',
  'git remote set-url origin http://127.0.0.1?@github.com/x',
  'git -c url.http://u:p@127.1:8000/.insteadOf=https://github.com/ fetch origin',
  'git remote set-url origin http://u:p@localhost/x',
  'git remote add y https://a@b@localhost/x',
  'git remote add y https://evil.com@localhost/x',
];

/** Ship fix round 4, R4-2 ("Split by scheme"): ssh and scp-like hosts end at `/` only, so `#` and `?` sit in the user part. */
const SSH_AUTHORITY = [
  "git remote set-url origin 'ssh://github.com#@127.0.0.1/x'",
  "git remote set-url origin 'ssh://github.com?@127.0.0.1/x'",
  "git remote set-url origin 'git+ssh://github.com#@127.0.0.1/x'",
  "git remote set-url origin 'ssh+git://github.com#@127.0.0.1/x'",
  "git remote add y 'ssh://github.com#@localhost:22/x' && git fetch y",
  "git remote add y 'git+ssh://x#@localhost/x' && git fetch y",
  "git -c 'url.ssh://github.com#@127.0.0.1/.insteadOf=https://github.com/' fetch origin",
  "git remote set-url origin 'ssh://[github.com#@127.0.0.1]:22/x'",
  "git remote set-url origin 'github.com#@127.0.0.1:x'",
];

/** Ship fix round 5, R5-2 MEDIUM: the authority is percent-decoded before the host is read (`%40` is `@`, `%5b` is `[`). */
// owner pick (a) "Drop the 3 rows, card it": a bare `git fetch <url>` / `git ls-remote <url>` is not host-judged
const ENCODED_AUTHORITY = [
  "git remote add y 'ssh://%5b::1%5d/x'",
  "git -c 'url.ssh://github.com%40127.0.0.1/.insteadOf=https://github.com/' fetch origin",
  "git remote add y 'ssh://github.com%40127.0.0.1/x'",
  "git remote add y 'https://github.com%40127.0.0.1/x'",
  "git remote set-url origin 'http://github.com%40localhost:8000/x'",
  "git remote add y 'ssh://localhos%74/x'",
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
  // R2-1: hosts that only look numeric, or private ones, are not this machine
  'git remote add up2 https://github.com/a/b.git',
  'git remote add up3 git@github.com:a/b.git',
  'git remote add lan https://10.0.0.5/x.git',
  'git remote add near https://127host.example/x.git',
  // R3-3: userinfo and ports on a remote host
  'git remote add up4 https://u:p@github.com/a/b.git',
  'git remote add corp https://git.corp:8443/x.git',
  'git remote add trick https://localhost@evil.com/x',
  // R4-2: http(s) still ends the host at `?` / `#`; L13's real host is github.com
  'git remote set-url origin http://127.0.0.1:8000@github.com/x',
  'git remote add up5 https://github.com/a/b.git?x=1',
  'git remote add up6 ssh://git@github.com/a/b.git',
  // R5-1 pinning: an ssh URL with a port and a `#` or `?` in the path
  "git remote add up7 'ssh://git@github.com:22/a/b.git#frag'",
  "git remote add up8 'ssh://git@github.com:2222/a?b.git'",
  // R5-2: an escape in the path, or an escaped `@` inside the userinfo, is not a host
  "git remote add sp 'https://github.com/a/my%20repo.git'",
  "git remote add pw 'https://u:p%40x@github.com/a/b.git'",
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
    it.each(LOOPBACK_FORMS)('refuses a remote on this machine in any numeric or localhost spelling: %s', refused);
    it.each(USERINFO_FORMS)('refuses a remote on this machine behind userinfo or brackets: %s', refused);
    it.each(SSH_AUTHORITY)('refuses an ssh remote whose host, read to the first `/`, is this machine: %s', refused);
    it.each(ENCODED_AUTHORITY)('refuses a remote on this machine behind a percent-encoded authority: %s', refused);
    it.each(REPLACE_DESTINATIONS)('refuses a fetch or pull that writes a replace ref: %s', refused);

    it.each(ALLOWED)('allows everyday fetch, pull, push and remotes on real hosts: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});
